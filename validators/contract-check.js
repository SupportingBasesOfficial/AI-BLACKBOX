// validators/contract-check.js — AST diff: prohibits accidental contract changes
// Zero IA calls. Pure RegEx + AST pseudo-parsing.

import { readFileSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "contract-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const cwd = config.cwd || process.cwd();
  const changedFiles = getChangedFiles(cwd);

  for (const file of changedFiles) {
    const ext = extname(file).toLowerCase();
    if (![".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java"].includes(ext)) continue;

    const oldSignatures = extractSignaturesFromGit(cwd, file);
    const newSignatures = extractSignaturesFromFile(join(cwd, file));
    if (!oldSignatures || oldSignatures.length === 0) continue;

    const diff = compareSignatures(oldSignatures, newSignatures);
    for (const change of diff) {
      if (change.type === "removed") {
        errors.push(new ValidatorError({
          file: file,
          line: change.line || 0,
          rule: "contract-removed",
          message: `Function "${change.name}" was removed — breaking contract`,
          ai_hint: `If intentional, document the removal. Otherwise, restore the function.`,
          severity: "error",
        }));
      } else if (change.type === "signature-changed") {
        errors.push(new ValidatorError({
          file: file,
          line: change.line || 0,
          rule: "contract-changed",
          message: `Function "${change.name}" signature changed: ${change.detail}`,
          ai_hint: `If intentional refactoring, update all callers. Otherwise, restore original signature.`,
          severity: "error",
        }));
      } else if (change.type === "added") {
        warnings.push(new ValidatorError({
          file: file,
          line: change.line || 0,
          rule: "contract-added",
          message: `New function "${change.name}" added`,
          ai_hint: `Ensure new function has tests.`,
          severity: "warning",
        }));
      }
    }
  }

  return new ValidatorResult({
    passed: errors.length === 0,
    errors,
    warnings,
    duration_ms: Date.now() - startTime,
  });
}

function getChangedFiles(cwd) {
  try {
    const output = execSync("git diff --name-only --cached HEAD", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim();
    return output ? output.split("\n").filter(f => f.length > 0) : [];
  } catch {
    return [];
  }
}

function extractSignaturesFromGit(cwd, file) {
  try {
    const content = execSync(`git show HEAD:${file}`, {
      cwd, encoding: "utf-8", timeout: 5000,
    });
    return extractSignatures(content, extname(file).toLowerCase());
  } catch {
    return [];
  }
}

function extractSignaturesFromFile(filePath) {
  try {
    const content = readFileSync(filePath, "utf-8");
    return extractSignatures(content, extname(filePath).toLowerCase());
  } catch {
    return [];
  }
}

function extractSignatures(content, ext) {
  const sigs = [];
  const lines = content.split("\n");

  const patterns = [
    { regex: /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\(([^)]*)\)(?:\s*:\s*(\S+))?/g, lang: "js/ts" },
    { regex: /(?:export\s+)?(?:const|let)\s+(\w+)\s*=\s*(?:async\s*)?\(([^)]*)\)(?:\s*:\s*(\S+))?\s*=>/g, lang: "js/ts" },
    { regex: /(?:export\s+)?class\s+(\w+)\s*(?:extends\s+\w+)?\s*\{/g, lang: "js/ts" },
    { regex: /def\s+(\w+)\s*\(([^)]*)\)/g, lang: "py" },
    { regex: /class\s+(\w+)\s*[\(:]/g, lang: "py" },
    { regex: /func\s+(\w+)\s*\(([^)]*)\)/g, lang: "go" },
    { regex: /(?:public|private|protected)\s+(?:static\s+)?(?:\w+(?:<[^>]+>)?)\s+(\w+)\s*\(([^)]*)\)/g, lang: "java" },
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const { regex } of patterns) {
      const re = new RegExp(regex.source, regex.flags);
      const m = re.exec(lines[i]);
      if (m) {
        sigs.push({
          name: m[1],
          params: (m[2] || "").trim(),
          returnType: (m[3] || "").trim(),
          line: i + 1,
          signature: `${m[1]}(${(m[2] || "").trim()})${m[3] ? ": " + m[3].trim() : ""}`,
        });
      }
    }
  }

  return sigs;
}

function compareSignatures(oldSigs, newSigs) {
  const changes = [];
  const oldMap = new Map(oldSigs.map(s => [s.name, s]));
  const newMap = new Map(newSigs.map(s => [s.name, s]));

  for (const [name, oldSig] of oldMap) {
    if (!newMap.has(name)) {
      changes.push({ type: "removed", name, line: oldSig.line });
    } else {
      const newSig = newMap.get(name);
      if (oldSig.params !== newSig.params || oldSig.returnType !== newSig.returnType) {
        const details = [];
        if (oldSig.params !== newSig.params) details.push(`params: "${oldSig.params}" -> "${newSig.params}"`);
        if (oldSig.returnType !== newSig.returnType) details.push(`return: "${oldSig.returnType}" -> "${newSig.returnType}"`);
        changes.push({ type: "signature-changed", name, line: newSig.line, detail: details.join("; ") });
      }
    }
  }

  for (const [name, newSig] of newMap) {
    if (!oldMap.has(name)) {
      changes.push({ type: "added", name, line: newSig.line });
    }
  }

  return changes;
}
