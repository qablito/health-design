import type { LedgerHeadProvider } from "./recovery-set.mjs";

export function createLiveLedgerHeadProvider(
  bundle: {
    continuityLedgerHmacKey: string;
    continuityLedgerUrl: string;
  },
  fetcher?: typeof fetch,
): LedgerHeadProvider;
