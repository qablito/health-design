#!/usr/bin/env node
import {
  parseArguments,
  printResult,
  readOperatorBundle,
  requiredValue,
} from "./operator-input.mjs";
import { createLiveLedgerHeadProvider } from "./live-ledger-heads.mjs";
import { verifyRecoverySet } from "./recovery-set.mjs";

const parsed = parseArguments(process.argv.slice(2));
try {
  const directory = requiredValue(parsed, "--backup");
  if (!parsed.flags.has("--secrets-stdin")) {
    throw new Error("operator_secrets_stdin_required");
  }
  const { bundle, keyring } = await readOperatorBundle();
  const result = await verifyRecoverySet({
    directory,
    keyring,
    ledgerHeadProvider: createLiveLedgerHeadProvider(bundle),
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
