/**
 * Moving a work order between machines: the order travels as a fenced TOON
 * block inside any text (a merge request description, a slip, a file).
 */
import { decode, encode } from "@toon-format/toon";
import { validateOrder, validateReturnNotice } from "./model.js";
import { OrderError, type ReturnNotice, type WorkOrder } from "./types.js";

/** Info string of the fence; `import` finds the block by it. */
export const ORDER_BLOCK_TAG = "toon ttt-order";
/**
 * Info string of a return notice. It must not start with the order tag:
 * releases before 3.14 read every "toon ttt-order…" fence as an order.
 */
export const RETURN_BLOCK_TAG = "toon ttt-return";

function renderBlock(tag: string, body: string): string {
	// A fence longer than any backtick run in the body cannot be closed early
	const longestRun = Math.max(
		0,
		...(body.match(/`+/g) ?? []).map((run) => run.length),
	);
	const fence = "`".repeat(Math.max(3, longestRun + 1));
	return `${fence}${tag}\n${body}\n${fence}`;
}

export function renderOrderBlock(order: WorkOrder): string {
	return renderBlock(ORDER_BLOCK_TAG, encode(validateOrder(order)));
}

export function renderReturnBlock(notice: ReturnNotice): string {
	return renderBlock(RETURN_BLOCK_TAG, encode(validateReturnNotice(notice)));
}

/** The decoded body of every block tagged `tag`, in the order they appear. */
function decodeBlocks(text: string, tag: string, what: string): unknown[] {
	const pattern = new RegExp(
		`^([ \\t]*)(\`{3,})${tag}[^\\n]*\\n([\\s\\S]*?)\\n[ \\t]*\\2[ \\t]*$`,
		"gm",
	);
	const decoded: unknown[] = [];
	for (const match of text.replace(/\r\n/g, "\n").matchAll(pattern)) {
		const [, indent, , body] = match;
		// A block quoted inside a list is indented as a whole
		const lines = body
			.split("\n")
			.map((line) =>
				line.startsWith(indent) ? line.slice(indent.length) : line,
			);
		try {
			decoded.push(decode(lines.join("\n"), { strict: true }));
		} catch (error) {
			throw new OrderError(
				`The ${what} block is not valid TOON: ${error instanceof Error ? error.message : error}`,
			);
		}
	}
	return decoded;
}

/** Every work order block in `text`, validated, in the order they appear. */
export function extractOrderBlocks(text: string): WorkOrder[] {
	return decodeBlocks(text, ORDER_BLOCK_TAG, "work order").map(validateOrder);
}

/** Every return notice in `text`, validated, in the order they appear. */
export function extractReturnNotices(text: string): ReturnNotice[] {
	return decodeBlocks(text, RETURN_BLOCK_TAG, "return notice").map(
		validateReturnNotice,
	);
}

export interface TransferBlocks {
	orders: WorkOrder[];
	returns: ReturnNotice[];
}

/** Every order block and return notice in `text`. */
export function readBlocks(text: string): TransferBlocks {
	const read = (source: string): TransferBlocks => ({
		orders: extractOrderBlocks(source),
		returns: extractReturnNotices(source),
	});
	const blocks = read(text);
	// Some writers (a git push option, a one-line API body) store the newlines
	// of a description as <br>; read such a text as if they were newlines
	if (
		blocks.orders.length === 0 &&
		blocks.returns.length === 0 &&
		/<br\s*\/?>/i.test(text)
	) {
		return read(text.replace(/<br\s*\/?>/gi, "\n"));
	}
	return blocks;
}

/** The one order to import from `text`; `id` picks among several. */
export function pickOrderBlock(text: string, id?: string): WorkOrder {
	const blocks = readBlocks(text).orders;
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
