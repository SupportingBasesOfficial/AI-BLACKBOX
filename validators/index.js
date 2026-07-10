// validators/index.js — Central validator runner

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { formatFeedback, aggregateResults, ValidatorResult } from "../lib/validator-contract.js";

const PRE_COMMIT_VALIDATORS = [
  "type-check",
  "lint",
  "doctrine-check",
  "test",
  "security-scan",
];

const PRE_PUSH_VALIDATORS = [
  ...PRE_COMMIT_VALIDATORS,
  "property-tests",
  "impact-analysis",
];

const CI_VALIDATORS = [
  ...PRE_PUSH_VALIDATORS,
  "mutation-test",
];

export async function runValidators(gate, config = {}) {
  const validatorList = gate === "pre-commit" ? PRE_COMMIT_VALIDATORS :
                        gate === "pre-push" ? PRE_PUSH_VALIDATORS :
                        CI_VALIDATORS;

  const results = [];

  for (const validatorName of validatorList) {
    try {
      const mod = await import(`./${validatorName}.js`);
      const files = getChangedFiles(config.cwd || process.cwd());
      const result = await mod.run(files, config);
      results.push(result);

      const status = result.passed ? "PASS" : "FAIL";
      console.log(`  [${status}] ${validatorName} (${result.duration_ms}ms, ${result.errors.length} errors)`);

      if (!result.passed) {
        for (const err of result.errors) {
          if (err.severity === "error") {
            console.error(`    ERROR: ${err.file}:${err.line} — ${err.message}`);
          }
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

  const aggregated = aggregateResults(results);

  if (!aggregated.passed) {
    const feedback = formatFeedback(gate, validatorList
      .map((name, i) => ({ name, result: results[i] }))
      .filter(({ result }) => !result.passed)
      .map(({ name, result }) => ({
        validator: name,
        errors: result.errors.filter(e => e.severity === "error")
      }))
      .filter(v => v.errors.length > 0)
    );
    console.error("\n" + feedback);
  }

  return aggregated;
}

function getChangedFiles(cwd) {
  try {
    const { execSync } = require("child_process");
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd, encoding: "utf-8", timeout: 5000
    }).toString();
    return output.trim().split("\n").filter(f => f && !f.startsWith(".zero-error/"));
  } catch {
    return [];
  }
}

export function loadConstitution(cwd = process.cwd()) {
  const path = join(cwd, "CONSTITUTION.md");
  if (!existsSync(path)) return {};

  const content = readFileSync(path, "utf-8");
  const config = {};

  const requireTestsMatch = content.match(/requireTests:\s*(true|false)/);
  if (requireTestsMatch) config.requireTests = requireTestsMatch[1] === "true";

  const preCommitMatch = content.match(/preCommitTimeout:\s*(\d+)/);
  if (preCommitMatch) config.preCommitTimeout = parseInt(preCommitMatch[1]);

  const prePushMatch = content.match(/prePushTimeout:\s*(\d+)/);
  if (prePushMatch) config.prePushTimeout = parseInt(prePushMatch[1]);

  const ciMatch = content.match(/ciTimeout:\s*(\d+)/);
  if (ciMatch) config.ciTimeout = parseInt(ciMatch[1]);

  const mutationMatch = content.match(/mutationThreshold:\s*(\d+)/);
  if (mutationMatch) config.mutationThreshold = parseInt(mutationMatch[1]);

  const coverageMatch = content.match(/coverageThreshold:\s*(\d+)/);
  if (coverageMatch) config.coverageThreshold = parseInt(coverageMatch[1]);

  return config;
}
