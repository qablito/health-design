import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";
import { createHash, randomBytes, timingSafeEqual, webcrypto } from "node:crypto";

const subtle = webcrypto.subtle;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
const FORMAT_VERSION = 1;
const TYPE_ORDER = new Map([
  ["admin-audit-ledger", 0],
  ["database", 1],
  ["deletions-ledger", 2],
  ["storage", 3],
]);

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalize(value));
}

function sha256Bytes(value) {
  return createHash("sha256").update(value).digest();
}

function sha256Hex(value) {
  return sha256Bytes(value).toString("hex");
}

function base64(value) {
  return Buffer.from(value).toString("base64");
}

function fromBase64(value) {
  return Buffer.from(value, "base64");
}

function equalHex(left, right) {
  if (
    typeof left !== "string" ||
    typeof right !== "string" ||
    left.length !== right.length ||
    !/^[a-f0-9]+$/.test(left) ||
    !/^[a-f0-9]+$/.test(right)
  ) {
    return false;
  }
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

function assertClosedIdentifier(value, name) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(value)) {
    throw new Error(`invalid_${name}`);
  }
}

export function assertSafeLogicalPath(value) {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 1024 ||
    value.includes("\\") ||
    value.startsWith("/") ||
    value.split("/").some((segment) => segment === "" || segment === "..")
  ) {
    throw new Error("unsafe_manifest_path");
  }
  return value;
}

function assertPlainObject(value, code) {
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    throw new Error(code);
  }
}

async function importKek(rawKey, usages) {
  if (!(rawKey instanceof Uint8Array) || rawKey.byteLength !== 32) {
    throw new Error("invalid_kek");
  }
  return subtle.importKey("raw", rawKey, "AES-KW", false, usages);
}

function objectAad(context) {
  return encoder.encode(
    canonicalJson({
      backupId: context.backupId,
      index: context.index,
      keyVersion: context.keyVersion,
      objectType: context.objectType,
      schemaVersion: context.schemaVersion,
      sourceEnvironment: context.sourceEnvironment,
    }),
  );
}

async function encryptObject(bytes, context, rawKek) {
  const dekKey = await subtle.generateKey({ length: 256, name: "AES-GCM" }, true, [
    "encrypt",
  ]);
  const kekKey = await importKek(rawKek, ["wrapKey"]);
  const wrappedDek = await subtle.wrapKey("raw", dekKey, kekKey, "AES-KW");
  const nonce = randomBytes(12);
  const ciphertext = new Uint8Array(
    await subtle.encrypt(
      {
        additionalData: objectAad(context),
        iv: nonce,
        name: "AES-GCM",
        tagLength: 128,
      },
      dekKey,
      bytes,
    ),
  );
  const payload = Buffer.concat([nonce, ciphertext]);
  return {
    ciphertextHash: sha256Hex(payload),
    payload,
    wrappedDek: base64(wrappedDek),
  };
}

async function decryptObject(payload, metadata, context, rawKek) {
  if (!equalHex(sha256Hex(payload), metadata.ciphertextHash)) {
    throw new Error("ciphertext_hash_mismatch");
  }
  if (payload.byteLength < 29) throw new Error("aead_verification_failed");
  try {
    const kekKey = await importKek(rawKek, ["unwrapKey"]);
    const dekKey = await subtle.unwrapKey(
      "raw",
      fromBase64(metadata.wrappedDek),
      kekKey,
      "AES-KW",
      { length: 256, name: "AES-GCM" },
      false,
      ["decrypt"],
    );
    const nonce = payload.subarray(0, 12);
    const ciphertext = payload.subarray(12);
    return new Uint8Array(
      await subtle.decrypt(
        {
          additionalData: objectAad(context),
          iv: nonce,
          name: "AES-GCM",
          tagLength: 128,
        },
        dekKey,
        ciphertext,
      ),
    );
  } catch {
    throw new Error("aead_verification_failed");
  }
}

async function sign(privateKey, value) {
  return base64(
    await subtle.sign("Ed25519", privateKey, encoder.encode(canonicalJson(value))),
  );
}

async function verifySignature(publicKey, value, signature) {
  try {
    return await subtle.verify(
      "Ed25519",
      publicKey,
      fromBase64(signature),
      encoder.encode(canonicalJson(value)),
    );
  } catch {
    return false;
  }
}

function keyForVersion(keyring, version) {
  const key = keyring?.keks?.get(version);
  if (!(key instanceof Uint8Array)) throw new Error("unknown_key_version");
  return key;
}

function signingPublicKeyForVersion(keyring, version) {
  const key = keyring?.signingPublicKeys?.get(version);
  if (!key) throw new Error("unknown_signing_key_version");
  return key;
}

export async function createFixtureKeyring({ keyVersion = 1 } = {}) {
  const signingKeys = await subtle.generateKey("Ed25519", true, ["sign", "verify"]);
  return {
    keks: new Map([[keyVersion, randomBytes(32)]]),
    signingKeyVersion: keyVersion,
    signingPrivateKey: signingKeys.privateKey,
    signingPublicKeys: new Map([[keyVersion, signingKeys.publicKey]]),
  };
}

export async function importOperatorKeyring(bundle, { requirePrivate = false } = {}) {
  assertPlainObject(bundle, "invalid_keyring");
  assertPlainObject(bundle.keks, "invalid_keyring");
  assertPlainObject(bundle.signingPublicKeys, "invalid_keyring");
  const keks = new Map();
  for (const [rawVersion, encoded] of Object.entries(bundle.keks)) {
    const version = Number(rawVersion);
    const bytes = fromBase64(encoded);
    if (!Number.isInteger(version) || version < 1 || bytes.byteLength !== 32) {
      throw new Error("invalid_kek");
    }
    keks.set(version, new Uint8Array(bytes));
  }
  const signingPublicKeys = new Map();
  for (const [rawVersion, encoded] of Object.entries(bundle.signingPublicKeys)) {
    const version = Number(rawVersion);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error("invalid_signing_key_version");
    }
    signingPublicKeys.set(
      version,
      await subtle.importKey("spki", fromBase64(encoded), "Ed25519", false, ["verify"]),
    );
  }
  let signingPrivateKey;
  if (bundle.signingPrivateKeyPkcs8 !== undefined) {
    signingPrivateKey = await subtle.importKey(
      "pkcs8",
      fromBase64(bundle.signingPrivateKeyPkcs8),
      "Ed25519",
      false,
      ["sign"],
    );
  }
  if (requirePrivate && !signingPrivateKey) {
    throw new Error("signing_private_key_required");
  }
  if (
    !Number.isInteger(bundle.signingKeyVersion) ||
    bundle.signingKeyVersion < 1 ||
    !signingPublicKeys.has(bundle.signingKeyVersion)
  ) {
    throw new Error("invalid_signing_key_version");
  }
  return {
    keks,
    signingKeyVersion: bundle.signingKeyVersion,
    signingPrivateKey,
    signingPublicKeys,
  };
}

function validateCreateInput(input) {
  assertClosedIdentifier(input.backupId, "backup_id");
  assertClosedIdentifier(input.toolVersion, "tool_version");
  if (!["weekly", "precritical"].includes(input.kind)) {
    throw new Error("invalid_backup_kind");
  }
  if (!["local", "development", "production"].includes(input.sourceEnvironment)) {
    throw new Error("invalid_source_environment");
  }
  if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1) {
    throw new Error("invalid_schema_version");
  }
  if (!Number.isInteger(input.keyVersion) || input.keyVersion < 1) {
    throw new Error("invalid_key_version");
  }
  if (!Number.isFinite(Date.parse(input.createdAt))) {
    throw new Error("invalid_created_at");
  }
  if (!Array.isArray(input.objects) || input.objects.length === 0) {
    throw new Error("backup_objects_required");
  }
  if (!input.keyring?.signingPrivateKey) {
    throw new Error("signing_key_required");
  }
}

export async function createRecoverySet(input) {
  validateCreateInput(input);
  const rawKek = keyForVersion(input.keyring, input.keyVersion);
  const signingKeyVersion = input.keyring.signingKeyVersion;
  if (!Number.isInteger(signingKeyVersion) || signingKeyVersion < 1) {
    throw new Error("invalid_signing_key_version");
  }

  await mkdir(input.destinationDirectory, { mode: 0o700, recursive: true });
  await chmod(input.destinationDirectory, 0o700);
  const existing = await readdir(input.destinationDirectory);
  if (existing.length > 0) throw new Error("backup_destination_not_empty");

  const sortedObjects = [...input.objects].sort((left, right) => {
    const typeDelta =
      (TYPE_ORDER.get(left.type) ?? 99) - (TYPE_ORDER.get(right.type) ?? 99);
    return typeDelta || left.logicalPath.localeCompare(right.logicalPath, "en");
  });
  const manifestObjects = [];
  const envelopeObjects = [];

  for (const [index, object] of sortedObjects.entries()) {
    if (!TYPE_ORDER.has(object.type)) throw new Error("invalid_object_type");
    assertSafeLogicalPath(object.logicalPath);
    if (!(object.bytes instanceof Uint8Array)) {
      throw new Error("invalid_object_bytes");
    }
    if (
      object.profileMarker !== undefined &&
      (typeof object.profileMarker !== "string" ||
        !/^[A-Za-z0-9._-]{1,128}$/.test(object.profileMarker))
    ) {
      throw new Error("invalid_profile_marker");
    }
    if (
      object.type.endsWith("-ledger") &&
      (!object.prefix ||
        !Number.isInteger(object.prefix.sequence) ||
        object.prefix.sequence < 0 ||
        typeof object.prefix.hash !== "string" ||
        object.prefix.hash.length === 0)
    ) {
      throw new Error("ledger_prefix_required");
    }
    const context = {
      backupId: input.backupId,
      index,
      keyVersion: input.keyVersion,
      objectType: object.type,
      schemaVersion: input.schemaVersion,
      sourceEnvironment: input.sourceEnvironment,
    };
    const encrypted = await encryptObject(object.bytes, context, rawKek);
    const file = `${encrypted.ciphertextHash}.bin`;
    await writeFile(join(input.destinationDirectory, file), encrypted.payload, {
      flag: "wx",
      mode: 0o600,
    });
    manifestObjects.push({
      index,
      logicalPath: object.logicalPath,
      plaintextHash: sha256Hex(object.bytes),
      ...(object.prefix ? { prefix: object.prefix } : {}),
      ...(object.profileMarker ? { profileMarker: object.profileMarker } : {}),
      size: object.bytes.byteLength,
      type: object.type,
    });
    envelopeObjects.push({
      ciphertextHash: encrypted.ciphertextHash,
      file,
      index,
      type: object.type,
      wrappedDek: encrypted.wrappedDek,
    });
  }

  const manifest = {
    backupId: input.backupId,
    createdAt: input.createdAt,
    formatVersion: FORMAT_VERSION,
    keyVersion: input.keyVersion,
    kind: input.kind,
    objects: manifestObjects,
    schemaVersion: input.schemaVersion,
    sourceEnvironment: input.sourceEnvironment,
    toolVersion: input.toolVersion,
  };
  const manifestPlaintext = encoder.encode(canonicalJson(manifest));
  const manifestHash = sha256Hex(manifestPlaintext);
  const manifestContext = {
    backupId: input.backupId,
    index: "manifest",
    keyVersion: input.keyVersion,
    objectType: "manifest",
    schemaVersion: input.schemaVersion,
    sourceEnvironment: input.sourceEnvironment,
  };
  const encryptedManifest = await encryptObject(
    manifestPlaintext,
    manifestContext,
    rawKek,
  );
  await writeFile(
    join(input.destinationDirectory, "manifest.enc"),
    encryptedManifest.payload,
    { flag: "wx", mode: 0o600 },
  );

  const unsignedEnvelope = {
    backupId: input.backupId,
    createdAt: input.createdAt,
    formatVersion: FORMAT_VERSION,
    keyVersion: input.keyVersion,
    kind: input.kind,
    manifest: {
      ciphertextHash: encryptedManifest.ciphertextHash,
      file: "manifest.enc",
      plaintextHash: manifestHash,
      wrappedDek: encryptedManifest.wrappedDek,
    },
    manifestSignature: await sign(input.keyring.signingPrivateKey, {
      backupId: input.backupId,
      manifestHash,
    }),
    objects: envelopeObjects,
    schemaVersion: input.schemaVersion,
    signingKeyVersion,
    sourceEnvironment: input.sourceEnvironment,
    toolVersion: input.toolVersion,
  };
  const envelope = {
    ...unsignedEnvelope,
    signature: await sign(input.keyring.signingPrivateKey, unsignedEnvelope),
  };
  await writeFile(
    join(input.destinationDirectory, "envelope.json"),
    `${canonicalJson(envelope)}\n`,
    { flag: "wx", mode: 0o600 },
  );
  return { envelope, manifest };
}

async function readEncryptedFile(directory, metadata) {
  if (
    typeof metadata?.file !== "string" ||
    basename(metadata.file) !== metadata.file ||
    !/^(?:[a-f0-9]{64}\.bin|manifest\.enc)$/.test(metadata.file)
  ) {
    throw new Error("unsafe_encrypted_object_path");
  }
  const path = join(directory, metadata.file);
  let fileStat;
  try {
    fileStat = await lstat(path);
  } catch {
    throw new Error("encrypted_object_missing");
  }
  if (!fileStat.isFile() || fileStat.isSymbolicLink()) {
    throw new Error("encrypted_object_symlink");
  }
  return new Uint8Array(await readFile(path));
}

function validateEnvelope(envelope) {
  assertPlainObject(envelope, "invalid_envelope");
  assertClosedIdentifier(envelope.backupId, "backup_id");
  if (envelope.formatVersion !== FORMAT_VERSION) {
    throw new Error("unsupported_backup_format");
  }
  if (!Array.isArray(envelope.objects)) throw new Error("invalid_envelope");
  if (!Number.isInteger(envelope.keyVersion) || envelope.keyVersion < 1) {
    throw new Error("invalid_key_version");
  }
  if (!Number.isInteger(envelope.signingKeyVersion) || envelope.signingKeyVersion < 1) {
    throw new Error("invalid_signing_key_version");
  }
}

function validateLedgerPrefixes(manifest, remoteLedgerHeads = {}) {
  for (const object of manifest.objects) {
    if (!object.type.endsWith("-ledger")) continue;
    const stream = object.type === "deletions-ledger" ? "deletions" : "admin-audit";
    const remote = remoteLedgerHeads[stream];
    if (!remote) continue;
    if (
      object.prefix.sequence !== remote.sequence ||
      object.prefix.hash !== remote.hash
    ) {
      throw new Error("ledger_prefix_mismatch");
    }
  }
}

export async function verifyRecoverySet({
  directory,
  keyring,
  remoteLedgerHeads = {},
}) {
  const resolvedDirectory = resolve(directory);
  const directoryStat = await lstat(resolvedDirectory);
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) {
    throw new Error("backup_directory_invalid");
  }
  await realpath(resolvedDirectory);
  const envelope = JSON.parse(
    await readFile(join(resolvedDirectory, "envelope.json"), "utf8"),
  );
  validateEnvelope(envelope);
  const unsignedEnvelope = { ...envelope };
  delete unsignedEnvelope.signature;
  const publicKey = signingPublicKeyForVersion(keyring, envelope.signingKeyVersion);
  if (!(await verifySignature(publicKey, unsignedEnvelope, envelope.signature))) {
    throw new Error("envelope_signature_invalid");
  }
  const rawKek = keyForVersion(keyring, envelope.keyVersion);
  const manifestPayload = await readEncryptedFile(resolvedDirectory, envelope.manifest);
  const manifestBytes = await decryptObject(
    manifestPayload,
    envelope.manifest,
    {
      backupId: envelope.backupId,
      index: "manifest",
      keyVersion: envelope.keyVersion,
      objectType: "manifest",
      schemaVersion: envelope.schemaVersion,
      sourceEnvironment: envelope.sourceEnvironment,
    },
    rawKek,
  );
  const manifestHash = sha256Hex(manifestBytes);
  if (!equalHex(manifestHash, envelope.manifest.plaintextHash)) {
    throw new Error("manifest_hash_mismatch");
  }
  if (
    !(await verifySignature(
      publicKey,
      { backupId: envelope.backupId, manifestHash },
      envelope.manifestSignature,
    ))
  ) {
    throw new Error("manifest_signature_invalid");
  }
  const manifest = JSON.parse(decoder.decode(manifestBytes));
  assertPlainObject(manifest, "invalid_manifest");
  if (
    manifest.backupId !== envelope.backupId ||
    manifest.schemaVersion !== envelope.schemaVersion ||
    manifest.sourceEnvironment !== envelope.sourceEnvironment ||
    manifest.keyVersion !== envelope.keyVersion ||
    !Array.isArray(manifest.objects) ||
    manifest.objects.length !== envelope.objects.length
  ) {
    throw new Error("manifest_envelope_mismatch");
  }

  const decryptedObjects = [];
  for (const manifestObject of manifest.objects) {
    assertSafeLogicalPath(manifestObject.logicalPath);
    const envelopeObject = envelope.objects.find(
      (candidate) =>
        candidate.index === manifestObject.index &&
        candidate.type === manifestObject.type,
    );
    if (!envelopeObject) throw new Error("manifest_object_missing");
    const payload = await readEncryptedFile(resolvedDirectory, envelopeObject);
    const bytes = await decryptObject(
      payload,
      envelopeObject,
      {
        backupId: envelope.backupId,
        index: manifestObject.index,
        keyVersion: envelope.keyVersion,
        objectType: manifestObject.type,
        schemaVersion: envelope.schemaVersion,
        sourceEnvironment: envelope.sourceEnvironment,
      },
      rawKek,
    );
    if (
      bytes.byteLength !== manifestObject.size ||
      !equalHex(sha256Hex(bytes), manifestObject.plaintextHash)
    ) {
      throw new Error("plaintext_hash_mismatch");
    }
    decryptedObjects.push({ ...manifestObject, bytes });
  }
  validateLedgerPrefixes(manifest, remoteLedgerHeads);
  return { decryptedObjects, envelope, manifest };
}

export function planRotation(existing, candidate) {
  const ready = [...existing, candidate]
    .filter((backup) => backup.status === "ready")
    .sort(
      (left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt) ||
        left.backupId.localeCompare(right.backupId, "en"),
    );
  if (candidate.status !== "ready" || ready.length <= 4) {
    return {
      activeReadyIds: ready.slice(-4).map((backup) => backup.backupId),
      pruneCandidateId: null,
    };
  }
  return {
    activeReadyIds: ready.slice(-4).map((backup) => backup.backupId),
    pruneCandidateId: ready[0].backupId,
  };
}

export async function removeDirectoryFinally(path, operation) {
  await mkdir(path, { mode: 0o700, recursive: true });
  await chmod(path, 0o700);
  try {
    return await operation(path);
  } finally {
    await rm(path, { force: true, recursive: true });
  }
}

export function assertContainedPath(root, candidate) {
  const relativePath = relative(resolve(root), resolve(candidate));
  if (
    relativePath === ".." ||
    relativePath.startsWith(`..${sep}`) ||
    relativePath.startsWith(sep)
  ) {
    throw new Error("path_traversal");
  }
}
