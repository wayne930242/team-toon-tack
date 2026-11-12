/**
 * An exclusive lock file for short read-modify-write sections on local files.
 *
 * The lock is a file created with O_EXCL; it holds a token naming its owner.
 * No critical section does more than local file work, so a lock older than
 * the stale limit belongs to a dead process and is taken over.
 */
import fs from "node:fs/promises";
import os from "node:os";

const LOCK_WAIT_MS = 10_000;
const LOCK_RETRY_MS = 50;
const LOCK_STALE_MS = 30_000;

/**
 * Run `fn` while holding `lockPath`. When the lock stays busy past the wait
 * limit, `onTimeout(holder)` builds the error to throw.
 */
export async function withFileLock<T>(
	lockPath: string,
	onTimeout: (holder: string) => Error,
	fn: () => Promise<T>,
): Promise<T> {
	const deadline = Date.now() + LOCK_WAIT_MS;
	const token = `${process.pid}@${os.hostname()} ${new Date().toISOString()} ${Math.random().toString(36).slice(2)}\n`;
	const isStale = (file: string) =>
		fs
			.stat(file)
			.then((stat) => Date.now() - stat.mtimeMs > LOCK_STALE_MS)
			.catch(() => false);

	for (;;) {
		try {
			const handle = await fs.open(lockPath, "wx");
			await handle.writeFile(token);
			await handle.close();
			break;
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
			if (await isStale(lockPath)) {
				await takeOverStaleLock(lockPath, isStale);
				continue;
			}
			if (Date.now() > deadline) {
				const holder = await fs.readFile(lockPath, "utf8").catch(() => "");
				throw onTimeout(holder.trim() || "another process");
			}
			await new Promise((resolve) => setTimeout(resolve, LOCK_RETRY_MS));
		}
	}

	try {
		return await fn();
	} finally {
		// Release only our own lock: if it went stale, another process owns it now
		const current = await fs.readFile(lockPath, "utf8").catch(() => "");
		if (current === token) await fs.rm(lockPath, { force: true });
	}
}

/**
 * Move a stale lock aside under a unique name before deleting it, so two
 * processes that both saw it stale cannot delete a fresh lock between them.
 * If what got moved turns out to be fresh, it goes back.
 */
async function takeOverStaleLock(
	lockPath: string,
	isStale: (file: string) => Promise<boolean>,
): Promise<void> {
	const aside = `${lockPath}.${process.pid}.${Math.random().toString(36).slice(2)}.stale`;
	try {
		await fs.rename(lockPath, aside);
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
		throw error;
	}
	if (!(await isStale(aside))) {
		// Another process locked in between: restore its lock unless a third
		// one already holds the path
		await fs.link(aside, lockPath).catch(() => undefined);
	}
	await fs.rm(aside, { force: true });
}
