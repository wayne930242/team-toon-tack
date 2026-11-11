/**
 * Skill text that ships inside the package, so what an agent reads always
 * matches the installed CLI: `<package>/bundled-skills/<name>/index.md`, plus
 * one `<page>.md` per sub-page. Files are found from this module's own
 * location, never from the working directory.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PACKAGE_NAME = "team-toon-tack";
const SKILLS_DIR = "bundled-skills";
const INDEX = "index";
const NAME = /^[a-z0-9][a-z0-9-]*$/;

export interface SkillPage {
	name: string;
	description: string;
}

export interface BundledSkill {
	name: string;
	description: string;
	pages: SkillPage[];
}

export class SkillError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "SkillError";
	}
}

/** The installed package's directory: source checkout and dist alike. */
export function packageRoot(): string {
	let dir = dirname(fileURLToPath(import.meta.url));
	for (;;) {
		const manifest = join(dir, "package.json");
		if (existsSync(manifest)) {
			const { name } = JSON.parse(readFileSync(manifest, "utf8"));
			if (name === PACKAGE_NAME) return dir;
		}
		const parent = dirname(dir);
		if (parent === dir) {
			throw new SkillError(
				`Cannot find the ${PACKAGE_NAME} package directory above ${fileURLToPath(import.meta.url)}.`,
			);
		}
		dir = parent;
	}
}

export function packageVersion(): string {
	return JSON.parse(readFileSync(join(packageRoot(), "package.json"), "utf8"))
		.version;
}

/** Split `---` front matter (flat `key: value` lines) from the body. */
function parseDocument(file: string): {
	meta: Record<string, string>;
	body: string;
} {
	const text = readFileSync(file, "utf8").replace(/\r\n/g, "\n");
	const match = text.match(/^---\n([\s\S]*?)\n---\n?/);
	if (!match) {
		throw new SkillError(`${file} has no front matter.`);
	}
	const meta: Record<string, string> = {};
	for (const line of match[1].split("\n")) {
		const colon = line.indexOf(":");
		if (colon > 0)
			meta[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
	}
	if (!meta.description) {
		throw new SkillError(`${file} has no description in its front matter.`);
	}
	return { meta, body: text.slice(match[0].length).replace(/^\n+/, "") };
}

function skillDir(name: string): string {
	return join(packageRoot(), SKILLS_DIR, name);
}

function describeSkill(name: string): BundledSkill {
	const dir = skillDir(name);
	const pages = readdirSync(dir)
		.filter((file) => file.endsWith(".md") && file !== `${INDEX}.md`)
		.sort()
		.map((file) => ({
			name: file.slice(0, -".md".length),
			description: parseDocument(join(dir, file)).meta.description,
		}));
	const { meta } = parseDocument(join(dir, `${INDEX}.md`));
	return { name, description: meta.description, pages };
}

/** Every bundled skill, by name. */
export function listSkills(): BundledSkill[] {
	const root = join(packageRoot(), SKILLS_DIR);
	if (!existsSync(root)) {
		throw new SkillError(
			`This installation has no ${SKILLS_DIR} directory (${root}); reinstall ${PACKAGE_NAME}.`,
		);
	}
	return readdirSync(root, { withFileTypes: true })
		.filter(
			(entry) =>
				entry.isDirectory() &&
				existsSync(join(root, entry.name, `${INDEX}.md`)),
		)
		.map((entry) => describeSkill(entry.name))
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** The text an agent follows: a header naming version and pages, then the body. */
export function renderSkill(name: string, page?: string): string {
	const skills = listSkills();
	const skill = NAME.test(name)
		? skills.find((s) => s.name === name)
		: undefined;
	if (!skill) {
		throw new SkillError(
			`Unknown skill "${name}". Bundled skills: ${skills.map((s) => s.name).join(", ") || "none"}.`,
		);
	}
	const version = packageVersion();
	if (page === undefined) {
		const { body } = parseDocument(join(skillDir(name), `${INDEX}.md`));
		const lines = [`ttt skill ${name} (${PACKAGE_NAME} v${version})`];
		if (skill.pages.length > 0) {
			lines.push(`Pages, printed with 'ttt skill ${name} <page>':`);
			const width = Math.max(...skill.pages.map((p) => p.name.length));
			for (const p of skill.pages) {
				lines.push(`  ${p.name.padEnd(width)}  ${p.description}`);
			}
		}
		return `${lines.join("\n")}\n\n${body}`;
	}
	if (!skill.pages.some((p) => p.name === page)) {
		throw new SkillError(
			`Skill ${name} has no page "${page}". Pages: ${skill.pages.map((p) => p.name).join(", ") || "none"}.`,
		);
	}
	const { body } = parseDocument(join(skillDir(name), `${page}.md`));
	return `ttt skill ${name} ${page} (${PACKAGE_NAME} v${version})\nMain page: 'ttt skill ${name}'\n\n${body}`;
}

/** What `ttt skills` prints. */
export function renderSkillList(): string {
	const skills = listSkills();
	const lines = [
		`${PACKAGE_NAME} v${packageVersion()} bundled skills (print one with 'ttt skill <name> [page]'):`,
	];
	for (const skill of skills) {
		lines.push("", `${skill.name}  ${skill.description}`);
		for (const page of skill.pages) {
			lines.push(`  ${skill.name} ${page.name}  ${page.description}`);
		}
	}
	return lines.join("\n");
}
