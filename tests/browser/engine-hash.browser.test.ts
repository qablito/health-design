import { describe, expect, it } from "vitest";

import { canonicalJson, sha256CanonicalJson } from "../../packages/engine/src/index";

describe("contrato canónico del motor en navegador real", () => {
  it("coincide byte a byte con el vector de prueba de Node", async () => {
    const value = { b: 0.1, a: "Jose\u0301" };

    expect(canonicalJson(value)).toBe('{"a":"José","b":"0.1"}');
    await expect(sha256CanonicalJson(value)).resolves.toBe(
      "a44f7dce72420883053ef7a3b2f2a15bdd22153f94ce87943f3918bcc1909d14",
    );
  });
});
