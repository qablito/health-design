import { describe, expect, it } from "vitest";

import {
  AccessScopeSchema,
  ActorRoleSchema,
  ProfileAccessSummarySchema,
  ProfileStatusSchema,
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
});
