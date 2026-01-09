/**
 * Linear adapter implementation
 * Wraps the @linear/sdk to implement TaskSourceAdapter interface
 */

import { LinearClient } from "@linear/sdk";
import type {
	GetIssuesOptions,
	InitData,
	SourceAttachment,
	SourceComment,
	SourceCycle,
	SourceIssue,
	SourceLabel,
	SourceStatus,
	SourceTeam,
	SourceUser,
	TaskSourceAdapter,
} from "./types.js";

export class LinearAdapter implements TaskSourceAdapter {
	readonly type = "linear" as const;
	private client: LinearClient;

	constructor() {
		const apiKey = process.env.LINEAR_API_KEY;
		if (!apiKey) {
			throw new Error(
				"LINEAR_API_KEY environment variable is not set. " +
					'Set it in your shell: export LINEAR_API_KEY="lin_api_xxxxx"',
			);
		}
		this.client = new LinearClient({ apiKey });
	}

	async validateConnection(): Promise<boolean> {
		try {
			await this.client.viewer;
			return true;
		} catch {
			return false;
		}
	}

	async getTeams(): Promise<SourceTeam[]> {
		const teamsData = await this.client.teams();
		return teamsData.nodes.map((team) => ({
			id: team.id,
			name: team.name,
			icon: team.icon ?? undefined,
		}));
	}

	async getUsers(teamId: string): Promise<SourceUser[]> {
		const team = await this.client.team(teamId);
		const members = await team.members();
		return members.nodes.map((user) => ({
			id: user.id,
			email: user.email ?? undefined,
			displayName: user.displayName || user.name,
			avatarUrl: user.avatarUrl ?? undefined,
		}));
	}

	async getStatuses(teamId: string): Promise<SourceStatus[]> {
		const statesData = await this.client.workflowStates({
			filter: { team: { id: { eq: teamId } } },
		});
		return statesData.nodes.map((state, index) => ({
			id: state.id,
			name: state.name,
			type: state.type,
			position: index,
		}));
	}

	async getLabels(teamId: string): Promise<SourceLabel[]> {
		const labelsData = await this.client.issueLabels({
			filter: { team: { id: { eq: teamId } } },
		});
		return labelsData.nodes.map((label) => ({
			id: label.id,
			name: label.name,
			color: label.color ?? undefined,
		}));
	}

	async getCurrentCycle(teamId: string): Promise<SourceCycle | null> {
		const team = await this.client.team(teamId);
		const activeCycle = await team.activeCycle;

		if (!activeCycle) {
			return null;
		}

		return {
			id: activeCycle.id,
			name: activeCycle.name ?? `Cycle #${activeCycle.number}`,
			startDate: activeCycle.startsAt?.toISOString().split("T")[0],
			endDate: activeCycle.endsAt?.toISOString().split("T")[0],
		};
	}

	async getIssues(options: GetIssuesOptions): Promise<SourceIssue[]> {
		const filter: Record<string, unknown> = {
			team: { id: { eq: options.teamId } },
		};

		if (options.cycleId) {
			filter.cycle = { id: { eq: options.cycleId } };
		}

		if (options.statusNames && options.statusNames.length > 0) {
			filter.state = { name: { in: options.statusNames } };
		}

		if (options.labelNames && options.labelNames.length > 0) {
			filter.labels = { name: { in: options.labelNames } };
		}

		if (options.assigneeEmail) {
			filter.assignee = { email: { eq: options.assigneeEmail } };
		}

		const issuesData = await this.client.issues({
			filter,
			first: options.limit ?? 50,
		});

		const issues: SourceIssue[] = [];
		const excludeLabels = new Set(options.excludeLabels ?? []);

		for (const issue of issuesData.nodes) {
			const state = await issue.state;
			const assignee = await issue.assignee;
			const labels = await issue.labels();
			const labelNames = labels.nodes.map((l) => l.name);

			// Skip if any label is in excluded list
			if (labelNames.some((name) => excludeLabels.has(name))) {
				continue;
			}

			const parent = await issue.parent;
			const attachmentsData = await issue.attachments();
			const commentsData = await issue.comments();

			const attachments: SourceAttachment[] = attachmentsData.nodes.map(
				(a) => ({
					id: a.id,
					title: a.title,
					url: a.url,
					sourceType: a.sourceType ?? undefined,
				}),
			);

			const comments: SourceComment[] = await Promise.all(
				commentsData.nodes.map(async (c) => {
					const user = await c.user;
					return {
						id: c.id,
						body: c.body,
						createdAt: c.createdAt.toISOString(),
						user: user?.displayName ?? user?.email,
					};
				}),
			);

			issues.push({
				id: issue.identifier,
				sourceId: issue.id,
				title: issue.title,
				description: issue.description ?? undefined,
				status: state?.name ?? "Unknown",
				statusId: state?.id ?? "",
				assigneeId: assignee?.id,
				assigneeEmail: assignee?.email ?? undefined,
				priority: issue.priority,
				labels: labelNames,
				url: issue.url,
				parentIssueId: parent?.identifier,
				branchName: issue.branchName,
				attachments: attachments.length > 0 ? attachments : undefined,
				comments: comments.length > 0 ? comments : undefined,
			});
		}

		return issues;
	}

	async getIssue(issueId: string): Promise<SourceIssue | null> {
		try {
			const issue = await this.client.issue(issueId);
			if (!issue) return null;

			const state = await issue.state;
			const assignee = await issue.assignee;
			const labels = await issue.labels();
			const labelNames = labels.nodes.map((l) => l.name);
			const parent = await issue.parent;
			const attachmentsData = await issue.attachments();
			const commentsData = await issue.comments();

			const attachments: SourceAttachment[] = attachmentsData.nodes.map(
				(a) => ({
					id: a.id,
					title: a.title,
					url: a.url,
					sourceType: a.sourceType ?? undefined,
				}),
			);

			const comments: SourceComment[] = await Promise.all(
				commentsData.nodes.map(async (c) => {
					const user = await c.user;
					return {
						id: c.id,
						body: c.body,
						createdAt: c.createdAt.toISOString(),
						user: user?.displayName ?? user?.email,
					};
				}),
			);

			return {
				id: issue.identifier,
				sourceId: issue.id,
				title: issue.title,
				description: issue.description ?? undefined,
				status: state?.name ?? "Unknown",
				statusId: state?.id ?? "",
				assigneeId: assignee?.id,
				assigneeEmail: assignee?.email ?? undefined,
				priority: issue.priority,
				labels: labelNames,
				url: issue.url,
				parentIssueId: parent?.identifier,
				branchName: issue.branchName,
				attachments: attachments.length > 0 ? attachments : undefined,
				comments: comments.length > 0 ? comments : undefined,
			};
		} catch {
			return null;
		}
	}

	async searchIssue(identifier: string): Promise<SourceIssue | null> {
		try {
			const searchResult = await this.client.searchIssues(identifier);
			const matchingIssue = searchResult.nodes.find(
				(i) => i.identifier === identifier,
			);

			if (!matchingIssue) {
				return null;
			}

			return this.getIssue(matchingIssue.id);
		} catch {
			return null;
		}
	}

	async updateIssueStatus(
		sourceId: string,
		statusId: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			await this.client.updateIssue(sourceId, { stateId: statusId });
			return { success: true };
		} catch (e) {
			return {
				success: false,
				error: e instanceof Error ? e.message : "Unknown error",
			};
		}
	}

	async addComment(
		sourceId: string,
		body: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			await this.client.createComment({ issueId: sourceId, body });
			return { success: true };
		} catch (e) {
			return {
				success: false,
				error: e instanceof Error ? e.message : "Unknown error",
			};
		}
	}

	async getInitData(teamId?: string): Promise<InitData> {
		const teams = await this.getTeams();

		// If no teamId specified, get data from all teams
		const targetTeamId = teamId ?? teams[0]?.id;

		if (!targetTeamId) {
			return {
				teams: [],
				users: [],
				statuses: [],
				labels: [],
			};
		}

		// Collect users from all teams
		const allUsers: SourceUser[] = [];
		const seenUserIds = new Set<string>();

		for (const team of teams) {
			try {
				const teamUsers = await this.getUsers(team.id);
				for (const user of teamUsers) {
					if (!seenUserIds.has(user.id)) {
						seenUserIds.add(user.id);
						allUsers.push(user);
					}
				}
			} catch {
				// Skip teams we can't access
			}
		}

		const statuses = await this.getStatuses(targetTeamId);
		const labels = await this.getLabels(targetTeamId);
		const currentCycle = await this.getCurrentCycle(targetTeamId);

		return {
			teams,
			users: allUsers,
			statuses,
			labels,
			currentCycle: currentCycle ?? undefined,
		};
	}
}
