/**
 * Moving a work order between machines: the order travels as a fenced TOON
 * block inside any text (a merge request description, a slip, a file).
 */
import { decode, encode } from "@toon-format/toon";
import { validateOrder } from "./model.js";
import { OrderError, type WorkOrder } from "./types.js";

/** Info string of the fence; `import` finds the block by it. */
export const ORDER_BLOCK_TAG = "toon ttt-order";

export function renderOrderBlock(order: WorkOrder): string {
	const body = encode(validateOrder(order));
	// A fence longer than any backtick run in the body cannot be closed early
	const longestRun = Math.max(
		0,
		...(body.match(/`+/g) ?? []).map((run) => run.length),
	);
	const fence = "`".repeat(Math.max(3, longestRun + 1));
	return `${fence}${ORDER_BLOCK_TAG}\n${body}\n${fence}`;
}

/** Every work order block in `text`, validated, in the order they appear. */
export function extractOrderBlocks(text: string): WorkOrder[] {
	const pattern = new RegExp(
		`^([ \\t]*)(\`{3,})${ORDER_BLOCK_TAG}[^\\n]*\\n([\\s\\S]*?)\\n[ \\t]*\\2[ \\t]*$`,
		"gm",
	);
	const orders: WorkOrder[] = [];
	for (const match of text.replace(/\r\n/g, "\n").matchAll(pattern)) {
		const [, indent, , body] = match;
		// A block quoted inside a list is indented as a whole
		const lines = body
			.split("\n")
			.map((line) =>
				line.startsWith(indent) ? line.slice(indent.length) : line,
			);
		let decoded: unknown;
		try {
			decoded = decode(lines.join("\n"), { strict: false });
		} catch (error) {
			throw new OrderError(
				`The work order block is not valid TOON: ${error instanceof Error ? error.message : error}`,
			);
		}
		orders.push(validateOrder(decoded));
	}
	return orders;
}

/** The one order to import from `text`; `id` picks among several. */
export function pickOrderBlock(text: string, id?: string): WorkOrder {
	const blocks = extractOrderBlocks(text);
	if (blocks.length === 0) {
		throw new OrderError(
			`No work order block found. Expected a fenced block starting with \`\`\`${ORDER_BLOCK_TAG}, as printed by 'ttt order export <id>'.`,
		);
	}
	const wanted = id ? blocks.filter((o) => o.id === id) : blocks;
	if (wanted.length === 0) {
		throw new OrderError(
			`No block for order ${id}; the text holds ${blocks.map((o) => o.id).join(", ")}.`,
		);
	}
	const ids = [...new Set(wanted.map((o) => o.id))];
	if (ids.length > 1) {
		throw new OrderError(
			`The text holds several work orders (${ids.join(", ")}); pick one with --id <id>.`,
		);
	}
	// The same order pasted twice: the highest revision is the current one
	return wanted.reduce((latest, o) => (o.rev >= latest.rev ? o : latest));
}
