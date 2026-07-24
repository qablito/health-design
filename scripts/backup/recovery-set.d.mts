export type RecoveryObjectType =
  "database" | "storage" | "deletions-ledger" | "admin-audit-ledger";

export interface LedgerPrefix {
  hash: string;
  sequence: number;
}

export interface RecoverySourceObject {
  bytes: Uint8Array;
  logicalPath: string;
  prefix?: LedgerPrefix;
  profileMarker?: string;
  type: RecoveryObjectType;
}

export interface OperatorKeyring {
  keks: Map<number, Uint8Array>;
  ledgerSigningPrivateKey?: CryptoKey;
  ledgerSigningPublicKeys: Map<number, CryptoKey>;
  signingKeyVersion: number;
  signingPrivateKey?: CryptoKey;
  signingPublicKeys: Map<number, CryptoKey>;
}

export interface ManifestObject {
  bytes?: Uint8Array;
  index: number;
  logicalPath: string;
  plaintextHash: string;
  prefix?: LedgerPrefix;
  profileMarker?: string;
  size: number;
  type: RecoveryObjectType;
}

export interface RecoveryManifest {
  backupId: string;
  createdAt: string;
  formatVersion: number;
  keyVersion: number;
  kind: "weekly" | "precritical";
  objects: ManifestObject[];
  schemaVersion: number;
  sourceEnvironment: "local" | "development";
  storageInventory: Array<{
    bucket: string;
    enumerated: true;
    logicalPaths: string[];
  }>;
  toolVersion: string;
}

export interface EnvelopeObject {
  ciphertextHash: string;
  file: string;
  index: number;
  type: RecoveryObjectType;
  wrappedDek: string;
}

export interface RecoveryEnvelope {
  backupId: string;
  createdAt: string;
  formatVersion: number;
  keyVersion: number;
  kind: "weekly" | "precritical";
  objects: EnvelopeObject[];
  schemaVersion: number;
  signingKeyVersion: number;
  sourceEnvironment: "local" | "development";
  toolVersion: string;
}

export interface CreateRecoverySetInput {
  backupId: string;
  createdAt: string;
  destinationDirectory: string;
  keyVersion: number;
  keyring: OperatorKeyring;
  kind: "weekly" | "precritical";
  objects: RecoverySourceObject[];
  schemaVersion: number;
  sourceEnvironment: "local" | "development" | "production";
  storageInventory: Array<{
    bucket: string;
    enumerated: true;
    logicalPaths: string[];
  }>;
  toolVersion: string;
}

export interface RemoteLedgerHeads {
  "admin-audit": SignedLedgerHead;
  deletions: SignedLedgerHead;
}

export interface LiveLedgerHeadResult {
  current: LedgerReceipt;
  requested: LedgerReceipt;
  suffixRecords: unknown[];
}

export type LedgerHeadProvider = (
  stream: "admin-audit" | "deletions",
  sequence: number,
) => Promise<LiveLedgerHeadResult>;

export interface LedgerReceipt {
  environment: "development" | "local" | "production";
  idempotencyHash: string;
  keyVersion: number;
  recordHash: string;
  sequence: number;
  signature: string;
  stream: "admin-audit" | "deletions";
  timestamp: string;
}

export interface SignedLedgerHead extends LedgerPrefix {
  receipt: LedgerReceipt;
}

export interface VerifiedRecoverySet {
  decryptedObjects: Array<ManifestObject & { bytes: Uint8Array }>;
  envelope: RecoveryEnvelope;
  ledgerHeads: Record<"admin-audit" | "deletions", LiveLedgerHeadResult>;
  manifest: RecoveryManifest;
}

export interface RotationRecord {
  backupId: string;
  createdAt: string;
  status: "ready" | "failed" | "verifying";
}

export function canonicalJson(value: unknown): string;
export function assertSafeLogicalPath(value: string): string;
export function assertContainedPath(root: string, candidate: string): void;
export function createFixtureKeyring(options?: {
  keyVersion?: number;
}): Promise<OperatorKeyring>;
export function createFixtureLedgerHead(input: {
  environment: "development" | "local" | "production";
  hash: string;
  keyVersion?: number;
  keyring: OperatorKeyring;
  sequence: number;
  stream: "admin-audit" | "deletions";
}): Promise<SignedLedgerHead>;
export function createFixtureLedgerHeadProvider(
  heads: RemoteLedgerHeads,
  currentHeads?: RemoteLedgerHeads,
): LedgerHeadProvider;
export function importOperatorKeyring(
  bundle: unknown,
  options?: { requirePrivate?: boolean },
): Promise<OperatorKeyring>;
export function signOperatorAttestation(
  keyring: OperatorKeyring,
  value: unknown,
): Promise<{ keyVersion: number; signature: string }>;
export function verifyOperatorAttestation(
  keyring: OperatorKeyring,
  value: unknown,
  attestation: { keyVersion: number; signature: string },
): Promise<boolean>;
export function createRecoverySet(input: CreateRecoverySetInput): Promise<{
  envelope: RecoveryEnvelope;
  manifest: RecoveryManifest;
}>;
export function verifyRecoverySet(input: {
  directory: string;
  keyring: OperatorKeyring;
  ledgerHeadProvider: LedgerHeadProvider;
}): Promise<VerifiedRecoverySet>;
export function planRotation(
  existing: RotationRecord[],
  candidate: RotationRecord,
): {
  activeReadyIds: string[];
  pruneCandidateId: string | null;
};
export function removeDirectoryFinally<T>(
  path: string,
  operation: (path: string) => Promise<T>,
): Promise<T>;
