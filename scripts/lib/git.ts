import { execSync } from "node:child_process";

export interface CommitInfo {
	shortHash: string;
	fullHash: string;
	message: string;
	diffStat: string;
	commitUrl: string | null;
}

function getRemoteUrl(): string | null {
	try {
		return execSync("git remote get-url origin", {
			encoding: "utf-8",
		}).trim();
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

export function getLatestCommit(): CommitInfo | null {
	try {
		const shortHash = execSync("git rev-parse --short HEAD", {
			encoding: "utf-8",
		}).trim();
		const fullHash = execSync("git rev-parse HEAD", {
			encoding: "utf-8",
		}).trim();
		const message = execSync("git log -1 --format=%s", {
			encoding: "utf-8",
		}).trim();
		const diffStat = execSync("git diff HEAD~1 --stat --stat-width=60", {
			encoding: "utf-8",
		}).trim();

		let commitUrl: string | null = null;
		const remoteUrl = getRemoteUrl();
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
	aiMessage?: string,
): string {
	const commitLink = formatCommitLink(commit);

	const commentParts = [
		"## ✅ 開發完成",
		"",
		"### 🤖 AI 修復說明",
		aiMessage || "_No description provided_",
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
