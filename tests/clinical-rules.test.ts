import { describe, expect, it } from "vitest";

import {
  CLINICAL_CATALOG_VERSION,
  ClinicalResultSchema,
} from "@health-design/contracts";
import {
  detectClinicalContext,
  normalizeClinicalText,
} from "../packages/engine/src/clinical/index";

describe("reglas clínicas selectivas", () => {
  it("normaliza Unicode sin sensibilidad a acentos", () => {
    expect(normalizeClinicalText("Restricción cardíaca")).toBe("restriccion cardiaca");
  });

  it("detecta restricción explícita y condiciones de volumen como cobertura parcial", () => {
    const result = detectClinicalContext({
      hydrationFluidRestriction: true,
      conditions: [{ name: "Enfermedad renal" }, { name: "Hiponatremia" }],
    });

    expect(result.coverage).toBe("partial");
    expect(result.detected.fluidRestriction).toBe(true);
    expect(result.detected.renal).toBe(true);
    expect(result.strictestActionLevel).toBe("immediate_conservative");
    expect(result.safetyFindings.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["FLUID_RESTRICTION_ACTIVE"]),
    );
    expect("medicationNames" in result).toBe(false);
    expect(ClinicalResultSchema.parse(result)).toEqual(result);
  });

  it("acepta el estado tipado de restricción declarada", () => {
    expect(
      detectClinicalContext({ hydrationFluidRestriction: "declared" }).detected
        .fluidRestriction,
    ).toBe(true);
  });

  it("no confunde subcadenas sensibles con entidades clínicas", () => {
    const result = detectClinicalContext({
      conditions: [{ name: "renalina" }, { name: "suprarrenal" }],
      medications: [{ name: "Semaglutidares" }, { name: "SARMiento" }],
    });
    expect(result.detected.renal).toBe(false);
    expect(result.detected.glp1).toBe(false);
    expect(result.detected.anabolic).toBe(false);
  });

  it("conserva frases válidas dentro de nombres descriptivos", () => {
    const result = detectClinicalContext({
      conditions: [{ name: "Antecedente de enfermedad renal crónica" }],
    });
    expect(result.detected.renal).toBe(true);
  });

  it("marca GLP-1 y diuréticos como parciales sin usar dosis", () => {
    const result = detectClinicalContext({
      medications: [
        { name: "Semaglutida", dose: "999 mg", frequency: "cada hora" },
        { name: "Furosemida", dose: "1 mg", frequency: "nunca" },
      ],
    });

    expect(result.coverage).toBe("partial");
    expect(result.detected.glp1).toBe(true);
    expect(result.detected.diuretic).toBe(true);
    expect(result.uncertainties.map(({ code }) => code)).toEqual(
      expect.arrayContaining(["GLP1_CONTEXT_PARTIAL", "DIURETIC_CONTEXT_PARTIAL"]),
    );
    expect(CLINICAL_CATALOG_VERSION).toBe("clinical-selective-v1");
  });

  it("solo desplaza el contexto anabólico al extremo alto y no recomienda su uso", () => {
    const result = detectClinicalContext({ medications: [{ name: "Testosterona" }] });

    expect(result.detected.anabolic).toBe(true);
    expect(result.strategies).toContain("high_side_only");
    expect(JSON.stringify(result)).not.toMatch(/recomendar|ajustar|dosis/i);
  });
});
