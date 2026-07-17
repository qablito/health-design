import { describe, expect, it } from "vitest";

import {
  AccessScopeSchema,
  ActorRoleSchema,
  CodeLinkRequestSchema,
  DeviceLinkHandleSchema,
  InvitationRedeemRequestSchema,
  ProfileAccessSummarySchema,
  ProfileStatusSchema,
  QrLinkRequestSchema,
  RotatePrivateCodeRequestSchema,
} from "@health-design/contracts";
import { normalizeAlias } from "@health-design/domain";

describe("contrato de acceso", () => {
  it("normaliza mayúsculas y espacios de los alias ASCII permitidos", () => {
    expect(normalizeAlias("  JOSE   PENA  ")).toBe("jose pena");
    expect(normalizeAlias("PABLO_2-JR")).toBe("pablo_2-jr");
  });

  it("rechaza tildes, eñe y caracteres fuera de la lista permitida", () => {
    for (const alias of ["José", "Peña", "MARÍA", "Pablo!", "Pablo\tDos", "   "]) {
      expect(() => normalizeAlias(alias)).toThrow("invalid_alias");
    }
  });

  it("mantiene cerrados los estados públicos de V1", () => {
    expect(ActorRoleSchema.parse("device")).toBe("device");
    expect(ProfileStatusSchema.parse("deletion_requested")).toBe("deletion_requested");
    expect(AccessScopeSchema.parse("owner")).toBe("owner");
    expect(() => AccessScopeSchema.parse("editor")).toThrow();
  });

  it("rechaza propiedades adicionales en el resumen de acceso", () => {
    const summary = {
      accessScope: "owner",
      alias: "Pablo",
      profileId: "10000000-0000-4000-8000-000000000001",
      status: "active",
    } as const;

    expect(ProfileAccessSummarySchema.parse(summary)).toEqual(summary);
    expect(() =>
      ProfileAccessSummarySchema.parse({ ...summary, authSubject: "prohibido" }),
    ).toThrow();
  });

  it("mantiene estrictos los payloads públicos de invitación y vinculación", () => {
    const invitation = {
      adultAttested: true,
      alias: "Jose Pena",
      captchaToken: "turnstile-token",
      deviceLabel: "Portatil personal",
      invitationSecret: "invite-secret-with-at-least-128-bits",
      schemaVersion: 1,
      timezone: "Europe/Madrid",
    } as const;
    expect(InvitationRedeemRequestSchema.parse(invitation)).toEqual(invitation);
    expect(() =>
      InvitationRedeemRequestSchema.parse({ ...invitation, adultAttested: false }),
    ).toThrow();
    expect(() =>
      InvitationRedeemRequestSchema.parse({
        ...invitation,
        authSubject: crypto.randomUUID(),
      }),
    ).toThrow();

    expect(
      CodeLinkRequestSchema.parse({
        alias: "Jose Pena",
        challengeToken: "challenge",
        deviceLabel: "Movil",
        privateCode: "ABCD-EF01-2345-6789-ABCD-EF01-2345-6789",
        schemaVersion: 1,
      }),
    ).toBeDefined();
    expect(
      QrLinkRequestSchema.parse({
        deviceLabel: "Tablet",
        qrPayload: "healthdesign-link-v1.ABCDEFGHIJKLMNOPQRSTUV",
        schemaVersion: 1,
      }),
    ).toBeDefined();
    expect(
      RotatePrivateCodeRequestSchema.parse({
        revokeOtherAccess: false,
        schemaVersion: 1,
      }),
    ).toEqual({ revokeOtherAccess: false, schemaVersion: 1 });
  });

  it("expone solo el handle mínimo después de vincular", () => {
    const handle = {
      accessScope: "owner",
      alias: "Pablo",
      profileAccessId: "30000000-0000-4000-8000-000000000001",
      profileId: "10000000-0000-4000-8000-000000000001",
    } as const;

    expect(DeviceLinkHandleSchema.parse(handle)).toEqual(handle);
    expect(() =>
      DeviceLinkHandleSchema.parse({ ...handle, medication: "prohibido" }),
    ).toThrow();
  });
});
