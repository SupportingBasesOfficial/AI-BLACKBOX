// validators/index.js — Central validator runner (v2)
// Loads gates.json for validator lists, supports local cache + progressive feedback.
// CI is deliberately uncached and validates a real repository scope.

import { existsSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";
import { formatFeedback, aggregateResults, ValidatorResult } from "../lib/validator-contract.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const DEFAULT_GATES = {
  "pre-commit": ["type-check", "lint", "doctrine-check", "test", "security-scan", "contract-check", "anchor-check", "tech-debt-check"],
  "pre-push": ["type-check", "lint", "doctrine-check", "test", "security-scan", "contract-check", "anchor-check", "tech-debt-check", "property-tests", "impact-analysis", "schema-sync-check", "api-compat-check", "perf-budget-check"],
  "ci": ["type-check", "lint", "doctrine-check", "test", "security-scan", "contract-check", "anchor-check", "tech-debt-check", "property-tests", "impact-analysis", "schema-sync-check", "api-compat-check", "perf-budget-check", "mutation-test"],
  "timeout": { "pre-commit": 30, "pre-push": 120, "ci": 600 },
};

function loadGates() {
  const gatesPath = join(dirname(__dirname), "gates.json");
  if (existsSync(gatesPath)) {
    try {
      return JSON.parse(readFileSync(gatesPath, "utf-8"));
    } catch {}
  }
  return DEFAULT_GATES;
}

export async function runValidators(gate, config = {}) {
  const gates = loadGates();
  let validatorList = gates[gate] || DEFAULT_GATES[gate] || [];

  if (gate === "pre-push" && Array.isArray(validatorList)) {
    const preCommit = gates["pre-commit"] || DEFAULT_GATES["pre-commit"];
    validatorList = [...new Set([...preCommit, ...validatorList])];
  }
  if (gate === "ci" && Array.isArray(validatorList)) {
    const prePush = gates["pre-push"] || DEFAULT_GATES["pre-push"];
    const preCommit = gates["pre-commit"] || DEFAULT_GATES["pre-commit"];
    validatorList = [...new Set([...preCommit, ...prePush, ...validatorList])];
  }

  const results = [];
  const cwd = config.cwd || process.cwd();
  const files = getChangedFiles(cwd, gate);
  const useCache = gate !== "ci" && config.useCache !== false;

  console.log(`  Scope: ${gate} — ${files.length} file(s)${useCache ? " — cache enabled" : " — cache disabled"}`);

  let cache = null;
  if (useCache) {
    try {
      const { createCache } = await import("../lib/validator-cache.js");
      cache = createCache(dirname(__dirname));
    } catch {}
  }

  for (const validatorName of validatorList) {
    let allCached = files.length > 0;
    if (cache && files.length > 0) {
      for (const file of files) {
        if (cache.hasChanged(file, validatorName)) {
          allCached = false;
          break;
        }
      }
    } else {
      allCached = false;
    }

    if (allCached) {
      console.log(`  [CACHED] ${validatorName} (0ms, 0 errors)`);
      results.push(new ValidatorResult({ passed: true, duration_ms: 0 }));
      continue;
    }

    try {
      const mod = await import(`./${validatorName}.js`);
      const result = await mod.run(files, { ...config, cwd, zeroErrorDir: dirname(__dirname) });
      results.push(result);

      const status = result.passed ? "PASS" : "FAIL";
      console.log(`  [${status}] ${validatorName} (${result.duration_ms}ms, ${result.errors.length} errors)`);

      if (!result.passed) {
        for (const err of result.errors) {
          if (err.severity === "error") {
            console.error(`    ERROR: ${err.file}:${err.line} — ${err.message}`);
            if (err.ai_hint) {
              console.error(`           hint: ${err.ai_hint}`);
            }
          } else if (err.severity === "warning") {
            console.warn(`    WARN:  ${err.file}:${err.line} — ${err.message}`);
          }
        }
      }

      if (cache && files.length > 0) {
        for (const file of files) {
          cache.recordValidation(file, validatorName, result.passed, result.errors);
        }
      }
    } catch (err) {
      console.error(`  [ERROR] ${validatorName}: ${err.message}`);
      results.push(new ValidatorResult({
        passed: false,
        errors: [{ file: "", rule: "validator-crash", message: err.message, ai_hint: err.message, severity: "error" }],
        duration_ms: 0
      }));
    }
  }

  if (cache) {
    cache.flush();
  }

  const aggregated = aggregateResults(results);

  if (!aggregated.passed) {
    const failedValidators = validatorList
      .map((name, i) => ({ name, result: results[i] }))
      .filter(({ result }) => result && !result.passed)
      .map(({ name, result }) => ({
        validator: name,
        errors: result.errors.filter(e => e.severity === "error")
      }))
      .filter(v => v.errors.length > 0);

    if (failedValidators.length > 0) {
      const feedback = formatFeedback(gate, failedValidators);
      console.error("\n" + feedback);
    }
  }

  return aggregated;
}

function getChangedFiles(cwd, gate = "pre-commit") {
  if (gate === "ci") {
    return getCiFiles(cwd);
  }

  if (gate === "pre-push") {
    const upstreamFiles = runGitNameOnly(cwd, "git diff --name-only --diff-filter=ACMR @{upstream}...HEAD");
    if (upstreamFiles.length > 0) return upstreamFiles;
  }

  // Pre-commit must inspect the staged snapshot. Do not silently substitute
  // arbitrary working-tree files when nothing is staged.
  const stagedFiles = runGitNameOnly(cwd, "git diff --cached --name-only --diff-filter=ACMR");
  if (stagedFiles.length > 0) return stagedFiles;

  if (gate === "pre-commit") return [];

  return runGitNameOnly(cwd, "git diff --name-only --diff-filter=ACMR");
}

function getCiFiles(cwd) {
  // PR workflows expose the target branch through GITHUB_BASE_REF.
  const baseRef = process.env.GITHUB_BASE_REF;
  if (baseRef) {
    const prFiles = runGitNameOnly(
      cwd,
      `git diff --name-only --diff-filter=ACMR origin/${sanitizeRef(baseRef)}...HEAD`
    );
    if (prFiles.length > 0) return prFiles;
  }

  // Push workflows can expose the previous SHA. This catches the pushed range
  // without depending on a shallow checkout.
  const before = process.env.GITHUB_EVENT_BEFORE;
  if (before && /^[0-9a-f]{40}$/i.test(before) && !/^0+$/.test(before)) {
    const pushFiles = runGitNameOnly(cwd, `git diff --name-only --diff-filter=ACMR ${before}...HEAD`);
    if (pushFiles.length > 0) return pushFiles;
  }

  // Direct/local CI invocation or an event with no usable diff: validate the
  // complete tracked project. A CI gate must never become a no-op because the
  // runner cannot infer a diff range.
  return runGitNameOnly(cwd, "git ls-files");
}

function runGitNameOnly(cwd, command) {
  try {
    const output = execSync(command, {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
      stdio: ["ignore", "pipe", "ignore"]
    }).toString();
    return output.split("\n").map(f => f.trim()).filter(f => f && !shouldIgnorePath(f));
  } catch {
    return [];
  }
}

function sanitizeRef(ref) {
  return ref.replace(/[^A-Za-z0-9._/-]/g, "");
}

function shouldIgnorePath(file) {
  return file === ".zero-error" || file.startsWith(".zero-error/") || file.includes("node_modules/");
}

export function loadGatesConfig() {
  return loadGates();
}

// CLI entry point: node validators/index.js <gate>
const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(`file://${process.argv[1].replace(/\\/g, "/")}`) === __filename) {
  const gate = process.argv[2] || "pre-commit";
  runValidators(gate).then(result => {
    process.exit(result.passed ? 0 : 1);
  }).catch(err => {
    console.error("Fatal error:", err.message);
    process.exit(1);
  });
}
