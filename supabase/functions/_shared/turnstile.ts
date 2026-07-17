const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const SITEVERIFY_TIMEOUT_MS = 5_000;

type TurnstileInput = {
  expectedAction?: string;
  expectedHostname?: string;
  remoteIp?: string;
  secret: string;
  token: string;
};

export async function verifyTurnstile(
  input: TurnstileInput,
  fetcher: typeof fetch = fetch,
): Promise<{ ok: boolean }> {
  if (
    input.token.length === 0 ||
    input.token.length > 2_048 ||
    input.secret.length === 0
  ) {
    return { ok: false };
  }

  const body = new URLSearchParams({
    response: input.token,
    secret: input.secret,
  });
  if (input.remoteIp) body.set("remoteip", input.remoteIp);

  try {
    const response = await fetcher(SITEVERIFY_URL, {
      body,
      method: "POST",
      signal: AbortSignal.timeout(SITEVERIFY_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false };

    const result = (await response.json()) as Record<string, unknown>;
    if (result.success !== true) return { ok: false };
    if (input.expectedAction && result.action !== input.expectedAction) {
      return { ok: false };
    }
    if (input.expectedHostname && result.hostname !== input.expectedHostname) {
      return { ok: false };
    }
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
