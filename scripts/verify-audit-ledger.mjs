#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import {
  buildSyntheticLedger,
  verifyLedgerContinuity,
} from "./operations/ledger-verifiers.mjs";

try {
  const descriptorPath = process.argv[2];
  const descriptor = descriptorPath
    ? JSON.parse(await readFile(descriptorPath, "utf8"))
    : {
        gaps: [],
        records: buildSyntheticLedger(
          [{ phase: "intent" }, { phase: "outcome" }],
          "admin-audit",
        ),
      };
  const result = verifyLedgerContinuity(descriptor.records, {
    gaps: descriptor.gaps ?? [],
    stream: "admin-audit",
  });
  process.stdout.write(
    `${JSON.stringify({
      sequence: result.sequence,
      status: "AUDIT_LEDGER_VERIFIED",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "audit_verify_failed",
      status: "AUDIT_LEDGER_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
