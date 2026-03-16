import fs from "node:fs/promises";
import path from "node:path";

const LINEAR_IMAGE_DOMAINS = [
	"uploads.linear.app",
	"linear-uploads.s3.us-west-2.amazonaws.com",
];
const TRELLO_FILE_DOMAINS = [
	"trello.com",
	"api.trello.com",
	"attachments.trello.com",
];
const IMAGE_EXTENSIONS = /\.(jpg|jpeg|png|gif|webp|svg)(?:$|[?#])/i;

export function isLinearImageUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return LINEAR_IMAGE_DOMAINS.some((domain) => parsed.host.includes(domain));
	} catch {
		return false;
	}
}

export function isTrelloFileUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return TRELLO_FILE_DOMAINS.some((domain) => parsed.host.includes(domain));
	} catch {
		return false;
	}
}

function isLikelyImageUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return (
			IMAGE_EXTENSIONS.test(parsed.pathname) ||
			isLinearImageUrl(url) ||
			isTrelloFileUrl(url)
		);
	} catch {
		return false;
	}
}

/**
 * Extract image/file URLs from markdown text (description, comments)
 */
export function extractImageUrls(text: string): string[] {
	const urls: string[] = [];
	const patterns = [
		/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g,
		/(https?:\/\/[^\s)>\]]+)/g,
	];

	for (const pattern of patterns) {
		let match: RegExpExecArray | null = pattern.exec(text);
		while (match) {
			const url = match[1];
			if (isLikelyImageUrl(url) && !urls.includes(url)) {
				urls.push(url);
			}
			match = pattern.exec(text);
		}
	}

	return urls;
}

/**
 * Extract Linear image URLs from markdown text (description, comments)
 */
export function extractLinearImageUrls(text: string): string[] {
	return extractImageUrls(text).filter((url) => isLinearImageUrl(url));
}

// MIME type to extension mapping
const MIME_TO_EXT: Record<string, string> = {
	// Images
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/gif": "gif",
	"image/webp": "webp",
	"image/svg+xml": "svg",
	// Videos
	"video/mp4": "mp4",
	"video/webm": "webm",
	"video/quicktime": "mov",
	"video/x-msvideo": "avi",
	// Documents
	"application/json": "json",
	"application/pdf": "pdf",
	"text/plain": "txt",
	"text/html": "html",
	"text/css": "css",
	"text/javascript": "js",
	"application/javascript": "js",
	// Archives
	"application/zip": "zip",
	"application/gzip": "gz",
	"application/x-tar": "tar",
};

function getFileExtension(
	url: string,
	contentType?: string,
): { ext: string; isImage: boolean } {
	// Try to get extension from content-type header
	if (contentType) {
		// Extract base MIME type (ignore charset and other params)
		const baseMime = contentType.split(";")[0].trim().toLowerCase();

		// Check our mapping
		const mappedExt = MIME_TO_EXT[baseMime];
		if (mappedExt) {
			const isImage = baseMime.startsWith("image/");
			return { ext: mappedExt, isImage };
		}

		// Fallback: extract from MIME type pattern
		const match = baseMime.match(/^(\w+)\/(\w+)/);
		if (match) {
			const [, type, subtype] = match;
			const isImage = type === "image";
			return { ext: subtype, isImage };
		}
	}

	// Fallback: try to get from URL path
	const urlPath = new URL(url).pathname;
	const ext = path.extname(urlPath).slice(1).toLowerCase();
	if (ext) {
		const isImage = ["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext);
		return { ext: ext === "jpeg" ? "jpg" : ext, isImage };
	}

	// Last resort: unknown binary
	return { ext: "bin", isImage: false };
}

async function downloadRemoteFile(
	url: string,
	issueId: string,
	attachmentId: string,
	outputDir: string,
	options?: {
		headers?: Record<string, string>;
		transformUrl?: (url: string) => string;
	},
): Promise<string | undefined> {
	try {
		const downloadUrl = options?.transformUrl ? options.transformUrl(url) : url;
		const headers = options?.headers ?? {};

		const response = await fetch(downloadUrl, { headers });
		if (!response.ok) {
			console.error(`Failed to download file: ${response.status}`);
			return undefined;
		}

		const contentType = response.headers.get("content-type") || undefined;
		const { ext } = getFileExtension(downloadUrl, contentType);
		const filename = `${issueId}_${attachmentId}.${ext}`;
		const filepath = path.join(outputDir, filename);

		const buffer = await response.arrayBuffer();
		await fs.writeFile(filepath, Buffer.from(buffer));

		return filepath;
	} catch (error) {
		console.error(`Error downloading file: ${error}`);
		return undefined;
	}
}

export async function downloadLinearFile(
	url: string,
	issueId: string,
	attachmentId: string,
	outputDir: string,
): Promise<string | undefined> {
	const headers: Record<string, string> = {};
	if (process.env.LINEAR_API_KEY && isLinearImageUrl(url)) {
		headers.Authorization = process.env.LINEAR_API_KEY;
	}

	return downloadRemoteFile(url, issueId, attachmentId, outputDir, {
		headers,
	});
}

export async function downloadTrelloFile(
	url: string,
	issueId: string,
	attachmentId: string,
	outputDir: string,
): Promise<string | undefined> {
	return downloadRemoteFile(url, issueId, attachmentId, outputDir, {
		transformUrl: (rawUrl) => {
			if (!isTrelloFileUrl(rawUrl)) {
				return rawUrl;
			}

			const parsed = new URL(rawUrl);
			if (process.env.TRELLO_API_KEY && !parsed.searchParams.has("key")) {
				parsed.searchParams.set("key", process.env.TRELLO_API_KEY);
			}
			if (process.env.TRELLO_TOKEN && !parsed.searchParams.has("token")) {
				parsed.searchParams.set("token", process.env.TRELLO_TOKEN);
			}
			return parsed.toString();
		},
	});
}

// Alias for backwards compatibility
export const downloadLinearImage = downloadLinearFile;

export async function clearIssueImages(
	outputDir: string,
	issueId: string,
): Promise<void> {
	try {
		const files = await fs.readdir(outputDir);
		const issuePrefix = `${issueId}_`;
		for (const file of files) {
			if (file.startsWith(issuePrefix)) {
				await fs.unlink(path.join(outputDir, file));
			}
		}
	} catch {
		// Directory doesn't exist or other error, ignore
	}
}

export async function ensureOutputDir(outputDir: string): Promise<void> {
	await fs.mkdir(outputDir, { recursive: true });
}

/**
 * Clear all files in output directory (for fresh sync)
 */
export async function clearAllOutput(outputDir: string): Promise<void> {
	try {
		const files = await fs.readdir(outputDir);
		for (const file of files) {
			const filepath = path.join(outputDir, file);
			const stat = await fs.stat(filepath);
			if (stat.isFile()) {
				await fs.unlink(filepath);
			}
		}
	} catch {
		// Directory doesn't exist or other error, ignore
	}
}
