import type { Task } from "../utils.js";

export const PRIORITY_LABELS: Record<number, string> = {
	0: "⚪ None",
	1: "🔴 Urgent",
	2: "🟠 High",
	3: "🟡 Medium",
	4: "🟢 Low",
};

export function getStatusIcon(localStatus: Task["localStatus"]): string {
	switch (localStatus) {
		case "completed":
			return "✅";
		case "in-progress":
			return "🔄";
		case "blocked-backend":
			return "🚫";
		default:
			return "📋";
	}
}

export function displayTaskHeader(task: Task, icon?: string): void {
	const separator = "═".repeat(50);
	console.log(`\n${separator}`);
	console.log(
		`${icon || getStatusIcon(task.localStatus)} ${task.id}: ${task.title}`,
	);
	console.log(separator);
}

export function displayTaskInfo(task: Task): void {
	console.log(`Priority: ${PRIORITY_LABELS[task.priority] || "None"}`);
	console.log(`Labels: ${task.labels.join(", ")}`);
	if (task.assignee) console.log(`Assignee: ${task.assignee}`);
	console.log(`Branch: ${task.branch || "N/A"}`);
	if (task.url) console.log(`URL: ${task.url}`);
}

export function displayTaskStatus(task: Task): void {
	console.log(`\nStatus:`);
	console.log(`  Local: ${task.localStatus}`);
	console.log(`  Linear: ${task.status}`);
}

export function displayTaskDescription(task: Task): void {
	if (task.description) {
		console.log(`\n📝 Description:\n${task.description}`);
	}
}

export function displayTaskAttachments(task: Task): void {
	if (task.attachments && task.attachments.length > 0) {
		console.log(`\n📎 Attachments:`);
		for (const att of task.attachments) {
			console.log(`   - ${att.title}: ${att.url}`);
		}
	}
}

export function displayTaskComments(task: Task): void {
	if (task.comments && task.comments.length > 0) {
		console.log(`\n💬 Comments (${task.comments.length}):`);
		for (const comment of task.comments) {
			const date = new Date(comment.createdAt).toLocaleDateString();
			console.log(`\n   [${comment.user || "Unknown"} - ${date}]`);
			const lines = comment.body.split("\n");
			for (const line of lines) {
				console.log(`   ${line}`);
			}
		}
	}
}

export function displayTaskFooter(): void {
	console.log(`\n${"─".repeat(50)}`);
}

export function displayTaskFull(task: Task, icon?: string): void {
	displayTaskHeader(task, icon);
	displayTaskInfo(task);
	displayTaskDescription(task);
	displayTaskAttachments(task);
	displayTaskComments(task);
	displayTaskFooter();
}

export function displayTaskWithStatus(task: Task): void {
	displayTaskHeader(task);
	displayTaskStatus(task);
	console.log(`\nInfo:`);
	console.log(`  Priority: ${PRIORITY_LABELS[task.priority] || "None"}`);
	console.log(`  Labels: ${task.labels.join(", ")}`);
	console.log(`  Assignee: ${task.assignee || "Unassigned"}`);
	console.log(`  Branch: ${task.branch || "N/A"}`);
	if (task.url) console.log(`  URL: ${task.url}`);
	displayTaskDescription(task);
	displayTaskAttachments(task);
	displayTaskComments(task);
	displayTaskFooter();
}
