import { describe, expect, it } from "vitest";

import {
  FollowUpCreateRequestSchema,
  LabBatchCreateRequestSchema,
} from "@health-design/contracts";

const baseFollowUp = {
  basePlanVersionId: "10000000-0000-4000-8000-000000000101",
  observedAt: "2026-07-20T08:00:00.000Z",
  schemaVersion: 1,
  scope: "weekly",
  values: {
    common: {
      adherence: 4,
      importantSymptoms: [],
      materialChanges: [],
    },
    nutrition: {
      adherence: 4,
      foodAnxiety: "sometimes",
      hunger: 3,
      satiety: 4,
    },
  },
} as const;

describe("contratos de seguimiento T13", () => {
  it("acepta una revisión semanal cerrada y sin texto clínico libre", () => {
    expect(FollowUpCreateRequestSchema.parse(baseFollowUp)).toEqual(baseFollowUp);
  });

  it("permite un diario opcional con una sola métrica", () => {
    expect(
      FollowUpCreateRequestSchema.parse({
        ...baseFollowUp,
        scope: "daily",
        values: { sleep: { averageHours: 7.5 } },
      }),
    ).toMatchObject({ scope: "daily" });
  });

  it("rechaza una entrada diaria vacía y fases imposibles", () => {
    expect(
      FollowUpCreateRequestSchema.safeParse({
        ...baseFollowUp,
        scope: "daily",
        values: {},
      }).success,
    ).toBe(false);
    expect(
      FollowUpCreateRequestSchema.safeParse({
        ...baseFollowUp,
        values: {
          common: baseFollowUp.values.common,
          sleep: {
            averageHours: 7,
            deepMinutes: 300,
            lightMinutes: 300,
            remMinutes: 300,
          },
        },
      }).success,
    ).toBe(false);
  });

  it("admite cambios de volumen mayores, pero nunca como ajuste menor implícito", () => {
    expect(
      FollowUpCreateRequestSchema.parse({
        ...baseFollowUp,
        values: {
          common: baseFollowUp.values.common,
          training: {
            completedSessions: 3,
            fatigue: 3,
            pain: "none",
            perceivedEffort: 7,
            plannedSessions: 4,
            volumeChangePercent: 25,
          },
        },
      }).values.training?.volumeChangePercent,
    ).toBe(25);
  });

  it("registra de una a cuatro analíticas y conserva datos incompletos", () => {
    const parsed = LabBatchCreateRequestSchema.parse({
      basePlanVersionId: baseFollowUp.basePlanVersionId,
      observations: [
        {
          analyte: "b12",
          measurement: { date: "2026-06-20", kind: "exact" },
          name: "Vitamina B12",
          referenceRange: { maximum: "900", minimum: "200", unit: "pg/mL" },
          source: "laboratory",
          unit: "pg/mL",
          value: "180",
        },
        {
          analyte: "folate",
          measurement: { kind: "unknown" },
          name: "Folato",
          source: "self_reported",
          value: "4.2",
        },
      ],
      schemaVersion: 1,
    });
    expect(parsed.observations).toHaveLength(2);
    expect(parsed.observations[1]?.unit).toBeUndefined();

    expect(
      LabBatchCreateRequestSchema.safeParse({
        ...parsed,
        observations: Array.from({ length: 5 }, () => parsed.observations[0]),
      }).success,
    ).toBe(false);
  });
});
