/**
 * Trello adapter implementation
 * Wraps the TrelloClient to implement TaskSourceAdapter interface
 */

import { TrelloClient } from "../trello.js";
import {
	detectPriorityFromLabels,
	type GetIssuesOptions,
	type InitData,
	type SourceAttachment,
	type SourceComment,
	type SourceCycle,
	type SourceIssue,
	type SourceLabel,
	type SourceStatus,
	type SourceTeam,
	type SourceUser,
	type TaskSourceAdapter,
} from "./types.js";

export class TrelloAdapter implements TaskSourceAdapter {
	readonly type = "trello" as const;
	private client: TrelloClient;
	private listsCache: Map<string, { id: string; name: string }[]> = new Map();
	private membersCache: Map<
		string,
		Map<string, { id: string; email?: string; displayName: string }>
	> = new Map();

	constructor(apiKey: string, token: string) {
		this.client = new TrelloClient(apiKey, token);
	}

	async validateConnection(): Promise<boolean> {
		return this.client.validateCredentials();
	}

	async getTeams(): Promise<SourceTeam[]> {
		const boards = await this.client.getBoards();
		return boards.map((board) => ({
			id: board.id,
			name: board.name,
			icon: undefined,
		}));
	}

	async getUsers(teamId: string): Promise<SourceUser[]> {
		const members = await this.client.getBoardMembers(teamId);
		const users = members.map((member) => ({
			id: member.id,
			email: undefined, // Trello doesn't expose email in API
			displayName: member.fullName || member.username,
			avatarUrl: member.avatarUrl ?? undefined,
		}));

		// Cache members for later lookup
		const memberMap = new Map<
			string,
			{ id: string; email?: string; displayName: string }
		>();
		for (const user of users) {
			memberMap.set(user.id, user);
		}
		this.membersCache.set(teamId, memberMap);

		return users;
	}

	async getStatuses(teamId: string): Promise<SourceStatus[]> {
		const lists = await this.client.getBoardLists(teamId);
		const statuses = lists.map((list, index) => ({
			id: list.id,
			name: list.name,
			type: undefined, // Trello lists don't have type
			position: index,
		}));

		// Cache lists for status lookup
		this.listsCache.set(
			teamId,
			lists.map((l) => ({ id: l.id, name: l.name })),
		);

		return statuses;
	}

	async getLabels(teamId: string): Promise<SourceLabel[]> {
		const labels = await this.client.getBoardLabels(teamId);
		return labels
			.filter((label) => label.name) // Trello can have labels without names
			.map((label) => ({
				id: label.id,
				name: label.name,
				color: label.color ?? undefined,
			}));
	}

	async getCurrentCycle(_teamId: string): Promise<SourceCycle | null> {
		// Trello doesn't have a native cycle concept
		// Return null to indicate no cycle mode
		return null;
	}

	async getIssues(options: GetIssuesOptions): Promise<SourceIssue[]> {
		const cards = await this.client.getBoardCards(options.teamId);

		// Ensure lists are cached
		if (!this.listsCache.has(options.teamId)) {
			await this.getStatuses(options.teamId);
		}
		const lists = this.listsCache.get(options.teamId) ?? [];
		const listMap = new Map(lists.map((l) => [l.id, l.name]));

		// Ensure members are cached
		if (!this.membersCache.has(options.teamId)) {
			await this.getUsers(options.teamId);
		}
		const memberMap = this.membersCache.get(options.teamId) ?? new Map();

		const excludeLabels = new Set(options.excludeLabels ?? []);
		const issues: SourceIssue[] = [];

		for (const card of cards) {
			const listName = listMap.get(card.idList) ?? "Unknown";
			const labelNames = (card.labels ?? []).map((l) => l.name).filter(Boolean);

			// Filter by status names if specified
			if (options.statusNames && options.statusNames.length > 0) {
				if (!options.statusNames.includes(listName)) {
					continue;
				}
			}

			// Filter by labels if specified (OR logic - card must have at least one)
			if (options.labelNames && options.labelNames.length > 0) {
				if (!labelNames.some((name) => options.labelNames?.includes(name))) {
					continue;
				}
			}

			// Skip if any label is in excluded list
			if (labelNames.some((name) => excludeLabels.has(name))) {
				continue;
			}

			// Get first assignee
			const firstMemberId = card.idMembers[0];
			const assignee = firstMemberId ? memberMap.get(firstMemberId) : undefined;

			// Detect priority from labels
			const priority = detectPriorityFromLabels(labelNames);

			issues.push({
				id: card.shortLink,
				sourceId: card.id,
				title: card.name,
				description: card.desc || undefined,
				status: listName,
				statusId: card.idList,
				assigneeId: assignee?.id,
				assigneeEmail: assignee?.email,
				priority,
				labels: labelNames,
				url: card.url,
				parentIssueId: undefined, // Trello doesn't have parent concept
				branchName: undefined, // Trello doesn't have branch names
				attachments: undefined, // Loaded separately if needed
				comments: undefined, // Loaded separately if needed
			});
		}

		// Apply limit
		if (options.limit && issues.length > options.limit) {
			return issues.slice(0, options.limit);
		}

		return issues;
	}

	async getIssue(issueId: string): Promise<SourceIssue | null> {
		try {
			const card = await this.client.getCard(issueId);
			if (!card) return null;

			// Get lists for status name lookup
			if (!this.listsCache.has(card.idBoard)) {
				await this.getStatuses(card.idBoard);
			}
			const lists = this.listsCache.get(card.idBoard) ?? [];
			const listMap = new Map(lists.map((l) => [l.id, l.name]));
			const listName = listMap.get(card.idList) ?? "Unknown";

			// Get members for assignee lookup
			if (!this.membersCache.has(card.idBoard)) {
				await this.getUsers(card.idBoard);
			}
			const memberMap = this.membersCache.get(card.idBoard) ?? new Map();

			const labelNames = card.labels.map((l) => l.name).filter(Boolean);
			const firstMemberId = card.idMembers[0];
			const assignee = firstMemberId ? memberMap.get(firstMemberId) : undefined;
			const priority = detectPriorityFromLabels(labelNames);

			// Get attachments and comments
			const [attachments, comments] = await Promise.all([
				this.client.getCardAttachments(card.id),
				this.client.getCardComments(card.id),
			]);

			const sourceAttachments: SourceAttachment[] = attachments.map((a) => ({
				id: a.id,
				title: a.name,
				url: a.url,
				sourceType: a.mimeType,
			}));

			const sourceComments: SourceComment[] = comments.map((c) => ({
				id: c.id,
				body: c.data.text ?? "",
				createdAt: c.date,
				user: c.memberCreator?.fullName ?? c.memberCreator?.username,
			}));

			return {
				id: card.shortLink,
				sourceId: card.id,
				title: card.name,
				description: card.desc || undefined,
				status: listName,
				statusId: card.idList,
				assigneeId: assignee?.id,
				assigneeEmail: assignee?.email,
				priority,
				labels: labelNames,
				url: card.url,
				parentIssueId: undefined,
				branchName: undefined,
				attachments:
					sourceAttachments.length > 0 ? sourceAttachments : undefined,
				comments: sourceComments.length > 0 ? sourceComments : undefined,
			};
		} catch {
			return null;
		}
	}

	async searchIssue(identifier: string): Promise<SourceIssue | null> {
		try {
			// Try to get card directly by shortLink or id
			const card = await this.client.getCard(identifier);
			if (card) {
				return this.getIssue(card.id);
			}
		} catch {
			// Card not found by direct ID, try search
		}

		try {
			const result = await this.client.searchCards(identifier, {
				partial: true,
			});
			const matchingCard = result.cards.find(
				(c) => c.shortLink === identifier || c.id === identifier,
			);
			if (matchingCard) {
				return this.getIssue(matchingCard.id);
			}
		} catch {
			// Search failed
		}

		return null;
	}

	async updateIssueStatus(
		sourceId: string,
		statusId: string,
	): Promise<{ success: boolean; error?: string }> {
		try {
			// In Trello, updating status means moving card to a different list
			await this.client.updateCard(sourceId, { idList: statusId });
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
			await this.client.addComment(sourceId, body);
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

		const targetTeamId = teamId ?? teams[0]?.id;

		if (!targetTeamId) {
			return {
				teams: [],
				users: [],
				statuses: [],
				labels: [],
			};
		}

		const [users, statuses, labels] = await Promise.all([
			this.getUsers(targetTeamId),
			this.getStatuses(targetTeamId),
			this.getLabels(targetTeamId),
		]);

		return {
			teams,
			users,
			statuses,
			labels,
			currentCycle: undefined, // Trello has no cycle
		};
	}
}
