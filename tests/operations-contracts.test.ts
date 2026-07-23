import { describe, expect, it } from "vitest";

import {
  AdminBackupCreateRequestSchema,
  AdminBackupJobSchema,
  AdminDeletionJobSchema,
  AdminPermanentDeletionRequestSchema,
  AdminRestoreJobSchema,
  AdminRestorePromoteRequestSchema,
  DeletionRequestCreateSchema,
  DeletionRequestStatusSchema,
} from "@health-design/contracts";

const jobId = "10000000-0000-4000-8000-000000000018";
const profileId = "20000000-0000-4000-8000-000000000018";
const timestamp = "2026-07-23T17:00:00.000Z";

describe("contratos operativos T18", () => {
  it("exige la confirmación irreversible y mantiene opaco el handle público", () => {
    expect(
      DeletionRequestCreateSchema.parse({
        alias: "Perfil T18",
        confirmationPhrase: "BORRAR MI PERFIL PERMANENTEMENTE",
        irreversible: true,
        schemaVersion: 1,
      }),
    ).toBeDefined();
    expect(() =>
      DeletionRequestCreateSchema.parse({
        alias: "Perfil T18",
        confirmationPhrase: "quizá",
        irreversible: true,
        schemaVersion: 1,
      }),
    ).toThrow();

    const status = {
      completedAt: null,
      errorCode: null,
      handle: "A".repeat(43),
      requestedAt: timestamp,
      schemaVersion: 1,
      status: "queued",
    } as const;
    expect(DeletionRequestStatusSchema.parse(status)).toEqual(status);
    expect(() =>
      DeletionRequestStatusSchema.parse({
        ...status,
        profileMarker: "prohibido",
      }),
    ).toThrow();
  });

  it("cierra estados, pasos y errores del job de borrado", () => {
    const job = {
      attempts: 1,
      completedAt: null,
      errorCode: "storage_unavailable",
      jobId,
      profileId,
      requestedAt: timestamp,
      schemaVersion: 1,
      status: "failed",
      steps: [
        { completed: true, name: "ledger" },
        { completed: true, name: "access" },
        { completed: false, name: "exports" },
        { completed: false, name: "storage" },
        { completed: false, name: "profile_data" },
        { completed: false, name: "auth" },
        { completed: false, name: "verification" },
      ],
      version: 3,
    } as const;
    expect(AdminDeletionJobSchema.parse(job)).toEqual(job);
    expect(() =>
      AdminDeletionJobSchema.parse({
        ...job,
        errorCode: "texto libre con datos",
      }),
    ).toThrow();
    expect(() =>
      AdminDeletionJobSchema.parse({
        ...job,
        profileMarker: "prohibido",
      }),
    ).toThrow();
  });

  it("exige versión y doble confirmación para la purga administrativa", () => {
    expect(
      AdminPermanentDeletionRequestSchema.parse({
        confirmationPhrase: "PURGAR PERFIL PERMANENTEMENTE",
        confirmed: true,
        expectedVersion: 3,
        schemaVersion: 1,
      }),
    ).toBeDefined();
    expect(() =>
      AdminPermanentDeletionRequestSchema.parse({
        confirmationPhrase: "PURGAR PERFIL PERMANENTEMENTE",
        confirmed: false,
        expectedVersion: 3,
        schemaVersion: 1,
      }),
    ).toThrow();
  });

  it("modela backups y restores sin rutas ni secretos", () => {
    expect(
      AdminBackupCreateRequestSchema.parse({
        kind: "precritical",
        schemaVersion: 1,
      }),
    ).toBeDefined();

    const backup = {
      backupId: jobId,
      createdAt: timestamp,
      kind: "weekly",
      schemaVersion: 1,
      status: "ready",
      verifiedAt: timestamp,
      version: 4,
    } as const;
    expect(AdminBackupJobSchema.parse(backup)).toEqual(backup);
    expect(() =>
      AdminBackupJobSchema.parse({ ...backup, objectPath: "privado/dump" }),
    ).toThrow();

    const restore = {
      backupId: jobId,
      createdAt: timestamp,
      restoreId: profileId,
      schemaVersion: 1,
      status: "ready_for_promotion",
      verifiedAt: timestamp,
      version: 6,
    } as const;
    expect(AdminRestoreJobSchema.parse(restore)).toEqual(restore);
    expect(
      AdminRestorePromoteRequestSchema.parse({
        confirmationPhrase: "PROMOVER RESTAURACIÓN VERIFICADA",
        confirmed: true,
        expectedVersion: 6,
        schemaVersion: 1,
      }),
    ).toBeDefined();
  });
});
