/**
 * Done module exports
 */

export {
	handleAdapterCompletion,
	handleAdapterCompletion as handleTrelloCompletion,
} from "./adapter-handler.js";
export { parseArgs, printHelp } from "./args.js";
export { handleCompletion } from "./handler.js";
export { handleLinearCompletion } from "./linear-handler.js";
export { updateParentStatus, updateParentToTesting } from "./parent-issue.js";
export * from "./types.js";
