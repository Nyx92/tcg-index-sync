import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { addPendingDelta, writeFileAtomic, withLock } from "./fsSafety";

describe("writeFileAtomic", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fssafety-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("writes the file and leaves no .tmp sibling behind", () => {
    const target = join(dir, "state.json");
    writeFileAtomic(target, "hello");
    expect(readFileSync(target, "utf-8")).toBe("hello");
    expect(existsSync(`${target}.tmp`)).toBe(false);
  });

  it("replaces an existing file's contents wholesale", () => {
    const target = join(dir, "state.json");
    writeFileSync(target, "old");
    writeFileAtomic(target, "new");
    expect(readFileSync(target, "utf-8")).toBe("new");
  });
});

describe("withLock", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fssafety-lock-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("creates the lock file during the run and removes it on success", async () => {
    const lockPath = join(dir, "test.lock");
    let sawLockDuringRun = false;

    const result = await withLock(lockPath, async () => {
      sawLockDuringRun = existsSync(lockPath);
      return "done";
    });

    expect(sawLockDuringRun).toBe(true);
    expect(result).toBe("done");
    expect(existsSync(lockPath)).toBe(false);
  });

  it("removes the lock file even if the run throws", async () => {
    const lockPath = join(dir, "test.lock");

    await expect(
      withLock(lockPath, async () => {
        throw new Error("boom");
      })
    ).rejects.toThrow("boom");

    expect(existsSync(lockPath)).toBe(false);
  });

  it("refuses to run and exits when a lock file already exists", async () => {
    const lockPath = join(dir, "test.lock");
    writeFileSync(lockPath, "pid: 1\nstarted: now\n");

    const exitSpy = vi
      .spyOn(process, "exit")
      // process.exit's real return type is `never`; the mock throws so
      // control never falls through to the (never-reached) `fn()` call.
      .mockImplementation(() => {
        throw new Error("process.exit called");
      });

    await expect(withLock(lockPath, async () => "should not run")).rejects.toThrow("process.exit called");
    expect(exitSpy).toHaveBeenCalledWith(1);

    exitSpy.mockRestore();
  });
});

describe("addPendingDelta", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "fssafety-pending-"));
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("appends deltas with cards, one path per line, oldest first", () => {
    const ledger = join(dir, "pending.txt");
    addPendingDelta(ledger, "output/a.json", 3);
    addPendingDelta(ledger, "output/b.json", 1);
    expect(readFileSync(ledger, "utf-8")).toBe("output/a.json\noutput/b.json\n");
  });

  it("skips a delta with 0 cards", () => {
    const ledger = join(dir, "pending.txt");
    addPendingDelta(ledger, "output/empty.json", 0);
    expect(existsSync(ledger)).toBe(false);
  });
});
