import type { RuntimeSmokePayload } from "@health-design/contracts";

const validPayload = {
  schemaVersion: 1,
  kind: "runtime-smoke",
  message: "contrato compartido",
} as const satisfies RuntimeSmokePayload;

const payloadWithExtraField = {
  schemaVersion: 1,
  kind: "runtime-smoke",
  message: "contrato compartido",
  // @ts-expect-error Los contratos de transporte son cerrados.
  unexpected: true,
} as const satisfies RuntimeSmokePayload;

void validPayload;
void payloadWithExtraField;
