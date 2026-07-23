#!/usr/bin/env node
import { readFile } from "node:fs/promises";

import {
  buildSyntheticLedger,
  verifyDeletionTombstones,
} from "./operations/ledger-verifiers.mjs";

try {
  const descriptorPath = process.argv[2];
  const descriptor = descriptorPath
    ? JSON.parse(await readFile(descriptorPath, "utf8"))
    : {
        keyVersions: [1],
        records: buildSyntheticLedger(
          [
            {
              markerKeyVersion: 1,
              operationId: "71000000-0000-4000-8000-000000018501",
              profileMarker: "a".repeat(64),
              recordType: "profile_deletion",
              schemaVersion: 1,
              stream: "deletions",
            },
          ],
          "deletions",
        ),
      };
  const result = verifyDeletionTombstones(
    descriptor.records,
    new Set(descriptor.keyVersions),
  );
  process.stdout.write(
    `${JSON.stringify({
      sequence: result.sequence,
      status: "TOMBSTONES_VERIFIED",
    })}\n`,
  );
} catch (error) {
  process.stderr.write(
    `${JSON.stringify({
      error: error instanceof Error ? error.message : "tombstone_verify_failed",
      status: "TOMBSTONES_FAILED",
    })}\n`,
  );
  process.exitCode = 1;
}
