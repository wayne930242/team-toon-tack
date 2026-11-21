import { afterEach, beforeEach, test } from "bun:test";
import assert from "node:assert/strict";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
	authMode,
	DEFAULT_OAUTH_SCOPE,
	fetchClientCredentialsToken,
	getOAuthConfig,
	isAppActor,
	LinearAuthError,
	type OAuthConfig,
	prepareLinearAuth,
	REFRESH_MARGIN_MS,
	readCachedToken,
	resetLinearAuth,
	resolveAppActorUser,
	resolveLinearCredential,
	tokenCachePath,
} from "./linear-auth.js";

const DAY = 24 * 60 * 60 * 1000;
const SECRET = "client-secret-value";
const GRAPHQL = "https://api.linear.app/graphql";
const TOKEN_URL = "https://api.linear.app/oauth/token";

let dir: string;
let cacheFile: string;
let env: Record<string, string>;
const realFetch = globalThis.fetch;

beforeEach(() => {
	dir = mkdtempSync(path.join(tmpdir(), "ttt-auth-test-"));
	cacheFile = path.join(dir, "state", "token.json");
	env = {
		LINEAR_CLIENT_ID: "client-id",
		LINEAR_CLIENT_SECRET: SECRET,
		LINEAR_OAUTH_TOKEN_CACHE: cacheFile,
	};
});

afterEach(() => {
	resetLinearAuth();
	globalThis.fetch = realFetch;
	rmSync(dir, { recursive: true, force: true });
});

interface Call {
	url: string;
	body?: string;
	authorization?: string | null;
}

/** Mock Linear: a token endpoint handing out tok1, tok2, ... and a GraphQL
 * endpoint that accepts only the tokens in `accepted`. */
function mockLinear(options: { accepted: () => Set<string> }) {
	const calls: Call[] = [];
	let issued = 0;
	globalThis.fetch = (async (
		input: RequestInfo | URL,
		init?: RequestInit,
	): Promise<Response> => {
		const url = String(input);
		const headers = new Headers(init?.headers);
		calls.push({
			url,
			body: init?.body ? String(init.body) : undefined,
			authorization: headers.get("Authorization"),
		});
		if (url === TOKEN_URL) {
			issued += 1;
			return Response.json({
				access_token: `tok${issued}`,
				expires_in: 30 * 24 * 60 * 60,
			});
		}
		const token = headers.get("Authorization")?.replace("Bearer ", "") ?? "";
		return options.accepted().has(token)
			? Response.json({ data: { ok: true } })
			: new Response("unauthorized", { status: 401 });
	}) as typeof fetch;
	return {
		calls,
		tokenRequests: () => calls.filter((c) => c.url === TOKEN_URL),
	};
}

function writeCache(
	token: string,
	expiresAt: number,
	overrides: Record<string, unknown> = {},
) {
	const entry = {
		access_token: token,
		issued_at: expiresAt - 30 * DAY,
		expires_at: expiresAt,
		client_id: "client-id",
		scope: DEFAULT_OAUTH_SCOPE,
		...overrides,
	};
	// same shape the module writes; directory created on demand
	mkdirSync(path.dirname(cacheFile), { recursive: true });
	writeFileSync(cacheFile, JSON.stringify(entry), { mode: 0o600 });
}

test("precedence: LINEAR_API_KEY wins over an access token and client credentials", () => {
	const all = { ...env, LINEAR_API_KEY: "k", LINEAR_ACCESS_TOKEN: "t" };
	assert.equal(authMode(all), "apiKey");
	assert.deepEqual(resolveLinearCredential(all), {
		kind: "apiKey",
		apiKey: "k",
	});
	assert.equal(isAppActor(all), false);
});

test("precedence: LINEAR_ACCESS_TOKEN wins over client credentials", () => {
	const withToken = { ...env, LINEAR_ACCESS_TOKEN: "t" };
	assert.equal(authMode(withToken), "accessToken");
	assert.deepEqual(resolveLinearCredential(withToken), {
		kind: "accessToken",
		accessToken: "t",
		refreshable: false,
	});
	assert.equal(isAppActor(withToken), true);
});

test("precedence: client credentials are used only when nothing else is set", async () => {
	mockLinear({ accepted: () => new Set(["tok1"]) });
	assert.equal(authMode(env), "clientCredentials");
	assert.equal(isAppActor(env), true);
	await prepareLinearAuth({ env });
	assert.deepEqual(resolveLinearCredential(env), {
		kind: "accessToken",
		accessToken: "tok1",
		refreshable: true,
	});
});

test("no credentials at all is an error naming the variables, not a value", () => {
	assert.equal(authMode({}), null);
	assert.throws(
		() => resolveLinearCredential({}),
		(e: Error) =>
			e instanceof LinearAuthError && /LINEAR_API_KEY/.test(e.message),
	);
});

test("half of the client credentials names the missing variable", () => {
	assert.throws(
		() => getOAuthConfig({ LINEAR_CLIENT_ID: "client-id" }),
		/LINEAR_CLIENT_SECRET is not set/,
	);
	assert.throws(
		() => getOAuthConfig({ LINEAR_CLIENT_SECRET: SECRET }),
		/LINEAR_CLIENT_ID is not set/,
	);
});

test("the token request is a form-encoded client_credentials grant with the scope", async () => {
	const linear = mockLinear({ accepted: () => new Set() });
	await prepareLinearAuth({
		env: { ...env, LINEAR_OAUTH_SCOPE: "read,write,issues:create" },
	});
	const [request] = linear.tokenRequests();
	const form = new URLSearchParams(request.body);
	assert.equal(form.get("grant_type"), "client_credentials");
	assert.equal(form.get("scope"), "read,write,issues:create");
	assert.equal(form.get("client_id"), "client-id");
	assert.equal(form.get("client_secret"), SECRET);
});

test("a valid cached token is reused without a network call", async () => {
	const linear = mockLinear({ accepted: () => new Set() });
	await prepareLinearAuth({ env });
	assert.equal(linear.tokenRequests().length, 1);

	resetLinearAuth();
	await prepareLinearAuth({ env });
	assert.equal(linear.tokenRequests().length, 1, "second run hits the cache");
	assert.equal(
		(resolveLinearCredential(env) as { accessToken: string }).accessToken,
		"tok1",
	);
});

test("a token within 24h of expiry is refetched", async () => {
	const linear = mockLinear({ accepted: () => new Set() });
	writeCache("old", Date.now() + REFRESH_MARGIN_MS - 60_000);

	await prepareLinearAuth({ env });

	assert.equal(linear.tokenRequests().length, 1);
	assert.equal(
		(resolveLinearCredential(env) as { accessToken: string }).accessToken,
		"tok1",
	);
});

test("a token with more than 24h left is kept", async () => {
	const linear = mockLinear({ accepted: () => new Set() });
	writeCache("fresh", Date.now() + REFRESH_MARGIN_MS + 60 * 60 * 1000);

	await prepareLinearAuth({ env });

	assert.equal(linear.tokenRequests().length, 0);
	assert.equal(
		(resolveLinearCredential(env) as { accessToken: string }).accessToken,
		"fresh",
	);
});

test("a cached token for another client id or scope is not reused", () => {
	const config: OAuthConfig = {
		clientId: "client-id",
		clientSecret: SECRET,
		scope: DEFAULT_OAUTH_SCOPE,
	};
	writeCache("other", Date.now() + 20 * DAY, { client_id: "someone-else" });
	assert.equal(readCachedToken(config, env), undefined);
	writeCache("other", Date.now() + 20 * DAY, { scope: "read" });
	assert.equal(readCachedToken(config, env), undefined);
	writeCache("mine", Date.now() + 20 * DAY);
	assert.equal(readCachedToken(config, env), "mine");
});

test("the cache file is 0600 even under a permissive umask", async () => {
	mockLinear({ accepted: () => new Set() });
	const previous = process.umask(0);
	try {
		await prepareLinearAuth({ env });
	} finally {
		process.umask(previous);
	}
	assert.equal(statSync(cacheFile).mode & 0o777, 0o600);
	const stored = JSON.parse(readFileSync(cacheFile, "utf-8"));
	assert.equal(stored.access_token, "tok1");
	assert.equal(JSON.stringify(stored).includes(SECRET), false);
});

test("the default cache path lives under XDG_STATE_HOME, outside the repo", () => {
	const config = getOAuthConfig({
		LINEAR_CLIENT_ID: "client-id",
		LINEAR_CLIENT_SECRET: SECRET,
	}) as OAuthConfig;
	const file = tokenCachePath(config, { XDG_STATE_HOME: dir });
	assert.ok(file.startsWith(path.join(dir, "team-toon-tack")));
});

test("a 401 refetches the token once and replays the request", async () => {
	const linear = mockLinear({ accepted: () => new Set(["tok2"]) });
	await prepareLinearAuth({ env });
	resolveLinearCredential(env); // installs the fetch hook

	const response = await fetch(GRAPHQL, {
		method: "POST",
		body: JSON.stringify({ query: "{ viewer { id } }" }),
	});

	assert.equal(response.status, 200);
	assert.equal(linear.tokenRequests().length, 2, "initial token + one refetch");
	const graphql = linear.calls.filter((c) => c.url === GRAPHQL);
	assert.deepEqual(
		graphql.map((c) => c.authorization),
		["Bearer tok1", "Bearer tok2"],
	);
	assert.deepEqual(
		readCachedToken(getOAuthConfig(env) as OAuthConfig, env),
		"tok2",
	);

	// later requests keep using the refreshed token without another refetch
	await fetch(GRAPHQL, { method: "POST", body: "{}" });
	assert.equal(linear.tokenRequests().length, 2);
});

test("a second 401 fails fast without a further refetch and leaks no secret", async () => {
	const linear = mockLinear({ accepted: () => new Set() });
	await prepareLinearAuth({ env });
	resolveLinearCredential(env);

	await assert.rejects(
		fetch(GRAPHQL, { method: "POST", body: "{}" }),
		(error: Error) => {
			assert.ok(error instanceof LinearAuthError);
			assert.match(error.message, /LINEAR_CLIENT_ID/);
			assert.equal(error.message.includes(SECRET), false);
			assert.equal(/tok[12]/.test(error.message), false);
			return true;
		},
	);
	assert.equal(linear.tokenRequests().length, 2, "initial token + one refetch");
});

test("a rejected client secret errors with the variable names, not the values", async () => {
	globalThis.fetch = (async () =>
		Response.json(
			{ error: "invalid_client" },
			{ status: 401 },
		)) as typeof fetch;
	await assert.rejects(
		fetchClientCredentialsToken(getOAuthConfig(env) as OAuthConfig, { env }),
		(error: Error) => {
			assert.match(error.message, /LINEAR_CLIENT_SECRET/);
			assert.equal(error.message.includes(SECRET), false);
			return true;
		},
	);
});

test("a lenient prepare failure is reported only when a client is built", async () => {
	globalThis.fetch = (async () =>
		Response.json({}, { status: 401 })) as typeof fetch;
	await prepareLinearAuth({ env, lenient: true });
	assert.throws(() => resolveLinearCredential(env), LinearAuthError);
	await assert.rejects(prepareLinearAuth({ env }), LinearAuthError);
});

test("the fetch hook leaves other hosts alone", async () => {
	const linear = mockLinear({ accepted: () => new Set(["tok1"]) });
	await prepareLinearAuth({ env });
	resolveLinearCredential(env);

	await fetch("https://example.com/x", { headers: { Authorization: "mine" } });

	const call = linear.calls.at(-1);
	assert.equal(call?.url, "https://example.com/x");
	assert.equal(call?.authorization, "mine");
});

test("app actor: LINEAR_TTT_USER resolves an email, a user key, or an id", () => {
	const users = {
		alice: { id: "u1", email: "alice@example.com", displayName: "Alice" },
		bob: { id: "u2", email: "bob@example.com", displayName: "Bob" },
	};
	assert.deepEqual(resolveAppActorUser(users, "x@y.com"), ["x@y.com"]);
	assert.deepEqual(resolveAppActorUser(users, "bob"), ["bob@example.com"]);
	assert.deepEqual(resolveAppActorUser(users, "u1"), ["alice@example.com"]);
});

test("app actor: no configured user fails and names LINEAR_TTT_USER", () => {
	assert.throws(
		() => resolveAppActorUser({}, undefined),
		(e: Error) =>
			e instanceof LinearAuthError &&
			/LINEAR_TTT_USER/.test(e.message) &&
			/current_user/.test(e.message),
	);
	assert.throws(() => resolveAppActorUser({}, "  "), LinearAuthError);
});

test("app actor: an unknown LINEAR_TTT_USER fails instead of widening to everyone", () => {
	assert.throws(
		() => resolveAppActorUser({ a: { id: "u1", email: "a@x.com" } }, "nobody"),
		/LINEAR_TTT_USER does not match/,
	);
});
