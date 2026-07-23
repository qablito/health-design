#!/usr/bin/env node
import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import {
  parseArguments,
  printResult,
  readJson,
  requiredValue,
} from "./operator-input.mjs";
import { planRotation } from "./recovery-set.mjs";

const parsed = parseArguments(process.argv.slice(2));
try {
  const inventory = await readJson(
    requiredValue(parsed, "--inventory"),
    "invalid_rotation_inventory",
  );
  const candidate = await readJson(
    requiredValue(parsed, "--candidate"),
    "invalid_rotation_candidate",
  );
  if (!Array.isArray(inventory.backups)) {
    throw new Error("invalid_rotation_inventory");
  }
  const plan = planRotation(inventory.backups, candidate);
  printResult({
    ...plan,
    mode: parsed.flags.has("--apply") ? "apply" : "dry-run",
  });
  if (!parsed.flags.has("--apply") || plan.pruneCandidateId === null) {
    process.exit(0);
  }
  if (parsed.values.get("--confirm") !== plan.pruneCandidateId) {
    throw new Error("prune_confirmation_mismatch");
  }
  const target = inventory.backups.find(
    (backup) => backup.backupId === plan.pruneCandidateId,
  );
  if (!target || typeof target.directory !== "string") {
    throw new Error("prune_target_missing");
  }
  const root = resolve(requiredValue(parsed, "--backup-root"));
  const directory = resolve(target.directory);
  if (!directory.startsWith(`${root}/`)) throw new Error("prune_target_outside_root");
  await rm(directory, { recursive: true });
  printResult({ prunedBackupId: plan.pruneCandidateId, status: "BACKUP_PRUNED" });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "backup_prune_failed",
      status: "BACKUP_PRUNE_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
