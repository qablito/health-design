import { describe, expect, it } from "vitest";

import { getWebRuntimeSmoke } from "../../apps/web/src/runtime-smoke";
import {
  ensureTurnstileScript,
  TURNSTILE_SCRIPT_URL,
} from "../../apps/web/src/services/turnstile";

describe("contrato en navegador real", () => {
  it("se ejecuta en Chromium y conserva el payload canónico", () => {
    expect(window.document).toBeInstanceOf(Document);
    expect(navigator.userAgent).toContain("Chrome");
    expect(getWebRuntimeSmoke()).toEqual({
      schemaVersion: 1,
      kind: "runtime-smoke",
      message: "contrato compartido",
    });
  });

  it("monta una sola vez el script exacto de Turnstile", () => {
    const isolatedDocument = document.implementation.createHTMLDocument();
    const first = ensureTurnstileScript(isolatedDocument);
    const second = ensureTurnstileScript(isolatedDocument);

    expect(first).toBe(second);
    expect(first.src).toBe(TURNSTILE_SCRIPT_URL);
    expect(first.async).toBe(true);
    expect(first.defer).toBe(true);
    expect(isolatedDocument.scripts).toHaveLength(1);
  });
});
