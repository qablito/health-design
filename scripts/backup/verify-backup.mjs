#!/usr/bin/env node
import {
  parseArguments,
  printResult,
  readJson,
  readOperatorKeyring,
  requiredValue,
} from "./operator-input.mjs";
import { verifyRecoverySet } from "./recovery-set.mjs";

const parsed = parseArguments(process.argv.slice(2));
try {
  const directory = requiredValue(parsed, "--backup");
  if (!parsed.flags.has("--secrets-stdin")) {
    throw new Error("operator_secrets_stdin_required");
  }
  const keyring = await readOperatorKeyring();
  const heads = parsed.values.has("--ledger-heads")
    ? await readJson(
        parsed.values.get("--ledger-heads"),
        "invalid_ledger_heads_descriptor",
      )
    : undefined;
  const result = await verifyRecoverySet({
    directory,
    keyring,
    remoteLedgerHeads: heads,
  });
  printResult({
    backupId: result.envelope.backupId,
    objectCount: result.manifest.objects.length,
    status: "BACKUP_VERIFIED",
  });
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "backup_verify_failed",
      status: "BACKUP_VERIFY_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
