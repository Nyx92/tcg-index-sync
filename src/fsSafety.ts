// src/fsSafety.ts
//
// Small shared helpers used by both sync.ts entry points:
//  - writeFileAtomic: write-then-rename so a killed process (OOM, SIGTERM,
//    reboot) can never leave a state/output file truncated or corrupt.
//    `rename` is atomic on POSIX as long as source and destination share a
//    filesystem, which the `.tmp` sibling (same directory) always does.
//  - withLock: a simple lock-file guard so two invocations of the same sync
//    (e.g. a slow-running pass still in flight when a scheduled cron fires
//    the next one) can't race on the same state/output files.
//  - addPendingDelta: records a delta file that MXYYC-WEB has not imported
//    yet (see "Pending deltas" in README.md).

import { appendFileSync, writeFileSync, renameSync, existsSync, readFileSync, unlinkSync } from "fs";

export function writeFileAtomic(path: string, data: string): void {
  const tmpPath = `${path}.tmp`;
  writeFileSync(tmpPath, data);
  renameSync(tmpPath, path);
}

export async function withLock<T>(lockPath: string, fn: () => Promise<T>): Promise<T> {
  if (existsSync(lockPath)) {
    const existing = readFileSync(lockPath, "utf-8");
    console.error(
      `Another sync is already running (lock file exists at ${lockPath}).\n` +
        `${existing}\n` +
        `If this is stale, delete it manually.`
    );
    process.exit(1);
  }

  writeFileSync(lockPath, `pid: ${process.pid}\nstarted: ${new Date().toISOString()}\n`);
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(lockPath);
    } catch {
      // Already gone (e.g. manually cleaned up mid-run) — nothing to do.
    }
  }
}

// One path per line. MXYYC-WEB's `pnpm update-catalog` imports each line and
// then removes it, so a delta that is never imported stays here until it is.
// A single short append is atomic, so a crash never leaves half a line.
export function addPendingDelta(ledgerPath: string, deltaPath: string, cardCount: number): void {
  if (cardCount > 0) appendFileSync(ledgerPath, `${deltaPath}\n`);
}
