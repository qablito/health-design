import { describe, expect, it } from "vitest";

import {
  ContextSnapshotCreateRequestSchema,
  PlanCandidateCreateRequestSchema,
  PlanEngineResultSchema,
  PlanGenerationRequestSchema,
  PlanMutationAckSchema,
  PlanMutationRequestSchema,
  PlanVersionDetailSchema,
} from "@health-design/contracts";

const id = (suffix: string) => `10000000-0000-4000-8000-${suffix.padStart(12, "0")}`;
const hash = (pair: string) => pair.repeat(32);

describe("contratos del ciclo de vida del plan", () => {
  it("versiona el snapshot y exige la versión exacta del borrador", () => {
    expect(
      ContextSnapshotCreateRequestSchema.parse({
        expectedDraftVersion: 2,
        schemaVersion: 1,
      }),
    ).toEqual({ expectedDraftVersion: 2, schemaVersion: 1 });
    expect(
      ContextSnapshotCreateRequestSchema.safeParse({
        expectedDraftVersion: 0,
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("no permite que el cliente inyecte resultados del motor al generar", () => {
    expect(
      PlanGenerationRequestSchema.safeParse({
        contextSnapshotId: id("1"),
        schemaVersion: 1,
      }).success,
    ).toBe(true);
    expect(
      PlanGenerationRequestSchema.safeParse({
        contextSnapshotId: id("1"),
        engineVersion: "client-engine",
        moduleResults: [],
        schemaVersion: 1,
      }).success,
    ).toBe(false);
  });

  it("expresa expected_version en candidatos y activaciones", () => {
    expect(
      PlanCandidateCreateRequestSchema.parse({
        baseVersionId: id("2"),
        contextSnapshotId: id("3"),
        expectedVersion: 4,
        schemaVersion: 1,
      }).expectedVersion,
    ).toBe(4);
    expect(
      PlanMutationRequestSchema.safeParse({ expectedVersion: 0, schemaVersion: 1 })
        .success,
    ).toBe(false);
  });

  it("valida salida normativa cerrada, hashes y un resultado por módulo", () => {
    const result = {
      canonicalizationVersion: "canonical-json-v1",
      engineVersion: "engine-v1",
      inputHash: hash("11"),
      moduleResults: [
        {
          confidence: "high",
          module: "nutrition",
          payload: { days: 7 },
          status: "valid",
          uncertainties: [],
        },
      ],
      outputHash: hash("12"),
      ruleSetRevisionId: id("4"),
      safetyFindings: [
        {
          actionLevel: "information",
          code: "HYDRATION_CONTEXT",
          evidenceRef: "rule:hydration-v1",
          messageKey: "plan.hydration.context",
          module: "hydration",
        },
      ],
      sourceManifestId: id("5"),
      validation: { checks: ["structure"] },
      validationStatus: "valid",
    };

    expect(PlanEngineResultSchema.safeParse(result).success).toBe(true);
    expect(
      PlanEngineResultSchema.safeParse({
        ...result,
        inputHash: "not-a-hash",
      }).success,
    ).toBe(false);
    expect(
      PlanEngineResultSchema.safeParse({
        ...result,
        moduleResults: [result.moduleResults[0], result.moduleResults[0]],
      }).success,
    ).toBe(false);
    expect(
      PlanEngineResultSchema.safeParse({
        ...result,
        safetyFindings: [{ ...result.safetyFindings[0], actionLevel: "inform" }],
      }).success,
    ).toBe(false);
  });

  it("mantiene completitud y estado como ejes independientes", () => {
    const parsed = PlanMutationAckSchema.parse({
      activatedAt: "2026-07-18T12:00:00.000Z",
      activeVersionId: id("6"),
      aggregateVersion: 2,
      archivedAt: null,
      completeness: "provisional",
      contextSnapshotId: id("7"),
      createdAt: "2026-07-18T11:00:00.000Z",
      ordinal: 1,
      planId: id("8"),
      planVersionId: id("6"),
      status: "active",
      validationStatus: "valid",
    });

    expect(parsed).toMatchObject({ completeness: "provisional", status: "active" });
  });

  it("devuelve una versión con módulos y hallazgos sin campos libres", () => {
    const version = {
      activatedAt: null,
      archivedAt: null,
      canonicalizationVersion: "canonical-json-v1",
      completeness: "complete",
      contextSnapshotId: id("9"),
      createdAt: "2026-07-18T11:00:00.000Z",
      engineVersion: "engine-v1",
      hashAlgorithm: "sha256",
      id: id("10"),
      inputHash: hash("13"),
      moduleResults: [],
      ordinal: 2,
      outputHash: hash("14"),
      planId: id("8"),
      ruleSetRevisionId: id("4"),
      safetyFindings: [],
      sourceManifestId: id("5"),
      status: "draft",
      validatedAt: "2026-07-18T11:00:00.000Z",
      validation: {},
      validationStatus: "valid",
    };

    expect(PlanVersionDetailSchema.safeParse(version).success).toBe(true);
    expect(
      PlanVersionDetailSchema.safeParse({ ...version, arbitraryClinicalText: "x" })
        .success,
    ).toBe(false);
  });
});
