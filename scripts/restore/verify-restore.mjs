#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { join } from "node:path";

import {
  parseArguments,
  printResult,
  readOperatorKeyring,
  requiredValue,
} from "../backup/operator-input.mjs";
import { verifyRestoreValidation } from "./restore-recovery-set.mjs";

const parsed = parseArguments(process.argv.slice(2));
try {
  const target = requiredValue(parsed, "--target");
  if (!parsed.flags.has("--secrets-stdin")) {
    throw new Error("operator_secrets_stdin_required");
  }
  const keyring = await readOperatorKeyring();
  const validation = JSON.parse(
    await readFile(join(target, "restore-validation.json"), "utf8"),
  );
  await verifyRestoreValidation(validation, keyring);
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
