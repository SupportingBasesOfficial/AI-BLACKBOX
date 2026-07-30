// validators/index.js — Central validator runner (v2)
// Loads gates.json for validator lists, supports cache + progressive feedback

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
  const files = getChangedFiles(cwd);

  let cache = null;
  try {
    const { createCache } = await import("../lib/validator-cache.js");
    cache = createCache(dirname(__dirname));
  } catch {}

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

function getChangedFiles(cwd) {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd, encoding: "utf-8", timeout: 5000
    }).toString();
    return output.trim().split("\n").filter(f => f && !f.startsWith(".zero-error/"));
  } catch {
    try {
      const output = execSync("git diff --name-only", {
        cwd, encoding: "utf-8", timeout: 5000
      }).toString();
      return output.trim().split("\n").filter(f => f && !f.startsWith(".zero-error/"));
    } catch {
      return [];
    }
  }
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
