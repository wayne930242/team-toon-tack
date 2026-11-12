/**
 * Source dispatch for task completion, shared by `ttt done` and
 * `ttt order close` so both apply the same completion mode and parent rules
 */
import { getSourceType } from "../../utils.js";
import { handleAdapterCompletion } from "./adapter-handler.js";
import { handleLinearCompletion } from "./linear-handler.js";
import type { CompletionContext, CompletionResult } from "./types.js";

export function handleCompletion(
	context: CompletionContext,
): Promise<CompletionResult> {
	return getSourceType(context.config) === "linear"
		? handleLinearCompletion(context)
		: handleAdapterCompletion(context);
}
