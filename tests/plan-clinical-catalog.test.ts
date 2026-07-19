import { describe, expect, it, vi } from "vitest";

import { hydrateActiveClinicalCatalog } from "../supabase/functions/plans/clinical-catalog.ts";

const descriptorPayload = {
  canonicalizationVersion: "canonical-json-v1",
  clinicalCatalogVersion: "clinical-selective-v2",
  hashAlgorithm: "sha256",
  ruleSetRevisionId: "9cf98aae-0f9f-452f-9577-72283eeff4d5",
  schemaVersion: 1,
  sourceManifestId: "d46591cd-ae2a-4330-a037-c39436cae923",
} as const;

const descriptor = {
  ...descriptorPayload,
  descriptorHash: "af2fb4b04376b25e6054e0c12bc9df144a5ee8a0df585813c871f9505530752e",
} as const;

describe("descriptor clínico activo para planes", () => {
  it("acepta solo la revisión compilada y comprueba su hash reproducible", async () => {
    const hashCanonical = vi.fn().mockResolvedValue(descriptor.descriptorHash);

    await expect(
      hydrateActiveClinicalCatalog(descriptor, hashCanonical),
    ).resolves.toEqual(descriptor);
    expect(hashCanonical).toHaveBeenCalledWith(descriptorPayload);
  });

  it("rechaza ids, versión, hash o campos adicionales no compilados", async () => {
    const hashCanonical = vi.fn().mockResolvedValue(descriptor.descriptorHash);

    await expect(
      hydrateActiveClinicalCatalog(
        { ...descriptor, ruleSetRevisionId: crypto.randomUUID() },
        hashCanonical,
      ),
    ).rejects.toThrow("clinical_catalog_descriptor_mismatch");
    await expect(
      hydrateActiveClinicalCatalog(
        { ...descriptor, descriptorHash: "00".repeat(32) },
        hashCanonical,
      ),
    ).rejects.toThrow("clinical_catalog_descriptor_hash_mismatch");
    await expect(
      hydrateActiveClinicalCatalog(
        { ...descriptor, executableRules: [] },
        hashCanonical,
      ),
    ).rejects.toThrow("invalid_clinical_catalog_descriptor");
  });

  it("rechaza ausencia o multiplicidad de catálogos activos", async () => {
    const hashCanonical = vi.fn().mockResolvedValue(descriptor.descriptorHash);

    await expect(hydrateActiveClinicalCatalog(null, hashCanonical)).rejects.toThrow(
      "invalid_clinical_catalog_descriptor",
    );
    await expect(
      hydrateActiveClinicalCatalog([descriptor, descriptor], hashCanonical),
    ).rejects.toThrow("invalid_clinical_catalog_descriptor");
  });
});
