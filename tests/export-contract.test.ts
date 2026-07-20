import { describe, expect, it } from "vitest";

import {
  ExportArtifactAckSchema,
  ExportCreateRequestSchema,
} from "@health-design/contracts";

const baseRequest = {
  choices: [[0, 0, 0, 1]],
  detail: "compact",
  format: "pdf",
  includeShopping: true,
  includeWeeklyPreparation: false,
  presentation: "ingredients",
  range: { kind: "week" },
  schemaVersion: 1,
} as const;

describe("contrato de exportación v1", () => {
  it("acepta semana o día y rechaza preparación semanal para un solo día", () => {
    expect(ExportCreateRequestSchema.parse(baseRequest)).toEqual(baseRequest);
    expect(
      ExportCreateRequestSchema.safeParse({
        ...baseRequest,
        range: { day: 4, kind: "day" },
      }).success,
    ).toBe(true);
    expect(
      ExportCreateRequestSchema.safeParse({
        ...baseRequest,
        includeWeeklyPreparation: true,
        range: { day: 4, kind: "day" },
      }).success,
    ).toBe(false);
  });

  it("rechaza posiciones duplicadas y más elecciones que alimentos posibles", () => {
    expect(
      ExportCreateRequestSchema.safeParse({
        ...baseRequest,
        choices: [
          [0, 0, 0, 1],
          [0, 0, 0, 2],
        ],
      }).success,
    ).toBe(false);
    expect(
      ExportCreateRequestSchema.safeParse({
        ...baseRequest,
        choices: Array.from({ length: 169 }, (_, index) => [
          index % 7,
          Math.floor(index / 7) % 6,
          Math.floor(index / 42),
          1,
        ]),
      }).success,
    ).toBe(false);
  });

  it("limita índices y valida una respuesta sin capacidades de Storage", () => {
    expect(
      ExportCreateRequestSchema.safeParse({
        ...baseRequest,
        choices: [[7, 0, 0, 1]],
      }).success,
    ).toBe(false);

    const ack = {
      artifactId: "10000000-0000-4000-8000-000000000001",
      createdAt: "2026-07-20T10:00:00.000Z",
      detail: "complete",
      format: "xlsx",
      planVersionId: "20000000-0000-4000-8000-000000000001",
      presentation: "preparation",
      schemaVersion: 1,
      status: "ready",
    } as const;

    expect(ExportArtifactAckSchema.parse(ack)).toEqual(ack);
    expect(
      ExportArtifactAckSchema.safeParse({ ...ack, signedUrl: "https://example.test" })
        .success,
    ).toBe(false);
  });
});
