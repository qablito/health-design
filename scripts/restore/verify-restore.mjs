#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseArguments,
  printResult,
  requiredValue,
} from "../backup/operator-input.mjs";

const parsed = parseArguments(process.argv.slice(2));
try {
  const target = requiredValue(parsed, "--target");
  const validation = JSON.parse(
    await readFile(join(target, "restore-validation.json"), "utf8"),
  );
  if (
    validation.status !== "ready_for_promotion" ||
    validation.targetEnvironment !== "local-isolated" ||
    validation.trafficEnabled !== false ||
    validation.database?.security?.rlsEnabled !== true ||
    validation.database?.security?.aal2Required !== true ||
    !Array.isArray(validation.database?.sessions) ||
    validation.database.sessions.some((session) => session.revoked !== true)
  ) {
    throw new Error("restore_validation_failed");
  }
  printResult({
    backupId: validation.backupId,
    status: "RESTORE_VERIFIED",
    targetRef: validation.targetRef,
  });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "restore_verify_failed",
      status: "RESTORE_VERIFY_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
