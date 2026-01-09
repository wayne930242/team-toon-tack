/**
 * Trello REST API Client
 * Low-level wrapper for Trello API calls
 */

const BASE_URL = "https://api.trello.com/1";

// ============================================
// Trello API Types
// ============================================

export interface TrelloBoard {
	id: string;
	name: string;
	desc: string;
	url: string;
	shortUrl: string;
	closed: boolean;
	idOrganization?: string;
}

export interface TrelloList {
	id: string;
	name: string;
	closed: boolean;
	pos: number;
	idBoard: string;
}

export interface TrelloCard {
	id: string;
	name: string;
	desc: string;
	url: string;
	shortUrl: string;
	shortLink: string;
	closed: boolean;
	pos: number;
	due?: string | null;
	dueComplete: boolean;
	idBoard: string;
	idList: string;
	idMembers: string[];
	idLabels: string[];
	labels: TrelloLabel[];
	badges: TrelloBadges;
	dateLastActivity: string;
}

export interface TrelloLabel {
	id: string;
	idBoard: string;
	name: string;
	color: string | null;
}

export interface TrelloMember {
	id: string;
	username: string;
	fullName: string;
	avatarUrl?: string | null;
}

export interface TrelloBadges {
	attachments: number;
	comments: number;
	checkItems: number;
	checkItemsChecked: number;
	description: boolean;
}

export interface TrelloAction {
	id: string;
	type: string;
	date: string;
	data: {
		text?: string;
		card?: { id: string; name: string };
		list?: { id: string; name: string };
		board?: { id: string; name: string };
	};
	memberCreator?: {
		id: string;
		username: string;
		fullName: string;
	};
}

export interface TrelloAttachment {
	id: string;
	name: string;
	url: string;
	date: string;
	mimeType?: string;
}

// ============================================
// Trello Client
// ============================================

export class TrelloClient {
	private apiKey: string;
	private token: string;

	constructor(apiKey: string, token: string) {
		this.apiKey = apiKey;
		this.token = token;
	}

	/**
	 * Make an authenticated request to the Trello API
	 */
	private async request<T>(
		method: "GET" | "POST" | "PUT" | "DELETE",
		endpoint: string,
		body?: Record<string, unknown>,
	): Promise<T> {
		const url = new URL(`${BASE_URL}${endpoint}`);
		url.searchParams.set("key", this.apiKey);
		url.searchParams.set("token", this.token);

		const options: RequestInit = {
			method,
			headers: {
				Accept: "application/json",
			},
		};

		if (body && (method === "POST" || method === "PUT")) {
			options.headers = {
				...options.headers,
				"Content-Type": "application/json",
			};
			options.body = JSON.stringify(body);
		}

		const response = await fetch(url.toString(), options);

		if (!response.ok) {
			const errorText = await response.text();
			throw new Error(`Trello API error (${response.status}): ${errorText}`);
		}

		return response.json() as Promise<T>;
	}

	/**
	 * Validate the API credentials
	 */
	async validateCredentials(): Promise<boolean> {
		try {
			await this.request<TrelloMember>("GET", "/members/me");
			return true;
		} catch {
			return false;
		}
	}

	/**
	 * Get the current user
	 */
	async getCurrentUser(): Promise<TrelloMember> {
		return this.request<TrelloMember>("GET", "/members/me");
	}

	/**
	 * Get all boards for the authenticated user
	 */
	async getBoards(): Promise<TrelloBoard[]> {
		return this.request<TrelloBoard[]>(
			"GET",
			"/members/me/boards?filter=open&fields=id,name,desc,url,shortUrl,closed,idOrganization",
		);
	}

	/**
	 * Get a specific board by ID
	 */
	async getBoard(boardId: string): Promise<TrelloBoard> {
		return this.request<TrelloBoard>(
			"GET",
			`/boards/${boardId}?fields=id,name,desc,url,shortUrl,closed,idOrganization`,
		);
	}

	/**
	 * Get all lists on a board
	 */
	async getBoardLists(boardId: string): Promise<TrelloList[]> {
		return this.request<TrelloList[]>(
			"GET",
			`/boards/${boardId}/lists?filter=open&fields=id,name,closed,pos,idBoard`,
		);
	}

	/**
	 * Get all cards on a board
	 */
	async getBoardCards(boardId: string): Promise<TrelloCard[]> {
		return this.request<TrelloCard[]>(
			"GET",
			`/boards/${boardId}/cards?filter=open&fields=id,name,desc,url,shortUrl,shortLink,closed,pos,due,dueComplete,idBoard,idList,idMembers,idLabels,badges,dateLastActivity&attachments=false&members=false&labels=true`,
		);
	}

	/**
	 * Get all labels on a board
	 */
	async getBoardLabels(boardId: string): Promise<TrelloLabel[]> {
		return this.request<TrelloLabel[]>(
			"GET",
			`/boards/${boardId}/labels?fields=id,idBoard,name,color`,
		);
	}

	/**
	 * Get all members of a board
	 */
	async getBoardMembers(boardId: string): Promise<TrelloMember[]> {
		return this.request<TrelloMember[]>(
			"GET",
			`/boards/${boardId}/members?fields=id,username,fullName,avatarUrl`,
		);
	}

	/**
	 * Get a specific card by ID
	 */
	async getCard(cardId: string): Promise<TrelloCard> {
		return this.request<TrelloCard>(
			"GET",
			`/cards/${cardId}?fields=id,name,desc,url,shortUrl,shortLink,closed,pos,due,dueComplete,idBoard,idList,idMembers,idLabels,badges,dateLastActivity&attachments=false&members=false&labels=true`,
		);
	}

	/**
	 * Get card attachments
	 */
	async getCardAttachments(cardId: string): Promise<TrelloAttachment[]> {
		return this.request<TrelloAttachment[]>(
			"GET",
			`/cards/${cardId}/attachments?fields=id,name,url,date,mimeType`,
		);
	}

	/**
	 * Get card comments (actions of type commentCard)
	 */
	async getCardComments(cardId: string): Promise<TrelloAction[]> {
		return this.request<TrelloAction[]>(
			"GET",
			`/cards/${cardId}/actions?filter=commentCard`,
		);
	}

	/**
	 * Update a card
	 */
	async updateCard(
		cardId: string,
		data: Partial<{
			name: string;
			desc: string;
			idList: string;
			due: string | null;
			dueComplete: boolean;
			closed: boolean;
			idMembers: string[];
			idLabels: string[];
		}>,
	): Promise<TrelloCard> {
		return this.request<TrelloCard>("PUT", `/cards/${cardId}`, data);
	}

	/**
	 * Add a comment to a card
	 */
	async addComment(cardId: string, text: string): Promise<TrelloAction> {
		return this.request<TrelloAction>(
			"POST",
			`/cards/${cardId}/actions/comments`,
			{
				text,
			},
		);
	}

	/**
	 * Create a new card
	 */
	async createCard(data: {
		name: string;
		idList: string;
		desc?: string;
		due?: string;
		idMembers?: string[];
		idLabels?: string[];
	}): Promise<TrelloCard> {
		return this.request<TrelloCard>("POST", "/cards", data);
	}

	/**
	 * Search for cards
	 */
	async searchCards(
		query: string,
		options?: {
			idBoards?: string[];
			modelTypes?: string[];
			partial?: boolean;
		},
	): Promise<{ cards: TrelloCard[] }> {
		const params = new URLSearchParams();
		params.set("query", query);
		params.set("modelTypes", options?.modelTypes?.join(",") ?? "cards");
		if (options?.idBoards) {
			params.set("idBoards", options.idBoards.join(","));
		}
		if (options?.partial !== undefined) {
			params.set("partial", String(options.partial));
		}

		const url = `/search?${params.toString()}`;
		return this.request<{ cards: TrelloCard[] }>("GET", url);
	}

	/**
	 * Get authorization URL for OAuth token generation
	 */
	static getAuthorizationUrl(
		apiKey: string,
		options?: {
			name?: string;
			scope?: string;
			expiration?: string;
			returnUrl?: string;
		},
	): string {
		const url = new URL("https://trello.com/1/authorize");
		url.searchParams.set("key", apiKey);
		url.searchParams.set("name", options?.name ?? "Team Toon Tack");
		url.searchParams.set("scope", options?.scope ?? "read,write");
		url.searchParams.set("expiration", options?.expiration ?? "never");
		url.searchParams.set("response_type", "token");
		if (options?.returnUrl) {
			url.searchParams.set("return_url", options.returnUrl);
		}
		return url.toString();
	}
}
