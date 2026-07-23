import { readFile } from "node:fs/promises";

import { importOperatorKeyring } from "./recovery-set.mjs";

export function parseArguments(arguments_) {
  const flags = new Set();
  const values = new Map();
  for (let index = 0; index < arguments_.length; index += 1) {
    const argument = arguments_[index];
    if (!argument.startsWith("--")) throw new Error("invalid_argument");
    const next = arguments_[index + 1];
    if (next === undefined || next.startsWith("--")) {
      flags.add(argument);
      continue;
    }
    values.set(argument, next);
    index += 1;
  }
  return { flags, values };
}

export function requiredValue(parsed, name) {
  const value = parsed.values.get(name);
  if (!value) throw new Error(`missing_${name.slice(2).replaceAll("-", "_")}`);
  return value;
}

export async function readJson(path, code) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    throw new Error(code);
  }
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  if (chunks.length === 0) throw new Error("operator_secrets_stdin_required");
  return Buffer.concat(chunks).toString("utf8");
}

export async function readOperatorKeyring({ requirePrivate = false } = {}) {
  let bundle;
  try {
    bundle = JSON.parse(await readStdin());
  } catch {
    throw new Error("invalid_operator_secrets");
  }
  return importOperatorKeyring(bundle, { requirePrivate });
}

export function printResult(value) {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}
