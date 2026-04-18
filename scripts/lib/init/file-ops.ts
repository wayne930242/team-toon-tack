/**
 * File operations for init
 */

import fs from "node:fs/promises";
import { confirm } from "@inquirer/prompts";

export async function updateGitignore(
	tttDir: string,
	interactive: boolean,
): Promise<void> {
	const gitignorePath = ".gitignore";
	const tttEntry = `${tttDir}/`;
	const envEntry = ".env";

	try {
		let content = "";
		let exists = false;

		try {
			content = await fs.readFile(gitignorePath, "utf-8");
			exists = true;
		} catch {
			// .gitignore doesn't exist
		}

		const lines = content.split("\n").map((l) => l.trim());
		const hasTtt = lines.some(
			(line) =>
				line === tttEntry ||
				line === tttDir ||
				line === `/${tttEntry}` ||
				line === `/${tttDir}`,
		);
		const hasEnv = lines.some((line) => line === envEntry || line === "/.env");

		const toAdd: string[] = [];
		if (!hasTtt) toAdd.push(tttEntry);
		if (!hasEnv) toAdd.push(envEntry);

		if (toAdd.length === 0) return;

		if (interactive) {
			const addToGitignore = await confirm({
				message: `Add ${toAdd.join(" and ")} to .gitignore?`,
				default: true,
			});
			if (!addToGitignore) return;
		}

		const suffix = `${toAdd.join("\n")}\n`;
		const newContent = exists
			? content.endsWith("\n")
				? `${content}${suffix}`
				: `${content}\n${suffix}`
			: suffix;

		await fs.writeFile(gitignorePath, newContent, "utf-8");
		for (const entry of toAdd) {
			console.log(`  ✓ Added ${entry} to .gitignore`);
		}
	} catch (_error) {
		// Silently ignore gitignore errors
	}
}

export function showPluginInstallInstructions(): void {
	console.log("\n🤖 Claude Code Plugin:");
	console.log(
		"┌─────────────────────────────────────────────────────────────┐",
	);
	console.log("│  Install team-toon-tack plugin in Claude Code:             │");
	console.log(
		"├─────────────────────────────────────────────────────────────┤",
	);
	console.log(
		"│                                                             │",
	);
	console.log(
		"│  1. Add marketplace:                                        │",
	);
	console.log(
		"│     /plugin marketplace add wayne930242/team-toon-tack      │",
	);
	console.log(
		"│                                                             │",
	);
	console.log(
		"│  2. Install plugin:                                         │",
	);
	console.log(
		"│     /plugin install team-toon-tack@wayne930242              │",
	);
	console.log(
		"│                                                             │",
	);
	console.log(
		"│  Available commands after install:                          │",
	);
	console.log(
		"│     /ttt:sync        - Sync Linear issues                   │",
	);
	console.log(
		"│     /ttt:work-on     - Start working on a task              │",
	);
	console.log(
		"│     /ttt:done        - Complete current task                │",
	);
	console.log(
		"│     /ttt:status      - Show/modify task status              │",
	);
	console.log(
		"│     /ttt:show        - Show/search issues                   │",
	);
	console.log(
		"│                                                             │",
	);
	console.log(
		"└─────────────────────────────────────────────────────────────┘",
	);
}
