import { describe, expect, it } from "vitest";

import {
  CIQUAL_2025_EXPECTED_MD5,
  CIQUAL_2025_EXPECTED_SHA256,
  CIQUAL_2025_DOWNLOAD_ACCEPT,
  CIQUAL_2025_SOURCE_VERSION,
  parseCiqualValue,
} from "../scripts/import-nutrition/ciqual-2025";

describe("importador oficial CIQUAL 2025", () => {
  it("fija versión y digests publicados/verificados del artefacto oficial", () => {
    expect(CIQUAL_2025_SOURCE_VERSION).toBe("2025");
    expect(CIQUAL_2025_EXPECTED_MD5).toBe("0d9758ce23f3f13dd63a005bc1bb4f2c");
    expect(CIQUAL_2025_EXPECTED_SHA256).toBe(
      "5555c572fa3735991298d832d0427788fa69a11b4fd20a5d580d58942369fbb0",
    );
    expect(CIQUAL_2025_DOWNLOAD_ACCEPT).toBe("*/*");
  });

  it("normaliza coma decimal sin convertir ausencias, trazas ni límites en cero", () => {
    expect(parseCiqualValue("23,40")).toEqual({ state: "known", value: "23.4" });
    expect(parseCiqualValue("-")).toEqual({ state: "missing", value: null });
    expect(parseCiqualValue("traces")).toEqual({
      originalValue: "traces",
      state: "trace",
      value: null,
    });
    expect(parseCiqualValue("&lt; 0,5")).toEqual({
      intervalMaximum: "0.5",
      intervalMinimum: "0",
      originalValue: "< 0,5",
      state: "less_than",
      value: null,
    });
  });
});
