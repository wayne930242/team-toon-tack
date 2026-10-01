import { execFileSync } from "node:child_process";

export interface CommitInfo {
	shortHash: string;
	fullHash: string;
	message: string;
	diffStat: string;
	commitUrl: string | null;
}

export interface CommitLookupOptions {
	/** Commit-ish to describe (default: HEAD of the repository). */
	ref?: string;
	/** Repository directory to read from (default: the process cwd). */
	cwd?: string;
}

function git(args: string[], cwd?: string): string {
	return execFileSync("git", args, {
		cwd,
		encoding: "utf-8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
}

function getRemoteUrl(cwd?: string): string | null {
	try {
		return git(["remote", "get-url", "origin"], cwd);
	} catch {
		return null;
	}
}

function buildCommitUrl(remoteUrl: string, fullHash: string): string | null {
	// Handle SSH or HTTPS URLs
	// git@gitlab.com:org/repo.git -> https://gitlab.com/org/repo/-/commit/hash
	// https://gitlab.com/org/repo.git -> https://gitlab.com/org/repo/-/commit/hash
	if (remoteUrl.includes("gitlab")) {
		const match = remoteUrl.match(
			/(?:git@|https:\/\/)([^:/]+)[:\\/](.+?)(?:\.git)?$/,
		);
		if (match) {
			return `https://${match[1]}/${match[2]}/-/commit/${fullHash}`;
		}
	} else if (remoteUrl.includes("github")) {
		const match = remoteUrl.match(
			/(?:git@|https:\/\/)([^:/]+)[:\\/](.+?)(?:\.git)?$/,
		);
		if (match) {
			return `https://${match[1]}/${match[2]}/commit/${fullHash}`;
		}
	}
	return null;
}

/**
 * Describe a commit. Without `ref` this is HEAD, and the diff stat is taken
 * against the working tree like before; with `ref` the stat is that commit's
 * own change (`<ref>~1..<ref>`), so a past commit can be recorded from any
 * checkout. Returns null when the commit cannot be resolved.
 */
export function getLatestCommit(
	options: CommitLookupOptions = {},
): CommitInfo | null {
	const { ref, cwd } = options;
	const target = ref ?? "HEAD";
	try {
		const fullHash = git(["rev-parse", "--verify", `${target}^{commit}`], cwd);
		const shortHash = git(["rev-parse", "--short", fullHash], cwd);
		const message = git(["log", "-1", "--format=%s", fullHash], cwd);

		// A root commit has no parent to diff against; keep the commit anyway.
		let diffStat = "";
		try {
			diffStat = git(
				ref
					? ["diff", `${fullHash}~1`, fullHash, "--stat", "--stat-width=60"]
					: ["diff", "HEAD~1", "--stat", "--stat-width=60"],
				cwd,
			);
		} catch {
			diffStat = "";
		}

		let commitUrl: string | null = null;
		const remoteUrl = getRemoteUrl(cwd);
		if (remoteUrl) {
			commitUrl = buildCommitUrl(remoteUrl, fullHash);
		}

		return { shortHash, fullHash, message, diffStat, commitUrl };
	} catch {
		return null;
	}
}

export function formatCommitLink(commit: CommitInfo): string {
	return commit.commitUrl
		? `[${commit.shortHash}](${commit.commitUrl})`
		: `\`${commit.shortHash}\``;
}

export function buildCompletionComment(
	commit: CommitInfo,
	promptMessage?: string,
): string {
	const commitLink = formatCommitLink(commit);

	const commentParts = [
		"## ✅ 開發完成",
		"",
		"### 🔧 修復說明",
		promptMessage || "_No description provided_",
		"",
		"### 📝 Commit Info",
		`**Commit:** ${commitLink}`,
		`**Message:** ${commit.message}`,
		"",
		"### 📊 Changes",
		"```",
		commit.diffStat,
		"```",
	];

	return commentParts.join("\n");
}
