import { createHash, createHmac, randomUUID } from "node:crypto";

function signedHeaders({ hmacKey, method, path }) {
  if (typeof hmacKey !== "string" || Buffer.byteLength(hmacKey) < 32) {
    throw new Error("invalid_ledger_hmac_key");
  }
  const timestamp = new Date().toISOString();
  const nonce = randomUUID();
  const bodyHash = createHash("sha256").update("").digest("hex");
  const signature = createHmac("sha256", hmacKey)
    .update(`${timestamp}\n${nonce}\n${method}\n${path}\n${bodyHash}`)
    .digest("hex");
  return {
    "x-ledger-nonce": nonce,
    "x-ledger-signature": signature,
    "x-ledger-timestamp": timestamp,
  };
}

export function createLiveLedgerHeadProvider(bundle, fetcher = fetch) {
  const base = new URL(bundle?.continuityLedgerUrl);
  if (
    base.protocol !== "https:" ||
    base.search ||
    base.hash ||
    (base.pathname !== "/" && base.pathname !== "")
  ) {
    throw new Error("invalid_continuity_ledger_url");
  }
  const hmacKey = bundle?.continuityLedgerHmacKey;
  return async (stream, sequence) => {
    if (
      !["deletions", "admin-audit"].includes(stream) ||
      !Number.isSafeInteger(sequence) ||
      sequence < 0
    ) {
      throw new Error("invalid_ledger_head_request");
    }
    const path = `/v1/${stream}/head/${sequence}`;
    const response = await fetcher(new URL(path, base), {
      headers: signedHeaders({ hmacKey, method: "GET", path }),
      method: "GET",
      referrerPolicy: "no-referrer",
    });
    if (!response.ok) throw new Error("live_ledger_head_unavailable");
    const value = await response.json();
    if (!value || typeof value !== "object" || !value.current || !value.requested) {
      throw new Error("invalid_live_ledger_head");
    }
    const suffixRecords = [];
    const missingSequences = [];
    for (
      let from = value.requested.sequence + 1;
      from <= value.current.sequence;
      from += 500
    ) {
      const to = Math.min(from + 499, value.current.sequence);
      const recordsPath = `/v1/${stream}/records/${from}/${to}`;
      const recordsResponse = await fetcher(new URL(recordsPath, base), {
        headers: signedHeaders({ hmacKey, method: "GET", path: recordsPath }),
        method: "GET",
        referrerPolicy: "no-referrer",
      });
      if (!recordsResponse.ok) throw new Error("live_ledger_suffix_unavailable");
      const page = await recordsResponse.json();
      if (
        !page ||
        !Array.isArray(page.records) ||
        !Array.isArray(page.missingSequences) ||
        page.missingSequences.some(
          (sequence) =>
            !Number.isSafeInteger(sequence) || sequence < from || sequence > to,
        )
      ) {
        throw new Error("invalid_live_ledger_suffix");
      }
      suffixRecords.push(...page.records);
      missingSequences.push(...page.missingSequences);
    }
    return { ...value, missingSequences, suffixRecords };
  };
}
