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
  sourceEnvironment: "local" | "development" | "production";
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
  sourceEnvironment: "local" | "development" | "production";
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
  toolVersion: string;
}

export interface RemoteLedgerHeads {
  "admin-audit"?: LedgerPrefix;
  deletions?: LedgerPrefix;
}

export interface VerifiedRecoverySet {
  decryptedObjects: Array<ManifestObject & { bytes: Uint8Array }>;
  envelope: RecoveryEnvelope;
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
export function importOperatorKeyring(
  bundle: unknown,
  options?: { requirePrivate?: boolean },
): Promise<OperatorKeyring>;
export function createRecoverySet(input: CreateRecoverySetInput): Promise<{
  envelope: RecoveryEnvelope;
  manifest: RecoveryManifest;
}>;
export function verifyRecoverySet(input: {
  directory: string;
  keyring: OperatorKeyring;
  remoteLedgerHeads?: RemoteLedgerHeads;
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
