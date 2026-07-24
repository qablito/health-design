import { lstat, readFile, readdir, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const ACTIVE_STATUSES = new Set(["verifying", "restoring", "validating"]);

function quarantineMarker(restoreId) {
  return `${JSON.stringify({
    restoreId,
    status: "quarantined",
    trafficEnabled: false,
  })}\n`;
}

async function validateQuarantine({ restoreId, targetDirectory }) {
  const markerPath = join(targetDirectory, "restore-quarantine.json");
  const entries = await readdir(targetDirectory);
  if (entries.length !== 1 || entries[0] !== "restore-quarantine.json") {
    throw new Error("restore_target_reset_required");
  }
  const metadata = await lstat(markerPath);
  if (
    !metadata.isFile() ||
    metadata.isSymbolicLink() ||
    (await readFile(markerPath, "utf8")) !== quarantineMarker(restoreId)
  ) {
    throw new Error("restore_quarantine_invalid");
  }
  return markerPath;
}

export async function prepareQuarantinedRetry(input) {
  await validateQuarantine(input);
  return true;
}

export async function clearQuarantinedRetry(input) {
  const markerPath = await validateQuarantine(input);
  await unlink(markerPath);
  return true;
}

export async function quarantineFailedRestore({
  dependencies,
  job,
  jobs,
  restoreId,
  targetDirectory,
}) {
  const targetMayBePartial = Boolean(job && ACTIVE_STATUSES.has(job.status));
  let jobBlocked = false;
  if (targetMayBePartial) {
    try {
      await jobs.transitionRestore(restoreId, job.version, "blocked", {
        p_error_code: "restore_verification_failed",
      });
      jobBlocked = true;
    } catch {
      // El estado persistido conserva el último checkpoint confirmado.
    }
  }

  let sessionsRevoked = false;
  if (targetMayBePartial && dependencies?.revokeSessions) {
    try {
      await dependencies.revokeSessions();
      sessionsRevoked = true;
    } catch {
      // El destino sigue aislado y el job queda bloqueado para intervención.
    }
  }

  const marker = quarantineMarker(restoreId);
  const markerPath = join(targetDirectory, "restore-quarantine.json");
  let targetQuarantined = false;
  if (targetMayBePartial) {
    try {
      await writeFile(markerPath, marker, { flag: "wx", mode: 0o600 });
      targetQuarantined = true;
    } catch (error) {
      if (error?.code === "EEXIST") {
        const metadata = await lstat(markerPath);
        targetQuarantined =
          metadata.isFile() &&
          !metadata.isSymbolicLink() &&
          (await readFile(markerPath, "utf8")) === marker;
      }
    }
  }
  return { jobBlocked, sessionsRevoked, targetQuarantined };
}
