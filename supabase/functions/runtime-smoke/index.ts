import { isRuntimeSmokePayload } from "../_shared/generated/contracts.js";

const JSON_HEADERS = {
  "cache-control": "no-store",
  "content-type": "application/json; charset=utf-8",
} as const;

const MAX_BODY_BYTES = 1_024;

type LimitedBody = { body: string; tooLarge: false } | { body?: never; tooLarge: true };

async function readLimitedBody(
  request: Request,
  maximumBytes: number,
): Promise<LimitedBody> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    const parsedLength = Number.parseInt(contentLength, 10);
    if (Number.isFinite(parsedLength) && parsedLength > maximumBytes) {
      return { tooLarge: true };
    }
  }

  if (!request.body) return { body: "", tooLarge: false };

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maximumBytes) {
      // Deno aborta también la respuesta HTTP si se cancela el body entrante.
      // Liberar el reader detiene nuestro consumo y permite devolver el 413.
      reader.releaseLock();
      return { tooLarge: true };
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { body: new TextDecoder().decode(bytes), tooLarge: false };
}

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    headers: JSON_HEADERS,
    status,
  });
}

export async function handleRuntimeSmoke(request: Request): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, {
      headers: { allow: "POST", "cache-control": "no-store" },
      status: 405,
    });
  }

  const mediaType = request.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (mediaType !== "application/json") {
    return jsonResponse({ error: "content_type_must_be_json" }, 415);
  }

  const limitedBody = await readLimitedBody(request, MAX_BODY_BYTES);
  if (limitedBody.tooLarge) {
    return jsonResponse({ error: "payload_too_large" }, 413);
  }
  const rawBody = limitedBody.body;

  let candidate: unknown;
  try {
    candidate = JSON.parse(rawBody) as unknown;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  if (!isRuntimeSmokePayload(candidate)) {
    return jsonResponse({ error: "invalid_runtime_smoke_payload" }, 400);
  }

  return jsonResponse(candidate, 200);
}

export default {
  fetch: handleRuntimeSmoke,
};
