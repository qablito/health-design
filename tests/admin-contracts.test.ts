import { describe, expect, it } from "vitest";

import {
  AdminImpersonationContextSchema,
  AdminMutationRequestSchema,
  AdminProfileSummarySchema,
  LedgerReceiptSchema,
} from "@health-design/contracts";

const profileId = "51000000-0000-4000-8000-000000005101";
const impersonationSessionId = "71000000-0000-4000-8000-000000005101";

describe("contratos administrativos", () => {
  it("mantiene cerrados los comandos y resultados de impersonación", () => {
    expect(AdminMutationRequestSchema.parse({ schemaVersion: 1 })).toEqual({
      schemaVersion: 1,
    });
    expect(() =>
      AdminMutationRequestSchema.parse({ note: "texto libre", schemaVersion: 1 }),
    ).toThrow();

    expect(
      AdminImpersonationContextSchema.parse({
        active: true,
        effectiveProfileId: profileId,
        impersonationSessionId,
        startedAt: "2026-07-17T16:00:00.000Z",
      }),
    ).toMatchObject({ active: true, effectiveProfileId: profileId });
    expect(AdminImpersonationContextSchema.parse({ active: false })).toEqual({
      active: false,
    });
  });

  it("limita el listado administrativo a metadatos mínimos", () => {
    const profile = AdminProfileSummarySchema.parse({
      alias: "Perfil Admin Test",
      createdAt: "2026-07-17T16:00:00.000Z",
      profileId,
      status: "active",
    });

    expect(profile).toEqual({
      alias: "Perfil Admin Test",
      createdAt: "2026-07-17T16:00:00.000Z",
      profileId,
      status: "active",
    });
    expect(() =>
      AdminProfileSummarySchema.parse({
        ...profile,
        medication: "canario-sensible",
      }),
    ).toThrow();
  });

  it("valida el recibo firmado y no acepta campos arbitrarios", () => {
    const receipt = {
      environment: "development",
      idempotencyHash: "a".repeat(64),
      keyVersion: 1,
      recordHash: "b".repeat(64),
      sequence: 12,
      signature: "A".repeat(86),
      stream: "admin-audit",
      timestamp: "2026-07-17T16:00:00.000Z",
    };

    expect(LedgerReceiptSchema.parse(receipt)).toEqual(receipt);
    expect(() =>
      LedgerReceiptSchema.parse({ ...receipt, body: "prohibido" }),
    ).toThrow();
  });
});
