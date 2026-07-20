import { describe, expect, it } from "vitest";

import {
  AIExplanationInputSchema,
  AIExplanationResponseSchema,
  resolveAIExplanation,
} from "@health-design/contracts";

const planVersionId = "10000000-0000-4000-8000-000000000014";
const planOutputHash = "14".repeat(32);

const input = AIExplanationInputSchema.parse({
  locale: "es-ES",
  planOutputHash,
  planVersionId,
  schemaVersion: 1,
  slots: [
    {
      messageKey: "plan.summary",
      signal: "plan_complete",
      slot: "summary",
      variants: [
        {
          id: "summary-direct-v1",
          text: "Tu semana reúne las pautas confirmadas en una sola vista.",
        },
        {
          id: "summary-calm-v1",
          text: "Aquí tienes una lectura serena de las pautas confirmadas para la semana.",
        },
      ],
    },
  ],
});

describe("contrato de explicación Luna", () => {
  it("acepta únicamente una variante aprobada y conserva el hash normativo", () => {
    const result = resolveAIExplanation(input, {
      schemaVersion: 1,
      selections: [
        {
          messageKey: "plan.summary",
          slot: "summary",
          variantId: "summary-calm-v1",
        },
      ],
    });

    expect(AIExplanationResponseSchema.parse(result)).toEqual({
      planOutputHash,
      planVersionId,
      schemaVersion: 1,
      segments: [
        {
          messageKey: "plan.summary",
          slot: "summary",
          text: "Aquí tienes una lectura serena de las pautas confirmadas para la semana.",
        },
      ],
      source: "luna",
    });
  });

  it.each([
    {
      label: "texto y número nuevos",
      output: {
        schemaVersion: 1,
        selections: [
          {
            messageKey: "plan.summary",
            slot: "summary",
            text: "Añade 200 gramos de salmón.",
            variantId: "summary-direct-v1",
          },
        ],
      },
    },
    {
      label: "variante no aprobada",
      output: {
        schemaVersion: 1,
        selections: [
          {
            messageKey: "plan.summary",
            slot: "summary",
            variantId: "haz-sentadillas-v1",
          },
        ],
      },
    },
    {
      label: "slot adicional",
      output: {
        schemaVersion: 1,
        selections: [
          {
            messageKey: "plan.warning",
            slot: "warning",
            variantId: "warning-dose-v1",
          },
        ],
      },
    },
  ])("rechaza $label y usa el fallback completo", ({ output }) => {
    expect(resolveAIExplanation(input, output)).toEqual({
      planOutputHash,
      planVersionId,
      schemaVersion: 1,
      segments: [
        {
          messageKey: "plan.summary",
          slot: "summary",
          text: "Tu semana reúne las pautas confirmadas en una sola vista.",
        },
      ],
      source: "deterministic_fallback",
    });
  });

  it("usa fallback cuando el proveedor no responde", () => {
    expect(resolveAIExplanation(input, null).source).toBe("deterministic_fallback");
  });
});
