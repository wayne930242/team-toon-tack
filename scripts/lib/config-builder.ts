import type {
	CompletionMode,
	Config,
	LabelConfig,
	LocalConfig,
	QaPmTeamConfig,
	StatusTransitions,
	TeamConfig,
	UserConfig,
} from "../utils.js";

export interface LinearTeam {
	id: string;
	name: string;
	icon?: string | null;
}

export interface LinearUser {
	id: string;
	email?: string | null;
	displayName?: string | null;
	name?: string | null;
}

export interface LinearLabel {
	id: string;
	name: string;
	color?: string | null;
}

export interface LinearState {
	id: string;
	name: string;
	type: string;
}

export interface LinearCycle {
	id: string;
	name?: string | null;
	number: number;
	startsAt?: Date | null;
	endsAt?: Date | null;
}

export function buildTeamsConfig(
	teams: LinearTeam[],
): Record<string, TeamConfig> {
	const config: Record<string, TeamConfig> = {};
	for (const team of teams) {
		const key = team.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		config[key] = {
			id: team.id,
			name: team.name,
			icon: team.icon || undefined,
		};
	}
	return config;
}

export function buildUsersConfig(
	users: LinearUser[],
): Record<string, UserConfig> {
	const config: Record<string, UserConfig> = {};
	for (const user of users) {
		const key = (
			user.displayName ||
			user.name ||
			user.email?.split("@")[0] ||
			"user"
		)
			.toLowerCase()
			.replace(/[^a-z0-9]/g, "_");
		config[key] = {
			id: user.id,
			email: user.email || "",
			displayName: user.displayName || user.name || "",
		};
	}
	return config;
}

export function buildLabelsConfig(
	labels: LinearLabel[],
): Record<string, LabelConfig> {
	const config: Record<string, LabelConfig> = {};
	for (const label of labels) {
		const key = label.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		config[key] = {
			id: label.id,
			name: label.name,
			color: label.color || undefined,
		};
	}
	return config;
}

export function buildStatusesConfig(
	states: LinearState[],
): Record<string, { name: string; type: string }> {
	const config: Record<string, { name: string; type: string }> = {};
	for (const state of states) {
		const key = state.name.toLowerCase().replace(/[^a-z0-9]/g, "_");
		config[key] = {
			name: state.name,
			type: state.type,
		};
	}
	return config;
}

// Helper to find status by keyword (case insensitive)
function findStatusByKeyword(
	states: LinearState[],
	keywords: string[],
): string | undefined {
	const lowerKeywords = keywords.map((k) => k.toLowerCase());
	return states.find((s) =>
		lowerKeywords.some((k) => s.name.toLowerCase().includes(k)),
	)?.name;
}

export function getDefaultStatusTransitions(
	states: LinearState[],
): StatusTransitions {
	const defaultTodo =
		states.find((s) => s.type === "unstarted")?.name ||
		findStatusByKeyword(states, ["todo", "pending"]) ||
		states[0]?.name ||
		"Todo";
	const defaultInProgress =
		states.find((s) => s.type === "started")?.name ||
		findStatusByKeyword(states, ["in progress", "progress"]) ||
		"In Progress";
	const defaultDone =
		states.find((s) => s.type === "completed")?.name ||
		findStatusByKeyword(states, ["done", "complete"]) ||
		"Done";
	const defaultTesting =
		findStatusByKeyword(states, ["testing", "review"]) || undefined;
	const defaultBlocked =
		findStatusByKeyword(states, ["blocked", "on hold", "waiting"]) || undefined;

	return {
		todo: defaultTodo,
		in_progress: defaultInProgress,
		done: defaultDone,
		testing: defaultTesting,
		blocked: defaultBlocked,
	};
}

export function buildConfig(
	teams: LinearTeam[],
	users: LinearUser[],
	labels: LinearLabel[],
	states: LinearState[],
	statusTransitions: StatusTransitions,
	currentCycle?: LinearCycle,
): Config {
	return {
		teams: buildTeamsConfig(teams),
		users: buildUsersConfig(users),
		labels: buildLabelsConfig(labels),
		priorities: {
			urgent: { value: 1, name: "Urgent" },
			high: { value: 2, name: "High" },
			medium: { value: 3, name: "Medium" },
			low: { value: 4, name: "Low" },
		},
		statuses: buildStatusesConfig(states),
		status_transitions: statusTransitions,
		priority_order: ["urgent", "high", "medium", "low", "none"],
		current_cycle: currentCycle
			? {
					id: currentCycle.id,
					name: currentCycle.name || `Cycle #${currentCycle.number}`,
					start_date: currentCycle.startsAt?.toISOString().split("T")[0] || "",
					end_date: currentCycle.endsAt?.toISOString().split("T")[0] || "",
				}
			: undefined,
		cycle_history: [],
	};
}

export function findUserKey(
	usersConfig: Record<string, UserConfig>,
	userId: string,
): string {
	return (
		Object.entries(usersConfig).find(([_, u]) => u.id === userId)?.[0] || "user"
	);
}

export function findTeamKey(
	teamsConfig: Record<string, TeamConfig>,
	teamId: string,
): string {
	return (
		Object.entries(teamsConfig).find(([_, t]) => t.id === teamId)?.[0] ||
		Object.keys(teamsConfig)[0]
	);
}

export function buildLocalConfig(
	currentUserKey: string,
	devTeamKey: string,
	devTestingStatus?: string,
	qaPmTeams?: QaPmTeamConfig[],
	completionMode?: CompletionMode,
	defaultLabel?: string,
	excludeLabels?: string[],
	statusSource?: "remote" | "local",
): LocalConfig {
	return {
		current_user: currentUserKey,
		team: devTeamKey,
		dev_testing_status: devTestingStatus,
		qa_pm_teams: qaPmTeams && qaPmTeams.length > 0 ? qaPmTeams : undefined,
		completion_mode: completionMode,
		label: defaultLabel,
		exclude_labels:
			excludeLabels && excludeLabels.length > 0 ? excludeLabels : undefined,
		status_source: statusSource,
	};
}
