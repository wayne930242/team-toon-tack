import { displayTaskFull } from "./lib/display.js";
import { fetchIssueDetail } from "./lib/sync.js";
import { loadCycleData } from "./utils.js";

async function getIssue() {
	const args = process.argv.slice(2);

	if (args.includes("--help") || args.includes("-h")) {
		console.log(`Usage: ttt get-issue <issue-id> [--local]

Fetch and display issue details from Linear.

Arguments:
  issue-id    Issue ID (e.g., MP-624). Required.

Options:
  --local     Only show from local cycle data, don't fetch from Linear

Examples:
  ttt get-issue MP-624         # Fetch from Linear and display
  ttt get-issue MP-624 --local # Show from local data only`);
		process.exit(0);
	}

	const localOnly = args.includes("--local");
	const issueId = args.find((arg) => !arg.startsWith("-"));

	if (!issueId) {
		console.error("Issue ID is required.");
		console.error("Usage: ttt get-issue <issue-id>");
		process.exit(1);
	}

	// If local only, get from cycle data
	if (localOnly) {
		const data = await loadCycleData();
		if (!data) {
			console.error("No cycle data found. Run ttt sync first.");
			process.exit(1);
		}

		const task = data.tasks.find(
			(t) => t.id === issueId || t.id === `MP-${issueId}`,
		);
		if (!task) {
			console.error(`Issue ${issueId} not found in local data.`);
			process.exit(1);
		}

		displayTaskFull(task, "📋");
		return;
	}

	// Fetch from Linear
	console.log(`Fetching ${issueId} from Linear...`);
	const task = await fetchIssueDetail(issueId);

	if (!task) {
		console.error(`Issue ${issueId} not found in Linear.`);
		process.exit(1);
	}

	// Check local data for local status
	const data = await loadCycleData();
	if (data) {
		const localTask = data.tasks.find((t) => t.id === issueId);
		if (localTask) {
			task.localStatus = localTask.localStatus;
		}
	}

	displayTaskFull(task, "📋");
}

getIssue().catch(console.error);
