import { describe, expect, it } from "vitest";

import { getWebRuntimeSmoke } from "../../apps/web/src/runtime-smoke";

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
});
