export const TURNSTILE_SCRIPT_URL =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileAction = "access_identity" | "access_invitation" | "access_link";

type TurnstileOptions = {
  action: TurnstileAction;
  siteKey?: string;
  targetDocument?: Document;
};

type TurnstileApi = {
  execute(widgetId: string): void;
  remove(widgetId: string): void;
  render(
    container: HTMLElement,
    options: {
      action: string;
      appearance: "interaction-only";
      callback(token: string): void;
      "error-callback"(): void;
      execution: "execute";
      "expired-callback"(): void;
      retry: "never";
      sitekey: string;
      "timeout-callback"(): void;
    },
  ): string;
};

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

function turnstileApi(targetWindow: Window): TurnstileApi | undefined {
  return (targetWindow as Window & { turnstile?: TurnstileApi }).turnstile;
}

async function waitForTurnstile(targetDocument: Document): Promise<TurnstileApi> {
  const targetWindow = targetDocument.defaultView;
  if (!targetWindow) throw new Error("turnstile_window_unavailable");
  const existing = turnstileApi(targetWindow);
  if (existing) return existing;

  const script = ensureTurnstileScript(targetDocument);
  await new Promise<void>((resolve, reject) => {
    const timeout = targetWindow.setTimeout(
      () => reject(new Error("turnstile_load_timeout")),
      15_000,
    );
    const check = () => {
      if (turnstileApi(targetWindow)) {
        targetWindow.clearTimeout(timeout);
        resolve();
      }
    };
    script.addEventListener("load", check, { once: true });
    script.addEventListener(
      "error",
      () => {
        targetWindow.clearTimeout(timeout);
        reject(new Error("turnstile_load_failed"));
      },
      { once: true },
    );
    const poll = targetWindow.setInterval(() => {
      if (turnstileApi(targetWindow)) {
        targetWindow.clearInterval(poll);
        check();
      }
    }, 50);
    targetWindow.setTimeout(() => targetWindow.clearInterval(poll), 15_100);
  });
  const loaded = turnstileApi(targetWindow);
  if (!loaded) throw new Error("turnstile_unavailable");
  return loaded;
}

export async function requestTurnstileToken({
  action,
  siteKey = import.meta.env.VITE_TURNSTILE_SITE_KEY,
  targetDocument = document,
}: TurnstileOptions): Promise<string> {
  const api = await waitForTurnstile(targetDocument);
  const container = targetDocument.createElement("div");
  container.className = "turnstile-challenge";
  container.setAttribute("aria-live", "polite");
  targetDocument.body.append(container);

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    let widgetId = "";
    const cleanup = () => {
      if (widgetId) api.remove(widgetId);
      container.remove();
    };
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      cleanup();
      operation();
    };
    widgetId = api.render(container, {
      action,
      appearance: "interaction-only",
      callback: (token) => finish(() => resolve(token)),
      "error-callback": () =>
        finish(() => reject(new Error("turnstile_challenge_failed"))),
      execution: "execute",
      "expired-callback": () =>
        finish(() => reject(new Error("turnstile_token_expired"))),
      retry: "never",
      sitekey: siteKey,
      "timeout-callback": () =>
        finish(() => reject(new Error("turnstile_challenge_timeout"))),
    });
    api.execute(widgetId);
  });
}
