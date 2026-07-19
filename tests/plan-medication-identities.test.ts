import { describe, expect, it } from "vitest";

import { hydrateCanonicalMedicationIdentities } from "../supabase/functions/plans/medication-identities.ts";

const identity = {
  activeIngredients: ["SEMAGLUTIDA"],
  administrationRoutes: ["VÍA SUBCUTÁNEA"],
  aempsId: "117251002",
  canonicalName: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
  commercialized: true,
  prescriptionRequired: true,
  retrievedAt: "2026-07-19T19:00:00+00:00",
  sourceHash: "ab".repeat(32),
  sourceVersion: "CIMA_REST_API_1_23",
} as const;

describe("identidades AEMPS canónicas para el motor", () => {
  it("hidrata solo IDs solicitados y permite que falten IDs no resueltos", () => {
    expect(
      hydrateCanonicalMedicationIdentities(
        [identity],
        new Set([identity.aempsId, "999999999"]),
      ),
    ).toEqual([identity]);
  });

  it("rechaza filas duplicadas o no solicitadas", () => {
    expect(() =>
      hydrateCanonicalMedicationIdentities(
        [identity, identity],
        new Set([identity.aempsId]),
      ),
    ).toThrow("invalid_clinical_medication_identities");
    expect(() =>
      hydrateCanonicalMedicationIdentities([identity], new Set(["999999999"])),
    ).toThrow("invalid_clinical_medication_identities");
  });

  it("rechaza procedencia, hash, fecha o forma no canónica", () => {
    expect(() =>
      hydrateCanonicalMedicationIdentities(
        [{ ...identity, sourceVersion: "CIMA_REST_API_1_19" }],
        new Set([identity.aempsId]),
      ),
    ).toThrow("invalid_clinical_medication_identities");
    expect(() =>
      hydrateCanonicalMedicationIdentities(
        [{ ...identity, sourceHash: "no" }],
        new Set([identity.aempsId]),
      ),
    ).toThrow("invalid_clinical_medication_identities");
    expect(() =>
      hydrateCanonicalMedicationIdentities(
        [{ ...identity, retrievedAt: "not-a-date" }],
        new Set([identity.aempsId]),
      ),
    ).toThrow("invalid_clinical_medication_identities");
    expect(() =>
      hydrateCanonicalMedicationIdentities(
        [{ ...identity, executableRule: "never" }],
        new Set([identity.aempsId]),
      ),
    ).toThrow("invalid_clinical_medication_identities");
  });
});
