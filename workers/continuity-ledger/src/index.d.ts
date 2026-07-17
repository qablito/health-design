export type ContinuityEnvironment = Record<string, unknown> & {
  CONTINUITY_RECONCILER_HMAC_KEY: string;
  CONTINUITY_RECONCILER_URL: string;
};

export declare class ContinuityLedger {
  constructor(state: unknown, env: unknown);
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
}

export declare function decryptAdminAuditRecord(
  record: Record<string, unknown>,
  kekBase64Url: string,
): Promise<unknown>;

export declare function signServiceRequest(input: {
  body: string;
  method: string;
  nonce: string;
  path: string;
  secret: string;
  timestamp: string;
}): Promise<string>;

export declare function triggerAdminReconciliation(
  env: ContinuityEnvironment,
  fetcher?: (request: Request) => Promise<Response>,
): Promise<void>;

export declare function validateAdminAuditPayload(
  candidate: unknown,
): Readonly<Record<string, unknown>>;

declare const worker: {
  fetch(request: Request, env: unknown): Response | Promise<Response>;
  scheduled(controller: unknown, env: unknown, context: unknown): void;
};

export default worker;
