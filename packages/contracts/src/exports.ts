import { z } from "zod";

export const EXPORT_SCHEMA_VERSION = 1 as const;
export const EXPORT_RENDERER_VERSION = "export-v2" as const;
export const EXPORT_MAX_BODY_BYTES = 16 * 1024;
export const EXPORT_MAX_ARTIFACT_BYTES = 25 * 1024 * 1024;
export const EXPORT_MAX_CHOICES = 7 * 6 * 4;

export type ExportRendererVersion = typeof EXPORT_RENDERER_VERSION;

export const ExportFormatSchema = z.enum(["pdf", "xlsx"]);
export const ExportDetailSchema = z.enum(["compact", "complete"]);
export const ExportPresentationSchema = z.enum(["ingredients", "preparation"]);
export const ExportRangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("week") }).strict(),
  z.object({ day: z.number().int().min(1).max(7), kind: z.literal("day") }).strict(),
]);

export const ExportChoiceSchema = z.tuple([
  z.number().int().min(0).max(6),
  z.number().int().min(0).max(5),
  z.number().int().min(0).max(31),
  z.union([z.literal(0), z.literal(1), z.literal(2)]),
]);

export const ExportCreateRequestSchema = z
  .object({
    choices: z
      .array(ExportChoiceSchema)
      .max(EXPORT_MAX_CHOICES)
      .refine(
        (choices) =>
          new Set(choices.map(([day, meal, food]) => `${day}:${meal}:${food}`)).size ===
          choices.length,
        "duplicate_export_choice_position",
      ),
    detail: ExportDetailSchema,
    format: ExportFormatSchema,
    includeShopping: z.boolean(),
    includeWeeklyPreparation: z.boolean(),
    presentation: ExportPresentationSchema,
    range: ExportRangeSchema,
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.includeWeeklyPreparation && request.range.kind !== "week") {
      context.addIssue({
        code: "custom",
        message: "weekly_preparation_requires_week_range",
        path: ["includeWeeklyPreparation"],
      });
    }
  });

export const ExportArtifactAckSchema = z
  .object({
    artifactId: z.uuid(),
    createdAt: z.iso.datetime({ offset: true }),
    detail: ExportDetailSchema,
    format: ExportFormatSchema,
    planVersionId: z.uuid(),
    presentation: ExportPresentationSchema,
    schemaVersion: z.literal(EXPORT_SCHEMA_VERSION),
    status: z.literal("ready"),
  })
  .strict();

export type ExportChoice = z.infer<typeof ExportChoiceSchema>;
export type ExportCreateRequestContract = z.infer<typeof ExportCreateRequestSchema>;
export type ExportArtifactAck = z.infer<typeof ExportArtifactAckSchema>;
