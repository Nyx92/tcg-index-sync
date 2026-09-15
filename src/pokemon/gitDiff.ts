// src/pokemon/gitDiff.ts
//
// Pokemon's additive step maps directly onto git: cards-database is a
// plain git clone, so "what's new or changed" is just "what files changed
// since the commit we last processed." A card file's own name is always
// numeric (its local id, e.g. "39.ts"); set- and series-level files are
// named after the set/series instead, so filtering by a numeric stem is
// enough to isolate individual card files from the diff.

import { execSync } from "child_process";

export function parseChangedCardFiles(diffOutput: string): string[] {
  return diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ts"))
    .filter((line) => {
      const stem = line.split("/").pop()!.replace(/\.ts$/, "");
      return /^\d+$/.test(stem);
    });
}

/** Runs `git diff --name-only <lastSha> HEAD` in `repoPath` and returns changed card files. */
export function getChangedCardFilesSince(repoPath: string, lastSha: string | null): string[] {
  if (!lastSha) return []; // no prior state — caller falls back to a full pass, not this function
  const output = execSync(`git diff --name-only ${lastSha} HEAD`, { cwd: repoPath, encoding: "utf-8" });
  return parseChangedCardFiles(output);
}
