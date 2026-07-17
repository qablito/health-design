export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

export function ensureTurnstileScript(
  targetDocument: Document = document,
): HTMLScriptElement {
  const existing = targetDocument.querySelector<HTMLScriptElement>(
    `script[src="${TURNSTILE_SCRIPT_URL}"]`,
  );
  if (existing) return existing;

  const script = targetDocument.createElement("script");
  script.src = TURNSTILE_SCRIPT_URL;
  script.async = true;
  script.defer = true;
  targetDocument.head.append(script);
  return script;
}
