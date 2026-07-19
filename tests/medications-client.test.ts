import { describe, expect, it, vi } from "vitest";

import {
  createMedicationsClient,
  MedicationSearchError,
} from "../apps/web/src/features/questionnaire/medications-client";

const response = {
  results: [
    {
      activeIngredients: ["SEMAGLUTIDA"],
      administrationRoutes: ["VÍA SUBCUTÁNEA"],
      aempsId: "117251002",
      commercialized: true,
      name: "OZEMPIC 0,25 MG SOLUCION INYECTABLE",
      prescriptionCondition: "Medicamento sujeto a prescripción médica",
      prescriptionRequired: true,
      registrationNumber: "117251002",
    },
  ],
  source: "AEMPS_CIMA",
} as const;

function setup(fetcher = vi.fn().mockResolvedValue(Response.json(response))) {
  return {
    client: createMedicationsClient({
      baseUrl: "https://example.supabase.co/functions/v1/medications",
      fetcher,
      getAccessToken: vi.fn().mockResolvedValue("access-token"),
      publishableKey: "publishable-key",
    }),
    fetcher,
  };
}

describe("cliente de identidades AEMPS/CIMA", () => {
  it("codifica la consulta y valida una respuesta canónica cerrada", async () => {
    const { client, fetcher } = setup();

    await expect(client.search("  Ozempic  ")).resolves.toEqual(response);
    const [url, init] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe("/functions/v1/medications/v1/search");
    expect(url.searchParams.get("q")).toBe("Ozempic");
    expect(url.searchParams.get("mode")).toBe("name");
    expect(url.searchParams.get("limit")).toBe("10");
    expect(init.headers).toMatchObject({
      apikey: "publishable-key",
      authorization: "Bearer access-token",
    });
  });

  it("permite una segunda búsqueda por principio activo", async () => {
    const { client, fetcher } = setup();

    await client.search("semaglutida", "active_ingredient");
    const [url] = fetcher.mock.calls[0] as [URL, RequestInit];
    expect(url.searchParams.get("mode")).toBe("active_ingredient");
  });

  it("rechaza entradas cortas y respuestas con identidad discordante", async () => {
    const invalidIdentity = {
      ...response,
      results: [{ ...response.results[0], registrationNumber: "999" }],
    };
    const { client, fetcher } = setup(
      vi.fn().mockResolvedValue(Response.json(invalidIdentity)),
    );

    await expect(client.search("a")).rejects.toThrow("invalid_medication_query");
    expect(fetcher).not.toHaveBeenCalled();
    await expect(client.search("Ozempic")).rejects.toBeInstanceOf(
      MedicationSearchError,
    );
  });
});
