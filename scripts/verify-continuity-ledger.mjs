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
        records: buildSyntheticLedger(
          [{ operationId: "fixture-1" }, { operationId: "fixture-2" }],
          "deletions",
        ),
        stream: "deletions",
      };
  const result = verifyLedgerContinuity(descriptor.records, {
    gaps: descriptor.gaps ?? [],
    stream: descriptor.stream,
  });
  process.stdout.write(
    `${JSON.stringify({
      sequence: result.sequence,
      status: "CONTINUITY_LEDGER_VERIFIED",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "ledger_verify_failed",
      status: "CONTINUITY_LEDGER_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
