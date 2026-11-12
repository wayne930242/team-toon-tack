/**
 * Exclusive lock files, created with O_EXCL; each holds a token naming its
 * owner (`<pid>@<host> <time> <random>`).
 *
 * `withFileLock` guards short read-modify-write sections on local files: no
 * such section does more than local file work, so a lock older than the
 * stale limit belongs to a dead process and is taken over.
 * `withProcessLock` guards long runs: its lock is stale only once the
 * process that holds it is gone.
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

/** True while process `pid` exists (EPERM: it exists, under another user). */
function processAlive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === "EPERM";
	}
}

/**
 * Run `fn` while holding `lockPath`, for a section that may run as long as
 * it needs (network work), so age says nothing about the holder. The lock
 * is stale only when its holder, a process on this host, has exited; one
 * held by another host is never taken over. A busy lock is not waited for:
 * `onBusy(holder)` builds the error to throw at once.
 */
export async function withProcessLock<T>(
	lockPath: string,
	onBusy: (holder: string) => Error,
	fn: () => Promise<T>,
): Promise<T> {
	const host = os.hostname();
	const token = `${process.pid}@${host} ${new Date().toISOString()} ${Math.random().toString(36).slice(2)}\n`;
	const isStale = async (file: string) => {
		const [content, stat] = await Promise.all([
			fs.readFile(file, "utf8").catch(() => undefined),
			fs.stat(file).catch(() => undefined),
		]);
		if (content === undefined || !stat) return false;
		const match = /^(\d+)@(\S+) /.exec(content);
		// Created but never written: its writer died at once, unless it is
		// still writing
		if (!match) return Date.now() - stat.mtimeMs > LOCK_STALE_MS;
		return match[2] === host && !processAlive(Number(match[1]));
	};

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
			const holder = await fs.readFile(lockPath, "utf8").catch(() => "");
			throw onBusy(holder.trim() || "another process");
		}
	}

	try {
		return await fn();
	} finally {
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
