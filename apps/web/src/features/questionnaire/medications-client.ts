import {
  AempsMedicationSearchResponseSchema,
  type AempsMedicationSearchResponse,
} from "@health-design/contracts";

type Dependencies = Readonly<{
  baseUrl: string;
  fetcher: typeof fetch;
  getAccessToken: () => Promise<string>;
  publishableKey: string;
}>;

export class MedicationSearchError extends Error {
  constructor(readonly status: number) {
    super(status === 401 ? "medications.unauthenticated" : "medications.search_failed");
    this.name = "MedicationSearchError";
  }
}

export function createMedicationsClient(dependencies: Dependencies) {
  let activeController: AbortController | undefined;
  let requestVersion = 0;

  function cancelPending() {
    requestVersion += 1;
    activeController?.abort();
    activeController = undefined;
  }

  return {
    cancelPending,
    async search(
      query: string,
      mode: "active_ingredient" | "name" = "name",
    ): Promise<AempsMedicationSearchResponse> {
      const normalized = query.trim();
      if (normalized.length < 2 || normalized.length > 120) {
        throw new Error("invalid_medication_query");
      }
      cancelPending();
      const controller = new AbortController();
      const currentVersion = requestVersion;
      activeController = controller;
      const token = await dependencies.getAccessToken();
      const url = new URL(`${dependencies.baseUrl}/v1/search`);
      url.searchParams.set("limit", "10");
      url.searchParams.set("mode", mode);
      url.searchParams.set("q", normalized);
      const response = await dependencies.fetcher(url, {
        headers: {
          apikey: dependencies.publishableKey,
          authorization: `Bearer ${token}`,
          "x-client-info": "health-design-web/medications-v1",
        },
        method: "GET",
        referrerPolicy: "no-referrer",
        signal: controller.signal,
      });
      if (controller.signal.aborted || currentVersion !== requestVersion) {
        throw new DOMException("Medication search superseded", "AbortError");
      }
      if (!response.ok) throw new MedicationSearchError(response.status);
      let body: unknown;
      try {
        body = await response.json();
      } catch {
        throw new MedicationSearchError(502);
      }
      const parsed = AempsMedicationSearchResponseSchema.safeParse(body);
      if (!parsed.success) throw new MedicationSearchError(502);
      if (controller.signal.aborted || currentVersion !== requestVersion) {
        throw new DOMException("Medication search superseded", "AbortError");
      }
      if (activeController === controller) activeController = undefined;
      return parsed.data;
    },
  };
}

async function accessToken(): Promise<string> {
  const { supabaseAuth } = await import("../../services/supabase");
  const { data, error } = await supabaseAuth.getSession();
  const token = data.session?.access_token;
  if (error || !token) throw new MedicationSearchError(401);
  return token;
}

export const medicationsClient = createMedicationsClient({
  baseUrl: `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/medications`,
  fetcher: fetch,
  getAccessToken: accessToken,
  publishableKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
});
