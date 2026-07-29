// validators/anchor-check.js — Verifies consistency of @ai-context anchors
// Zero IA calls. Pure RegEx.

import { readFileSync, existsSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "anchor-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const cwd = config.cwd || process.cwd();
  const zeroErrorDir = config.zeroErrorDir || join(cwd, ".zero-error");
  const changedFiles = getChangedFiles(cwd);

  for (const file of changedFiles) {
    const fullPath = join(cwd, file);
    if (!existsSync(fullPath)) continue;

    const ext = extname(file).toLowerCase();
    if (![".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java", ".rs"].includes(ext)) continue;

    const content = safeRead(fullPath);
    if (!content) continue;

    const anchors = extractAnchors(content);
    for (const anchor of anchors) {
      const targetPath = anchor.target.replace(/^\.zero-error\//, "");
      const targetFile = targetPath.split("#")[0];
      const fullPathTarget = join(zeroErrorDir, targetFile);

      if (!existsSync(fullPathTarget)) {
        errors.push(new ValidatorError({
          file: file,
          line: anchor.line,
          rule: "anchor-invalid-path",
          message: `@ai-context points to non-existent file: ${anchor.target}`,
          ai_hint: `Update the anchor path or run: node init.js --update`,
          severity: "error",
        }));
      }
    }

    if (anchors.length === 0 && isCriticalFile(file)) {
      warnings.push(new ValidatorError({
        file: file,
        line: 0,
        rule: "anchor-missing",
        message: "Critical file has no @ai-context anchor",
        ai_hint: `Run: node init.js --force to inject anchors`,
        severity: "warning",
      }));
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

function extractAnchors(content) {
  const anchors = [];
  const lines = content.split("\n");

  const patterns = [
    /\/\/\s*@ai-context:\s*(.+)/,
    /#\s*@ai-context:\s*(.+)/,
    /<!--\s*@ai-context:\s*(.+?)\s*-->/,
    /\/\*\s*@ai-context:\s*(.+?)\s*\*\//,
  ];

  for (let i = 0; i < lines.length; i++) {
    for (const pattern of patterns) {
      const match = lines[i].match(pattern);
      if (match) {
        anchors.push({
          target: match[1].trim(),
          line: i + 1,
        });
      }
    }
  }

  return anchors;
}

function isCriticalFile(filePath) {
  const lower = filePath.toLowerCase();
  const criticalKeywords = ["controller", "service", "model", "route", "router", "resolver", "handler", "repository", "entity", "schema", "migration"];
  return criticalKeywords.some(kw => lower.includes(kw));
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
