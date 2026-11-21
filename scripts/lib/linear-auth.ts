/**
 * Linear authentication.
 *
 * Precedence (first one set wins):
 *   1. LINEAR_API_KEY        personal API key (unchanged behavior)
 *   2. LINEAR_ACCESS_TOKEN   a ready OAuth access token
 *   3. LINEAR_CLIENT_ID + LINEAR_CLIENT_SECRET (+ LINEAR_OAUTH_SCOPE)
 *                            OAuth app, client_credentials grant, actor=app
 *
 * The client_credentials token is cached in a 0600 file outside the repo and
 * reused until it is within 24h of expiry. A 401 from Linear refetches the
 * token once; a second 401 fails fast. Tokens and secrets are never printed:
 * errors name the variable, not the value.
 */

import { createHash, randomBytes } from "node:crypto";
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { LinearClient } from "@linear/sdk";

export const ENV_API_KEY = "LINEAR_API_KEY";
export const ENV_ACCESS_TOKEN = "LINEAR_ACCESS_TOKEN";
export const ENV_CLIENT_ID = "LINEAR_CLIENT_ID";
export const ENV_CLIENT_SECRET = "LINEAR_CLIENT_SECRET";
export const ENV_OAUTH_SCOPE = "LINEAR_OAUTH_SCOPE";
export const ENV_TOKEN_CACHE = "LINEAR_OAUTH_TOKEN_CACHE";
export const ENV_TTT_USER = "LINEAR_TTT_USER";

export const DEFAULT_OAUTH_SCOPE = "read,write";
export const LINEAR_TOKEN_URL = "https://api.linear.app/oauth/token";
const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
/** Refetch a cached token once it is closer than this to expiry. */
export const REFRESH_MARGIN_MS = 24 * 60 * 60 * 1000;

type Env = Record<string, string | undefined>;
type FetchFn = typeof fetch;

export class LinearAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "LinearAuthError";
	}
}

export interface OAuthConfig {
	clientId: string;
	clientSecret: string;
	scope: string;
}

export type LinearCredential =
	| { kind: "apiKey"; apiKey: string }
	| { kind: "accessToken"; accessToken: string; refreshable: boolean };

interface CachedToken {
	access_token: string;
	issued_at: number;
	expires_at: number;
	client_id: string;
	scope: string;
}

/** The OAuth app config from env, or null when no client credentials are set. */
export function getOAuthConfig(env: Env = process.env): OAuthConfig | null {
	const clientId = env[ENV_CLIENT_ID];
	const clientSecret = env[ENV_CLIENT_SECRET];
	if (!clientId && !clientSecret) return null;
	if (!clientId || !clientSecret) {
		throw new LinearAuthError(
			`${!clientId ? ENV_CLIENT_ID : ENV_CLIENT_SECRET} is not set. ` +
				`OAuth client credentials need both ${ENV_CLIENT_ID} and ${ENV_CLIENT_SECRET}.`,
		);
	}
	return {
		clientId,
		clientSecret,
		scope: env[ENV_OAUTH_SCOPE] || DEFAULT_OAUTH_SCOPE,
	};
}

/** Which source the credential comes from; null when none is configured. */
export function authMode(
	env: Env = process.env,
): "apiKey" | "accessToken" | "clientCredentials" | null {
	if (env[ENV_API_KEY]) return "apiKey";
	if (env[ENV_ACCESS_TOKEN]) return "accessToken";
	if (env[ENV_CLIENT_ID] || env[ENV_CLIENT_SECRET]) return "clientCredentials";
	return null;
}

/**
 * True when requests run as an OAuth app (or an externally issued OAuth
 * token, which is assumed to be one): `viewer` is then the app, not a person.
 */
export function isAppActor(env: Env = process.env): boolean {
	const mode = authMode(env);
	return mode === "accessToken" || mode === "clientCredentials";
}

export function tokenCachePath(
	config: OAuthConfig,
	env: Env = process.env,
): string {
	const override = env[ENV_TOKEN_CACHE];
	if (override) return override;
	const stateHome = env.XDG_STATE_HOME || join(homedir(), ".local", "state");
	const key = createHash("sha256")
		.update(`${config.clientId}\n${config.scope}`)
		.digest("hex")
		.slice(0, 16);
	return join(stateHome, "team-toon-tack", `linear-oauth-${key}.json`);
}

/** A cached token still good for this config, or undefined. */
export function readCachedToken(
	config: OAuthConfig,
	env: Env = process.env,
	now: number = Date.now(),
): string | undefined {
	let parsed: Partial<CachedToken>;
	try {
		parsed = JSON.parse(readFileSync(tokenCachePath(config, env), "utf-8"));
	} catch {
		return undefined;
	}
	if (
		typeof parsed.access_token !== "string" ||
		typeof parsed.expires_at !== "number" ||
		parsed.client_id !== config.clientId ||
		parsed.scope !== config.scope
	) {
		return undefined;
	}
	const lifetime = parsed.expires_at - (parsed.issued_at ?? now);
	// Short-lived tokens are reused for half their life instead of never.
	const margin = Math.min(REFRESH_MARGIN_MS, Math.max(0, lifetime) / 2);
	if (now >= parsed.expires_at - margin) return undefined;
	return parsed.access_token;
}

function writeCachedToken(
	config: OAuthConfig,
	env: Env,
	token: string,
	issuedAt: number,
	expiresInSeconds: number,
): void {
	const file = tokenCachePath(config, env);
	const entry: CachedToken = {
		access_token: token,
		issued_at: issuedAt,
		expires_at: issuedAt + expiresInSeconds * 1000,
		client_id: config.clientId,
		scope: config.scope,
	};
	mkdirSync(dirname(file), { recursive: true, mode: 0o700 });
	const tmp = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
	// wx: never follow or reuse a file someone else created at this path.
	writeFileSync(tmp, JSON.stringify(entry), { mode: 0o600, flag: "wx" });
	chmodSync(tmp, 0o600);
	renameSync(tmp, file);
}

/** Request a client_credentials token and cache it. */
export async function fetchClientCredentialsToken(
	config: OAuthConfig,
	options: { env?: Env; fetch?: FetchFn; now?: () => number } = {},
): Promise<string> {
	const env = options.env ?? process.env;
	const fetchFn = options.fetch ?? underlyingFetch();
	const now = options.now ?? Date.now;
	const body = new URLSearchParams({
		grant_type: "client_credentials",
		scope: config.scope,
		client_id: config.clientId,
		client_secret: config.clientSecret,
	});
	let response: Response;
	try {
		response = await fetchFn(LINEAR_TOKEN_URL, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body,
		});
	} catch (error) {
		throw new LinearAuthError(
			`Could not reach Linear to fetch an OAuth token: ${error instanceof Error ? error.message : "request failed"}`,
		);
	}
	let payload: { access_token?: unknown; expires_in?: unknown } = {};
	try {
		payload = (await response.json()) as typeof payload;
	} catch {
		// handled below by the shape check
	}
	if (!response.ok) {
		throw new LinearAuthError(
			`Linear rejected the OAuth client credentials (HTTP ${response.status}). ` +
				`Check ${ENV_CLIENT_ID}, ${ENV_CLIENT_SECRET} and ${ENV_OAUTH_SCOPE}, and that the app has Client credentials enabled.`,
		);
	}
	if (
		typeof payload.access_token !== "string" ||
		!payload.access_token ||
		typeof payload.expires_in !== "number"
	) {
		throw new LinearAuthError(
			"Linear's OAuth token response had no access_token or expires_in.",
		);
	}
	try {
		writeCachedToken(
			config,
			env,
			payload.access_token,
			now(),
			payload.expires_in,
		);
	} catch (error) {
		// The token is still good for this run; only the cache failed.
		console.warn(
			`Warning: could not cache the Linear OAuth token (${error instanceof Error && "code" in error ? String(error.code) : "write failed"}); set ${ENV_TOKEN_CACHE} to a writable path.`,
		);
	}
	return payload.access_token;
}

// --- module state: the active client_credentials token and fetch hook -------

let activeToken: string | undefined;
/** Authorization header values this module handed to a LinearClient. */
const issuedTokens = new Set<string>();
let prepareError: LinearAuthError | undefined;
let refreshInFlight: Promise<string> | undefined;
let installedFetch: typeof globalThis.fetch | undefined;
let originalFetch: typeof globalThis.fetch | undefined;

function underlyingFetch(): FetchFn {
	return originalFetch ?? globalThis.fetch;
}

/** Forget cached state and restore fetch. For tests. */
export function resetLinearAuth(): void {
	activeToken = undefined;
	issuedTokens.clear();
	prepareError = undefined;
	refreshInFlight = undefined;
	if (originalFetch && globalThis.fetch === installedFetch) {
		globalThis.fetch = originalFetch;
	}
	installedFetch = undefined;
	originalFetch = undefined;
}

function isLinearGraphql(input: RequestInfo | URL): boolean {
	const url =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url;
	return url.startsWith(LINEAR_GRAPHQL_URL);
}

function withBearer(init: RequestInit | undefined, token: string): RequestInit {
	const headers = new Headers(init?.headers);
	headers.set("Authorization", `Bearer ${token}`);
	return { ...init, headers };
}

function refreshToken(config: OAuthConfig, env: Env): Promise<string> {
	refreshInFlight ??= fetchClientCredentialsToken(config, { env })
		.then((token) => {
			activeToken = token;
			return token;
		})
		.finally(() => {
			refreshInFlight = undefined;
		});
	return refreshInFlight;
}

/**
 * The Linear SDK calls globalThis.fetch with a fixed Authorization header and
 * has no hook for retries, so the client_credentials mode wraps fetch for
 * Linear's GraphQL endpoint only: it sends the current token, and on a 401
 * refetches the token once and replays the request.
 */
function installAuthFetch(config: OAuthConfig, env: Env): void {
	if (installedFetch) return;
	const base = globalThis.fetch;
	originalFetch = base;
	const wrapped = (async (input: RequestInfo | URL, init?: RequestInit) => {
		if (!isLinearGraphql(input) || !activeToken) return base(input, init);
		// Only requests carrying a token this module issued; other clients pass through.
		const sent = new Headers(init?.headers).get("Authorization");
		if (sent !== `Bearer ${activeToken}` && !issuedTokens.has(sent ?? "")) {
			return base(input, init);
		}
		const first = await base(input, withBearer(init, activeToken));
		if (first.status !== 401) return first;
		await first.body?.cancel().catch(() => {});
		const token = await refreshToken(config, env);
		const second = await base(input, withBearer(init, token));
		if (second.status === 401) {
			throw new LinearAuthError(
				`Linear still rejected the OAuth token after a refresh. Check ${ENV_CLIENT_ID}, ${ENV_CLIENT_SECRET} and ${ENV_OAUTH_SCOPE}.`,
			);
		}
		return second;
	}) as typeof globalThis.fetch;
	installedFetch = wrapped;
	globalThis.fetch = wrapped;
}

/**
 * Make a client_credentials token available (cache hit, else fetch). A no-op
 * for the other modes. With `lenient`, a failure is kept and thrown later by
 * resolveLinearCredential, so commands that never touch Linear still run.
 */
export async function prepareLinearAuth(
	options: { env?: Env; lenient?: boolean } = {},
): Promise<void> {
	const env = options.env ?? process.env;
	if (authMode(env) !== "clientCredentials") return;
	try {
		const config = getOAuthConfig(env);
		if (!config) return;
		activeToken =
			readCachedToken(config, env) ??
			(await fetchClientCredentialsToken(config, { env }));
		prepareError = undefined;
	} catch (error) {
		if (!options.lenient || !(error instanceof LinearAuthError)) throw error;
		prepareError = error;
	}
}

/** The credential to build a LinearClient from. Throws LinearAuthError. */
export function resolveLinearCredential(
	env: Env = process.env,
): LinearCredential {
	const mode = authMode(env);
	if (mode === "apiKey") {
		return { kind: "apiKey", apiKey: env[ENV_API_KEY] as string };
	}
	if (mode === "accessToken") {
		return {
			kind: "accessToken",
			accessToken: env[ENV_ACCESS_TOKEN] as string,
			refreshable: false,
		};
	}
	if (mode === "clientCredentials") {
		if (prepareError) throw prepareError;
		const config = getOAuthConfig(env) as OAuthConfig;
		const token = activeToken ?? readCachedToken(config, env);
		if (!token) {
			throw new LinearAuthError(
				"No OAuth access token is available yet: run through the ttt CLI, or await prepareLinearAuth() first.",
			);
		}
		activeToken = token;
		issuedTokens.add(`Bearer ${token}`);
		installAuthFetch(config, env);
		return { kind: "accessToken", accessToken: token, refreshable: true };
	}
	throw new LinearAuthError(
		`No Linear credentials: set ${ENV_API_KEY}, or ${ENV_ACCESS_TOKEN}, or ${ENV_CLIENT_ID} and ${ENV_CLIENT_SECRET}.`,
	);
}

/** A LinearClient for whichever credential is configured. */
export function createLinearClient(env: Env = process.env): LinearClient {
	const credential = resolveLinearCredential(env);
	return credential.kind === "apiKey"
		? new LinearClient({ apiKey: credential.apiKey })
		: new LinearClient({ accessToken: credential.accessToken });
}

interface UserEntry {
	id?: string;
	email?: string;
	displayName?: string;
}

/**
 * Which user "me" means when the actor is an app. `value` is
 * LINEAR_TTT_USER: an email, a user key from config.toon, or a Linear user id.
 */
export function resolveAppActorUser(
	users: Record<string, UserEntry>,
	value: string | undefined,
): string[] {
	const wanted = value?.trim();
	if (!wanted) {
		throw new LinearAuthError(
			`Authenticated as a Linear OAuth app, so "me" has no person behind it. ` +
				`Set current_user in local.toon (ttt init) or ${ENV_TTT_USER} to a user email, key or id.`,
		);
	}
	if (wanted.includes("@")) return [wanted];
	const lower = wanted.toLowerCase();
	const match =
		users[wanted] ??
		Object.values(users).find(
			(u) => u.id === wanted || u.displayName?.toLowerCase() === lower,
		);
	if (match?.email) return [match.email];
	throw new LinearAuthError(
		`${ENV_TTT_USER} does not match a user with an email in config.toon. Use an email address, or a user key or id that has one.`,
	);
}
