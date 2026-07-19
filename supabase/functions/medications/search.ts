import { AempsMedicationSearchResponseSchema } from "@health-design/contracts";
import { resolveCors, type EdgeEnvironment } from "../_shared/cors.ts";

const CIMA_SEARCH_URL = "https://cima.aemps.es/cima/rest/medicamentos";
const MAX_UPSTREAM_BYTES = 1_000_000;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const QUERY_PATTERN = /^\p{L}[\p{L}\p{N} .,'()+/-]*$/u;
const REGISTRATION_PATTERN = /^[0-9A-Z]{1,32}$/;
const UUIDLESS_REQUEST_ID = "medication-search";

type AuthContext = { userId: string };

export interface MedicationSearchDependencies {
  authenticate: (token: string) => Promise<AuthContext>;
  cacheIdentities: (identities: readonly CachedMedicationIdentity[]) => Promise<void>;
  environment: EdgeEnvironment;
  fetchCima: (input: string, init: RequestInit) => Promise<Response>;
  hashCanonical: (value: unknown) => Promise<string>;
  now: () => Date;
}

export type CachedMedicationIdentity = Readonly<{
  activeIngredients: readonly string[];
  administrationRoutes: readonly string[];
  aempsId: string;
  canonicalName: string;
  commercialized: boolean | null;
  prescriptionRequired: boolean | null;
  retrievedAt: string;
  sourceHash: string;
  sourceVersion: "CIMA_REST_API_1_23";
}>;

type ErrorCode =
  | "DEPENDENCY_UNAVAILABLE"
  | "FORBIDDEN"
  | "INTERNAL_ERROR"
  | "INVALID_INPUT"
  | "METHOD_NOT_ALLOWED"
  | "NOT_FOUND"
  | "UNAUTHENTICATED";

class MedicationHttpError extends Error {
  constructor(
    readonly code: ErrorCode,
    readonly status: number,
  ) {
    super(code);
  }
}

function headers(corsHeaders: Record<string, string>): Record<string, string> {
  return {
    "cache-control": "no-store, private",
    "content-type": "application/json; charset=utf-8",
    "referrer-policy": "no-referrer",
    "x-content-type-options": "nosniff",
    ...corsHeaders,
  };
}

function json(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
): Response {
  return new Response(JSON.stringify(body), {
    headers: headers(corsHeaders),
    status,
  });
}

function errorResponse(
  error: MedicationHttpError,
  corsHeaders: Record<string, string>,
): Response {
  return json(
    {
      error: {
        code: error.code,
        message_key: `medications.${error.code.toLowerCase()}`,
        request_id: UUIDLESS_REQUEST_ID,
        retryable: error.status === 503,
      },
    },
    error.status,
    corsHeaders,
  );
}

function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
  }
  return value as Record<string, unknown>;
}

function requiredText(
  record: Record<string, unknown>,
  key: string,
  maximum: number,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length < 1 || value.length > maximum) {
    throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
  }
  return value;
}

function optionalBoolean(record: Record<string, unknown>, key: string): boolean | null {
  const value = record[key];
  if (value === undefined || value === null) return null;
  if (typeof value !== "boolean") {
    throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
  }
  return value;
}

function activeIngredients(record: Record<string, unknown>): string[] {
  const raw = record.pactivos;
  let ingredients: string[];
  if (raw !== undefined && raw !== null) {
    ingredients = requiredText(record, "pactivos", 1_000)
      .split(",")
      .map((ingredient) => ingredient.trim())
      .filter(Boolean);
  } else {
    const vtm = object(record.vtm);
    const keys = Object.keys(vtm).sort();
    if (
      keys.length !== 2 ||
      keys[0] !== "id" ||
      keys[1] !== "nombre" ||
      typeof vtm.id !== "number" ||
      !Number.isSafeInteger(vtm.id) ||
      vtm.id < 1
    ) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    ingredients = [requiredText(vtm, "nombre", 200).trim()];
  }
  if (
    ingredients.length === 0 ||
    ingredients.length > 20 ||
    ingredients.some((ingredient) => ingredient.length > 200)
  ) {
    throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
  }
  return ingredients;
}

function parseUpstream(value: unknown, limit: number) {
  const root = object(value);
  if (root.pagina !== 1 || !Array.isArray(root.resultados)) {
    throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
  }
  if (root.resultados.length > 200) {
    throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
  }

  return root.resultados.slice(0, limit).map((entry) => {
    const medication = object(entry);
    const registrationNumber = requiredText(medication, "nregistro", 32);
    if (!REGISTRATION_PATTERN.test(registrationNumber)) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    const parsedActiveIngredients = activeIngredients(medication);

    const rawRoutes = medication.viasAdministracion;
    if (rawRoutes !== undefined && !Array.isArray(rawRoutes)) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    const administrationRoutes = (rawRoutes ?? []).map((route) =>
      requiredText(object(route), "nombre", 120),
    );
    if (administrationRoutes.length > 20) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }

    const prescriptionCondition = medication.cpresc;
    if (
      prescriptionCondition !== undefined &&
      (typeof prescriptionCondition !== "string" || prescriptionCondition.length > 500)
    ) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }

    return {
      activeIngredients: parsedActiveIngredients,
      administrationRoutes,
      aempsId: registrationNumber,
      commercialized: optionalBoolean(medication, "comerc"),
      name: requiredText(medication, "nombre", 500),
      prescriptionCondition:
        typeof prescriptionCondition === "string" ? prescriptionCondition : null,
      prescriptionRequired: optionalBoolean(medication, "receta"),
      registrationNumber,
    };
  });
}

function bearer(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (!authorization?.startsWith("Bearer ") || authorization.length <= 7) {
    throw new MedicationHttpError("UNAUTHENTICATED", 401);
  }
  return authorization.slice(7);
}

export async function handleMedicationSearch(
  request: Request,
  dependencies: MedicationSearchDependencies,
): Promise<Response> {
  const cors = resolveCors(request.headers.get("origin"), dependencies.environment);
  if (!cors.allowed) {
    return errorResponse(new MedicationHttpError("FORBIDDEN", 403), {});
  }
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        ...headers(cors.headers),
        "access-control-allow-headers":
          "authorization, apikey, x-client-info, content-type",
        "access-control-allow-methods": "GET, OPTIONS",
      },
      status: 204,
    });
  }

  try {
    if (request.method !== "GET") {
      throw new MedicationHttpError("METHOD_NOT_ALLOWED", 405);
    }
    const url = new URL(request.url);
    if (!url.pathname.endsWith("/v1/search")) {
      throw new MedicationHttpError("NOT_FOUND", 404);
    }
    try {
      await dependencies.authenticate(bearer(request));
    } catch {
      throw new MedicationHttpError("UNAUTHENTICATED", 401);
    }

    const query = (url.searchParams.get("q") ?? "").trim();
    const mode = url.searchParams.get("mode") ?? "name";
    const limitText = url.searchParams.get("limit") ?? "10";
    if (
      query.length < 2 ||
      query.length > 120 ||
      !QUERY_PATTERN.test(query) ||
      (mode !== "name" && mode !== "active_ingredient") ||
      !/^(?:[1-9]|1[0-9]|20)$/.test(limitText)
    ) {
      throw new MedicationHttpError("INVALID_INPUT", 400);
    }
    const limit = Number(limitText);
    const upstreamUrl = new URL(CIMA_SEARCH_URL);
    upstreamUrl.searchParams.set(mode === "name" ? "nombre" : "practiv1", query);
    upstreamUrl.searchParams.set("pagina", "1");

    let upstream: Response;
    try {
      upstream = await dependencies.fetchCima(upstreamUrl.toString(), {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3_000),
      });
    } catch {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    if (!upstream.ok) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    const contentType = upstream.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    const contentLength = upstream.headers.get("content-length");
    if (
      contentLength !== null &&
      (!/^\d+$/.test(contentLength) || Number(contentLength) > MAX_UPSTREAM_BYTES)
    ) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    let raw: string;
    try {
      raw = await upstream.text();
    } catch {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    if (new TextEncoder().encode(raw).byteLength > MAX_UPSTREAM_BYTES) {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
    }
    const responseBody = (() => {
      try {
        return AempsMedicationSearchResponseSchema.parse({
          results: parseUpstream(parsed, limit),
          source: "AEMPS_CIMA",
        });
      } catch (error) {
        if (error instanceof MedicationHttpError) throw error;
        throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 502);
      }
    })();
    const retrievedAt = dependencies.now().toISOString();
    try {
      const identities = await Promise.all(
        responseBody.results.map(async (result) => {
          const canonical = {
            activeIngredients: result.activeIngredients,
            administrationRoutes: result.administrationRoutes,
            aempsId: result.aempsId,
            canonicalName: result.name,
            commercialized: result.commercialized,
            prescriptionRequired: result.prescriptionRequired,
          };
          const sourceHash = await dependencies.hashCanonical(canonical);
          if (!HASH_PATTERN.test(sourceHash)) {
            throw new Error("invalid_source_hash");
          }
          return {
            ...canonical,
            retrievedAt,
            sourceHash,
            sourceVersion: "CIMA_REST_API_1_23" as const,
          };
        }),
      );
      if (identities.length > 0) {
        await dependencies.cacheIdentities(identities);
      }
    } catch {
      throw new MedicationHttpError("DEPENDENCY_UNAVAILABLE", 503);
    }
    return json(responseBody, 200, cors.headers);
  } catch (error) {
    if (error instanceof MedicationHttpError) {
      return errorResponse(error, cors.headers);
    }
    return errorResponse(new MedicationHttpError("INTERNAL_ERROR", 500), cors.headers);
  }
}
