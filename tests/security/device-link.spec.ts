import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

const root = new URL("../../", import.meta.url);

describe("no filtración de credenciales de vinculación", () => {
  it("mantiene invitación, QR y código fuera de URL, logs y almacenamiento del navegador", async () => {
    const [edgeSource, webSource] = await Promise.all([
      readFile(new URL("supabase/functions/access/index.ts", root), "utf8"),
      readFile(new URL("apps/web/src/features/access/access-client.ts", root), "utf8"),
    ]);

    expect(edgeSource).not.toMatch(/console\.(?:log|info|warn|error)\s*\(/);
    expect(edgeSource).not.toMatch(/searchParams\.get\s*\(/);
    expect(webSource).not.toMatch(/(?:localStorage|sessionStorage|clipboard)/);
    expect(webSource).not.toMatch(
      /(?:invitationSecret|qrPayload|privateCode).*URLSearchParams/s,
    );
    expect(webSource).toContain("body: JSON.stringify");
  });

  it("no permite que el cliente envíe sujeto, actor, rol o sesión", async () => {
    const clientSource = await readFile(
      new URL("apps/web/src/features/access/access-client.ts", root),
      "utf8",
    );

    expect(clientSource).not.toMatch(/authSubject|actorId|authSessionId|role\s*:/);
  });
});
