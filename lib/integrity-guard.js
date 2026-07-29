// lib/integrity-guard.js — SHA-256 hash protection for immutable files + validators
// Zero IA calls. Pure crypto.

import { createHash } from "crypto";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, basename } from "path";

const IMMUTABLE_FILES = [
  "system-rules.md",
  "tech-stack.json",
  "source-of-truth.json",
];

const VALIDATORS_DIR = "validators";
const LIB_DIR = "lib";

export function calculateIntegrity(zeroErrorDir) {
  const hashes = {};

  for (const file of IMMUTABLE_FILES) {
    const filePath = join(zeroErrorDir, file);
    const hash = hashFile(filePath);
    if (hash) {
      hashes[file] = hash;
    }
  }

  const validatorHashes = hashDirectory(join(zeroErrorDir, VALIDATORS_DIR));
  for (const [name, hash] of Object.entries(validatorHashes)) {
    hashes[`validators/${name}`] = hash;
  }

  const libHashes = hashDirectory(join(zeroErrorDir, LIB_DIR));
  for (const [name, hash] of Object.entries(libHashes)) {
    hashes[`lib/${name}`] = hash;
  }

  const initHash = hashFile(join(zeroErrorDir, "init.js"));
  if (initHash) {
    hashes["init.js"] = initHash;
  }

  return {
    version: "v2",
    timestamp: Date.now(),
    hashes: hashes,
  };
}

export function verifyIntegrity(zeroErrorDir) {
  const integrityPath = join(zeroErrorDir, ".integrity");

  if (!existsSync(integrityPath)) {
    return {
      valid: false,
      reason: "No .integrity file found. Run: node init.js --force",
      violations: [],
    };
  }

  let stored;
  try {
    stored = JSON.parse(readFileSync(integrityPath, "utf-8"));
  } catch {
    return {
      valid: false,
      reason: "Corrupted .integrity file",
      violations: [],
    };
  }

  const current = calculateIntegrity(zeroErrorDir);
  const violations = [];

  for (const [file, storedHash] of Object.entries(stored.hashes)) {
    const currentHash = current.hashes[file];
    if (!currentHash) {
      violations.push({
        file: file,
        reason: "File missing",
        severity: "error",
      });
    } else if (currentHash !== storedHash) {
      if (IMMUTABLE_FILES.includes(file)) {
        violations.push({
          file: file,
          reason: "Immutable file modified without --force",
          severity: "error",
        });
      } else {
        violations.push({
          file: file,
          reason: "Validator or lib module modified (re-run: node init.js --force)",
          severity: "warning",
        });
      }
    }
  }

  for (const file of Object.keys(current.hashes)) {
    if (!stored.hashes[file]) {
      violations.push({
        file: file,
        reason: "New file detected (not in integrity record)",
        severity: "info",
      });
    }
  }

  const hasErrors = violations.some(v => v.severity === "error");

  return {
    valid: !hasErrors,
    reason: hasErrors ? "Integrity violations detected" : "All files match",
    violations: violations,
  };
}

function hashFile(filePath) {
  if (!existsSync(filePath)) return null;
  try {
    const content = readFileSync(filePath);
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return null;
  }
}

function hashDirectory(dirPath) {
  const hashes = {};

  if (!existsSync(dirPath)) return hashes;

  let entries = [];
  try {
    entries = readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return hashes;
  }

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const ext = entry.name.split(".").pop().toLowerCase();
    if (!["js", "ts", "py", "go", "rs"].includes(ext)) continue;

    const hash = hashFile(join(dirPath, entry.name));
    if (hash) {
      hashes[entry.name] = hash;
    }
  }

  return hashes;
}
