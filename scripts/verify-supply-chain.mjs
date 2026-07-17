import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const forbiddenDirectoryNames = new Set([
  "backups",
  "copies",
  "copias",
  "dumps",
  "private-evidence",
  "restore-artifacts",
  "restores",
]);

const skippedDirectoryNames = new Set([
  ".git",
  ".pnpm-store",
  ".turbo",
  ".vite",
  ".worktrees",
  "artifacts",
  "coverage",
  "node_modules",
  "playwright-report",
  "test-results",
]);

const forbiddenFileSuffixes = [
  ".age",
  ".backup",
  ".cer",
  ".crt",
  ".der",
  ".dump",
  ".jks",
  ".key",
  ".keystore",
  ".p12",
  ".pem",
  ".pfx",
  ".sql.gz",
];

const duplicateLockfileNames = new Set([
  "bun.lock",
  "bun.lockb",
  "npm-shrinkwrap.json",
  "package-lock.json",
  "yarn.lock",
]);

const maximumTextFileBytes = 16 * 1024 * 1024;

function toPosixPath(path) {
  return path.split(sep).join("/");
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function isForbiddenEnvironmentFile(name) {
  return name === ".env" || (name.startsWith(".env.") && name !== ".env.example");
}

function forbiddenPathReasons(path, type) {
  const parts = path.split("/");
  const name = parts.at(-1)?.toLowerCase() ?? "";
  const reasons = [];

  if (type === "symlink") {
    reasons.push("enlace simbólico no permitido en el artefacto verificable");
  }
  if (parts.some((part) => forbiddenDirectoryNames.has(part.toLowerCase()))) {
    reasons.push("directorio de evidencia, restore o backup privado");
  }
  if (type === "file" && isForbiddenEnvironmentFile(name)) {
    reasons.push("archivo de entorno no permitido");
  }
  if (
    type === "file" &&
    forbiddenFileSuffixes.some((suffix) => name.endsWith(suffix))
  ) {
    reasons.push("clave, certificado, dump o backup no permitido");
  }
  if (type === "file" && duplicateLockfileNames.has(name)) {
    reasons.push("lockfile de un gestor distinto a pnpm");
  }
  if (type === "file" && name === "pnpm-lock.yaml" && path !== "pnpm-lock.yaml") {
    reasons.push("lockfile pnpm duplicado fuera de la raíz");
  }

  return reasons;
}

function secretContentReasons(content) {
  const privateKeyPattern = new RegExp(
    ["-----BEGIN", " (?:RSA |EC |OPENSSH |DSA )?", "PRIVATE KEY-----"].join(""),
  );
  const credentialNames = [
    "CLOUDFLARE_API_TOKEN",
    "LUNA_API_KEY",
    "OPENAI_API_KEY",
    "SERVICE_ROLE_KEY",
    "SUPABASE_SERVICE_ROLE_KEY",
  ].join("|");
  const assignedCredentialPattern = new RegExp(
    `(?:${credentialNames})\\s*[:=]\\s*["']?(?!example|placeholder|test|changeme|\\$\\{)[A-Za-z0-9_./+=-]{16,}`,
    "i",
  );
  const githubTokenPattern = new RegExp(["gh", "[pousr]_[A-Za-z0-9]{30,}"].join(""));
  const awsAccessKeyPattern = new RegExp(["AK", "IA[0-9A-Z]{16}"].join(""));
  const jwtPattern = new RegExp(
    ["ey", "J[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}\\.[A-Za-z0-9_-]{20,}"].join(""),
  );
  const reasons = [];

  if (privateKeyPattern.test(content)) reasons.push("material de clave privada");
  if (assignedCredentialPattern.test(content))
    reasons.push("credencial asignada en texto plano");
  if (githubTokenPattern.test(content)) reasons.push("token de GitHub");
  if (awsAccessKeyPattern.test(content)) reasons.push("identificador de acceso AWS");
  if (jwtPattern.test(content)) reasons.push("JWT incrustado");

  return reasons;
}

async function walkRepository(root) {
  const files = [];
  const paths = [];

  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(directory, entry.name);
      const path = toPosixPath(relative(root, absolutePath));

      if (entry.isSymbolicLink()) {
        paths.push({ path, type: "symlink" });
        continue;
      }

      if (entry.isDirectory()) {
        paths.push({ path, type: "directory" });
        if (skippedDirectoryNames.has(entry.name)) continue;
        if (path === "supabase/.temp" || path.startsWith("supabase/.temp/")) continue;
        await visit(absolutePath);
        continue;
      }

      if (entry.isFile()) {
        paths.push({ path, type: "file" });
        files.push({ absolutePath, path });
      }
    }
  }

  await visit(root);
  return { files, paths };
}

async function inspectFileContent({ absolutePath, path }) {
  const fileStat = await stat(absolutePath);
  if (fileStat.size > maximumTextFileBytes) return [];

  const content = await readFile(absolutePath);
  if (content.includes(0)) return [];

  return secretContentReasons(content.toString("utf8")).map((reason) => ({
    path,
    reason,
    source: "worktree",
  }));
}

async function inspectGitHistory(root) {
  const fail = (status, reason) => ({
    findings: [
      {
        path: ".git",
        reason,
        source: "history",
      },
    ],
    status,
  });

  let inside;
  try {
    ({ stdout: inside } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--is-inside-work-tree"],
      { maxBuffer: 1024 * 1024 },
    ));
  } catch {
    return fail(
      "error:not-a-git-worktree",
      "no se pudo confirmar un repositorio Git para inspeccionar el historial",
    );
  }
  if (inside.trim() !== "true") {
    return fail(
      "error:not-a-git-worktree",
      "la ruta no pertenece a un worktree Git inspeccionable",
    );
  }

  try {
    await execFileAsync("git", ["-C", root, "rev-parse", "--verify", "HEAD"], {
      maxBuffer: 1024 * 1024,
    });
  } catch {
    let commitCount;
    try {
      ({ stdout: commitCount } = await execFileAsync(
        "git",
        ["-C", root, "rev-list", "--all", "--count"],
        { maxBuffer: 1024 * 1024 },
      ));
    } catch {
      return fail(
        "error:head-unavailable",
        "HEAD no existe y tampoco se pudo contar el historial Git",
      );
    }
    if (commitCount.trim() === "0") {
      return {
        findings: [],
        status: "not-applicable:repository-has-no-commits",
      };
    }
    return fail(
      "error:head-unavailable",
      "el repositorio contiene commits pero HEAD no se pudo verificar",
    );
  }

  try {
    const [{ stdout: names }, { stdout: patches }] = await Promise.all([
      execFileAsync(
        "git",
        ["-C", root, "log", "--all", "--pretty=format:", "--name-only"],
        { maxBuffer: 64 * 1024 * 1024 },
      ),
      execFileAsync(
        "git",
        ["-C", root, "log", "--all", "--no-ext-diff", "--format=", "-p"],
        { maxBuffer: 64 * 1024 * 1024 },
      ),
    ]);

    const findings = [];
    for (const path of new Set(
      names
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
    )) {
      for (const reason of forbiddenPathReasons(path, "file")) {
        findings.push({ path: `history:${path}`, reason, source: "history" });
      }
    }
    for (const reason of secretContentReasons(patches)) {
      findings.push({ path: "git-history", reason, source: "history" });
    }

    return { findings, status: "checked" };
  } catch {
    return fail(
      "error:history-scan-failed",
      "Git existe, pero el escaneo completo de nombres y parches falló",
    );
  }
}

async function inspectLockfile(root) {
  const lockfilePath = resolve(root, "pnpm-lock.yaml");
  try {
    const content = await readFile(lockfilePath, "utf8");
    if (!/^lockfileVersion:\s*['"]?[0-9.]+['"]?\s*$/m.test(content)) {
      return [
        {
          path: "pnpm-lock.yaml",
          reason: "lockfile ausente de una versión parseable",
          source: "lockfile",
        },
      ];
    }
    return [];
  } catch {
    return [
      {
        path: "pnpm-lock.yaml",
        reason: "lockfile obligatorio ausente",
        source: "lockfile",
      },
    ];
  }
}

export async function inspectSupplyChainWorkflow(root) {
  const supplyPath = ".github/workflows/supply-chain.yml";
  const verifyPath = ".github/workflows/verify.yml";
  const findings = [];
  const readWorkflow = async (path, missingReason) => {
    try {
      return await readFile(resolve(root, path), "utf8");
    } catch {
      findings.push({ path, reason: missingReason, source: "policy" });
      return "";
    }
  };
  const [workflow, verifyWorkflow] = await Promise.all([
    readWorkflow(supplyPath, "workflow de cadena de suministro ausente"),
    readWorkflow(verifyPath, "workflow de verificación ausente"),
  ]);

  const workflowDirectory = resolve(root, ".github/workflows");
  try {
    const workflowFiles = (await readdir(workflowDirectory))
      .filter((name) => /\.ya?ml$/i.test(name))
      .sort();
    const unexpectedWorkflows = workflowFiles.filter(
      (name) => name !== "supply-chain.yml" && name !== "verify.yml",
    );
    findings.push(
      ...unexpectedWorkflows.map((name) => ({
        path: `.github/workflows/${name}`,
        reason: "workflow activo fuera del conjunto canónico auditado",
        source: "policy",
      })),
    );
  } catch {
    findings.push({
      path: ".github/workflows",
      reason: "directorio de workflows ausente o no inspeccionable",
      source: "policy",
    });
  }

  const requirements = [
    [/node-version:\s*24\.18\.0/, "runtime Node 24.18.0 no fijado"],
    [/id-token:\s*write/, "permiso OIDC para procedencia ausente"],
    [/attestations:\s*write/, "permiso de attestations ausente"],
    [/actions\/attest@[0-9a-f]{40}/, "acción de firma/procedencia no fijada por SHA"],
    [/sbom-path:/, "attestation no enlaza el SBOM"],
    [/subject-path:/, "attestation no enlaza el artefacto"],
    [/pnpm audit --audit-level high/, "SCA bloqueante para severidad alta ausente"],
    [/pnpm install --frozen-lockfile/, "instalación reproducible ausente"],
    [/pnpm verify/, "verificación completa ausente de la puerta de release"],
    [/node scripts\/edge-smoke\.mjs/, "smoke HTTP de Edge ausente"],
    [/EDGE_SMOKE_USE_LOCAL_ANON=true/, "smoke Edge autenticado ausente"],
    [/--signer-workflow/, "identidad del workflow firmante no restringida"],
    [/--signer-digest/, "commit del workflow firmante no restringido"],
    [/gh attestation verify/, "verificación criptográfica posterior ausente"],
    [/--verify-release/, "verificación local de hashes de release ausente"],
  ];
  findings.push(
    ...requirements
      .filter(([pattern]) => !pattern.test(workflow))
      .map(([, reason]) => ({ path: supplyPath, reason, source: "policy" })),
  );

  const attestationCount = (
    workflow.match(/uses:\s*actions\/attest@[0-9a-f]{40}/g) ?? []
  ).length;
  if (attestationCount < 2) {
    findings.push({
      path: supplyPath,
      reason: "se requieren attestations separadas para procedencia y SBOM",
      source: "policy",
    });
  }

  const buildIndex = workflow.lastIndexOf("run: pnpm build");
  const postBuildScanIndex = workflow.indexOf(
    "run: pnpm test:supply-chain",
    Math.max(0, buildIndex),
  );
  const attestationIndex = workflow.indexOf("uses: actions/attest@", buildIndex);
  if (
    buildIndex < 0 ||
    postBuildScanIndex < buildIndex ||
    attestationIndex < postBuildScanIndex
  ) {
    findings.push({
      path: supplyPath,
      reason: "el bundle debe escanearse después del build y antes de firmarse",
      source: "policy",
    });
  }

  const verifyRequirements = [
    [/node-version:\s*24\.18\.0/, "runtime Node 24.18.0 no fijado"],
    [/pnpm install --frozen-lockfile/, "instalación reproducible ausente"],
    [/playwright install --with-deps chromium/, "Chromium de CI ausente"],
    [/pnpm verify/, "verificación del workspace ausente"],
    [/node scripts\/edge-smoke\.mjs/, "smoke HTTP de Edge ausente"],
    [/EDGE_SMOKE_USE_LOCAL_ANON=true/, "smoke Edge autenticado ausente"],
    [/kill -0/, "CI no comprueba que functions serve siga activo"],
  ];
  findings.push(
    ...verifyRequirements
      .filter(([pattern]) => !pattern.test(verifyWorkflow))
      .map(([, reason]) => ({ path: verifyPath, reason, source: "policy" })),
  );

  for (const [path, content] of [
    [supplyPath, workflow],
    [verifyPath, verifyWorkflow],
  ]) {
    if (/--no-verify-jwt\b/.test(content)) {
      findings.push({
        path,
        reason: "CI desactiva la verificación JWT del runtime",
        source: "policy",
      });
    }
  }

  for (const [path, content] of [
    [supplyPath, workflow],
    [verifyPath, verifyWorkflow],
  ]) {
    const lines = content.split("\n");
    for (let index = 0; index < lines.length; index += 1) {
      const uses = lines[index].match(/\buses:\s*([^\s#]+)/)?.[1];
      if (uses && !uses.startsWith("./") && !/@[0-9a-f]{40}$/.test(uses)) {
        findings.push({
          path,
          reason: `acción de CI sin SHA inmutable: ${uses}`,
          source: "policy",
        });
      }
      if (uses?.startsWith("actions/checkout@")) {
        const checkoutBlock = lines.slice(index, index + 8).join("\n");
        if (!/persist-credentials:\s*false/.test(checkoutBlock)) {
          findings.push({
            path,
            reason: "checkout conserva credenciales de escritura",
            source: "policy",
          });
        }
      }
    }
  }

  return findings;
}

export async function auditRepository(
  root,
  { inspectHistory = true, requirePolicy = false } = {},
) {
  const resolvedRoot = resolve(root);
  const { files, paths } = await walkRepository(resolvedRoot);
  const findings = [];

  for (const entry of paths) {
    for (const reason of forbiddenPathReasons(entry.path, entry.type)) {
      findings.push({ path: entry.path, reason, source: "worktree" });
    }
  }

  const contentFindings = await Promise.all(files.map(inspectFileContent));
  findings.push(...contentFindings.flat());
  findings.push(...(await inspectLockfile(resolvedRoot)));

  const history = inspectHistory
    ? await inspectGitHistory(resolvedRoot)
    : { findings: [], status: "skipped" };
  findings.push(...history.findings);

  if (requirePolicy) {
    findings.push(...(await inspectSupplyChainWorkflow(resolvedRoot)));
  }

  const uniqueFindings = [
    ...new Map(
      findings.map((finding) => [
        `${finding.source}:${finding.path}:${finding.reason}`,
        finding,
      ]),
    ).values(),
  ].sort((left, right) =>
    `${left.path}:${left.reason}`.localeCompare(`${right.path}:${right.reason}`),
  );

  return {
    findings: uniqueFindings,
    historyStatus: history.status,
    valid: uniqueFindings.length === 0,
  };
}

function parseLockfileComponents(lockfile) {
  const lines = lockfile.split("\n");
  const components = new Map();
  let inPackages = false;

  for (const line of lines) {
    if (line === "packages:") {
      inPackages = true;
      continue;
    }
    if (inPackages && line === "snapshots:") break;
    if (!inPackages || !/^ {2}\S/.test(line) || !line.endsWith(":")) continue;

    let key = line.slice(2, -1).trim();
    if (
      (key.startsWith("'") && key.endsWith("'")) ||
      (key.startsWith('"') && key.endsWith('"'))
    ) {
      key = key.slice(1, -1);
    }

    const lastAt = key.lastIndexOf("@");
    if (lastAt <= 0) continue;
    const name = key.slice(0, lastAt);
    const version = key.slice(lastAt + 1).split("(")[0];
    if (!name || !version) continue;

    const encodedName = name.startsWith("@")
      ? `%40${name.slice(1).split("/").map(encodeURIComponent).join("/")}`
      : encodeURIComponent(name);
    const purl = `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
    components.set(`${name}@${version}`, {
      "bom-ref": purl,
      name,
      purl,
      type: "library",
      version,
    });
  }

  return [...components.values()].sort((left, right) =>
    left["bom-ref"].localeCompare(right["bom-ref"]),
  );
}

function uuidFromHash(hash) {
  const characters = hash.slice(0, 32).split("");
  characters[12] = "5";
  characters[16] = ["8", "9", "a", "b"][Number.parseInt(characters[16], 16) % 4];
  const value = characters.join("");
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

async function currentGitCommit(root) {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["-C", root, "rev-parse", "--verify", "HEAD"],
      { maxBuffer: 1024 * 1024 },
    );
    return stdout.trim();
  } catch {
    try {
      const [{ stdout: inside }, { stdout: commitCount }] = await Promise.all([
        execFileAsync("git", ["-C", root, "rev-parse", "--is-inside-work-tree"], {
          maxBuffer: 1024 * 1024,
        }),
        execFileAsync("git", ["-C", root, "rev-list", "--all", "--count"], {
          maxBuffer: 1024 * 1024,
        }),
      ]);
      if (inside.trim() === "true" && commitCount.trim() === "0") return "unborn";
    } catch {
      // La generación de un release debe fallar cerrada si Git no es demostrable.
    }
    throw new Error("No se pudo determinar de forma segura el commit Git del release");
  }
}

async function listArtifactFiles(root, directory) {
  const result = [];

  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = resolve(current, entry.name);
      if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        const content = await readFile(absolutePath);
        result.push({
          bytes: content.byteLength,
          path: toPosixPath(relative(root, absolutePath)),
          sha256: sha256(content),
        });
      }
    }
  }

  await visit(directory);
  return result.sort((left, right) => left.path.localeCompare(right.path));
}

export async function createReleaseArtifacts(root) {
  const resolvedRoot = resolve(root);
  const lockfilePath = resolve(resolvedRoot, "pnpm-lock.yaml");
  const distPath = resolve(resolvedRoot, "apps/web/dist");
  const outputPath = resolve(resolvedRoot, "artifacts");
  const lockfile = await readFile(lockfilePath, "utf8");
  const lockfileHash = sha256(lockfile);
  const components = parseLockfileComponents(lockfile);
  if (components.length === 0)
    throw new Error("El lockfile no contiene componentes para el SBOM");

  const artifactFiles = await listArtifactFiles(resolvedRoot, distPath);
  if (artifactFiles.length === 0)
    throw new Error("El build no contiene artefactos verificables");

  const gitCommit = await currentGitCommit(resolvedRoot);
  const sbom = {
    bomFormat: "CycloneDX",
    components,
    metadata: {
      component: {
        name: "health-design-web",
        type: "application",
        version: "0.0.0",
      },
      properties: [
        { name: "health-design:git-commit", value: gitCommit },
        { name: "health-design:lockfile-sha256", value: lockfileHash },
      ],
    },
    serialNumber: `urn:uuid:${uuidFromHash(lockfileHash)}`,
    specVersion: "1.6",
    version: 1,
  };

  await mkdir(outputPath, { recursive: true });
  const sbomPath = resolve(outputPath, "sbom.cdx.json");
  const sbomContent = `${JSON.stringify(sbom, null, 2)}\n`;
  await writeFile(sbomPath, sbomContent);

  const manifest = {
    artifacts: artifactFiles,
    gitCommit,
    lockfile: { path: "pnpm-lock.yaml", sha256: lockfileHash },
    provenance: {
      issuer: "https://token.actions.githubusercontent.com",
      required: true,
      workflow: ".github/workflows/supply-chain.yml",
    },
    sbom: { path: "artifacts/sbom.cdx.json", sha256: sha256(sbomContent) },
    schemaVersion: 1,
  };
  await writeFile(
    resolve(outputPath, "release-manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  return { artifactCount: artifactFiles.length, componentCount: components.length };
}

export async function verifyReleaseArtifacts(root) {
  const resolvedRoot = resolve(root);
  const manifestPath = resolve(resolvedRoot, "artifacts/release-manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const currentCommit = await currentGitCommit(resolvedRoot);

  if (manifest.schemaVersion !== 1) throw new Error("Versión de manifest no admitida");
  if (manifest.gitCommit !== currentCommit)
    throw new Error("El commit del manifest no coincide");

  const lockfileContent = await readFile(resolve(resolvedRoot, manifest.lockfile.path));
  if (sha256(lockfileContent) !== manifest.lockfile.sha256) {
    throw new Error("El hash del lockfile no coincide");
  }

  const sbomContent = await readFile(resolve(resolvedRoot, manifest.sbom.path));
  if (sha256(sbomContent) !== manifest.sbom.sha256) {
    throw new Error("El hash del SBOM no coincide");
  }
  const sbom = JSON.parse(sbomContent.toString("utf8"));
  if (sbom.bomFormat !== "CycloneDX" || sbom.specVersion !== "1.6") {
    throw new Error("El SBOM no es CycloneDX 1.6");
  }
  if (!Array.isArray(sbom.components) || sbom.components.length === 0) {
    throw new Error("El SBOM no contiene componentes");
  }
  const lockProperty = sbom.metadata?.properties?.find(
    ({ name }) => name === "health-design:lockfile-sha256",
  );
  if (lockProperty?.value !== manifest.lockfile.sha256) {
    throw new Error("El SBOM no está ligado al hash del lockfile");
  }

  for (const artifact of manifest.artifacts) {
    const content = await readFile(resolve(resolvedRoot, artifact.path));
    if (sha256(content) !== artifact.sha256) {
      throw new Error(`El hash del artefacto no coincide: ${artifact.path}`);
    }
    const fileStat = await lstat(resolve(resolvedRoot, artifact.path));
    if (fileStat.size !== artifact.bytes) {
      throw new Error(`El tamaño del artefacto no coincide: ${artifact.path}`);
    }
  }

  if (manifest.provenance?.required !== true) {
    throw new Error("El manifest no exige procedencia firmada");
  }

  return {
    artifactCount: manifest.artifacts.length,
    componentCount: sbom.components.length,
    valid: true,
  };
}

async function runCli() {
  const argumentsList = process.argv.slice(2);
  const rootIndex = argumentsList.indexOf("--root");
  const root = rootIndex >= 0 ? argumentsList[rootIndex + 1] : process.cwd();
  if (!root) throw new Error("--root requiere una ruta");

  if (argumentsList.includes("--generate-release")) {
    const result = await createReleaseArtifacts(root);
    console.log(
      `SBOM y manifest generados: ${result.componentCount} componentes, ${result.artifactCount} artefactos`,
    );
    return;
  }

  if (argumentsList.includes("--verify-release")) {
    const result = await verifyReleaseArtifacts(root);
    console.log(
      `Release verificado: ${result.componentCount} componentes, ${result.artifactCount} artefactos`,
    );
    return;
  }

  const report = await auditRepository(root, {
    inspectHistory: !argumentsList.includes("--skip-history"),
    requirePolicy: true,
  });
  console.log(`Historial: ${report.historyStatus}`);
  if (!report.valid) {
    for (const finding of report.findings) {
      console.error(`- [${finding.source}] ${finding.path}: ${finding.reason}`);
    }
    throw new Error(
      `Cadena de suministro no válida: ${report.findings.length} hallazgos`,
    );
  }
  console.log("Cadena de suministro válida");
}

const invokedPath = process.argv[1] ? pathToFileURL(resolve(process.argv[1])).href : "";
if (import.meta.url === invokedPath) {
  runCli().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
