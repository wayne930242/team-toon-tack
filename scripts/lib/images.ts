import fs from "node:fs/promises";
import path from "node:path";

const LINEAR_IMAGE_DOMAINS = [
	"uploads.linear.app",
	"linear-uploads.s3.us-west-2.amazonaws.com",
];

export function isLinearImageUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		return LINEAR_IMAGE_DOMAINS.some((domain) => parsed.host.includes(domain));
	} catch {
		return false;
	}
}

/**
 * Extract Linear image URLs from markdown text (description, comments)
 */
export function extractLinearImageUrls(text: string): string[] {
	const urls: string[] = [];
	// Match markdown image syntax ![alt](url) and plain URLs
	const patterns = [
		/!\[[^\]]*\]\((https?:\/\/[^)]+)\)/g, // ![alt](url)
		/(https?:\/\/uploads\.linear\.app\/[^\s)>\]]+)/g, // Plain Linear upload URLs
	];

	for (const pattern of patterns) {
		let match: RegExpExecArray | null = pattern.exec(text);
		while (match) {
			const url = match[1];
			if (isLinearImageUrl(url) && !urls.includes(url)) {
				urls.push(url);
			}
			match = pattern.exec(text);
		}
	}

	return urls;
}

function getFileExtension(
	url: string,
	contentType?: string,
): { ext: string; isImage: boolean } {
	// Try to get extension from content-type header
	if (contentType) {
		// Image types
		const imageMatch = contentType.match(/image\/(\w+)/);
		if (imageMatch) {
			const ext = imageMatch[1] === "jpeg" ? "jpg" : imageMatch[1];
			return { ext, isImage: true };
		}
		// Video types
		const videoMatch = contentType.match(/video\/(\w+)/);
		if (videoMatch) {
			const videoExt = videoMatch[1] === "quicktime" ? "mov" : videoMatch[1];
			return { ext: videoExt, isImage: false };
		}
	}
	// Fallback: try to get from URL path
	const urlPath = new URL(url).pathname;
	const ext = path.extname(urlPath).slice(1).toLowerCase();
	if (["jpg", "jpeg", "png", "gif", "webp", "svg"].includes(ext)) {
		return { ext: ext === "jpeg" ? "jpg" : ext, isImage: true };
	}
	if (["mov", "mp4", "webm", "avi"].includes(ext)) {
		return { ext, isImage: false };
	}
	return { ext: "png", isImage: true }; // Default assume image
}

export async function downloadLinearFile(
	url: string,
	issueId: string,
	attachmentId: string,
	outputDir: string,
): Promise<string | undefined> {
	try {
		// Linear files require authentication
		const headers: Record<string, string> = {};
		if (process.env.LINEAR_API_KEY) {
			headers.Authorization = process.env.LINEAR_API_KEY;
		}

		const response = await fetch(url, { headers });
		if (!response.ok) {
			console.error(`Failed to download file: ${response.status}`);
			return undefined;
		}

		const contentType = response.headers.get("content-type") || undefined;
		const { ext } = getFileExtension(url, contentType);
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
