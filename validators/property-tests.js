// validators/property-tests.js — Runs property-based tests if available

import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "property-tests";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();

  const framework = detectPropertyTestFramework(cwd);
  if (!framework) {
    return new ValidatorResult({
      passed: true,
      warnings: [{ rule: "no-property-tests", message: "Nenhum framework de property-based tests detectado." }],
      duration_ms: Date.now() - startTime
    });
  }

  try {
    const output = execSync(framework.command, {
      cwd, encoding: "utf-8",
      timeout: (config.timeout || 120) * 1000,
      stdio: ["pipe", "pipe", "pipe"]
    }).toString();

    const parsed = framework.parse(output);
    for (const e of parsed) {
      errors.push(new ValidatorError({
        file: e.file, line: e.line || 0, rule: e.rule,
        message: e.message, ai_hint: e.ai_hint || e.message,
        severity: "error"
      }));
    }
  } catch (err) {
    const output = (err.stdout || "").toString() + (err.stderr || "").toString();
    if (output && framework.parse) {
      const parsed = framework.parse(output);
      for (const e of parsed) {
        errors.push(new ValidatorError({
          file: e.file, line: e.line || 0, rule: e.rule,
          message: e.message, ai_hint: e.ai_hint || e.message,
          severity: "error"
        }));
      }
    }
  }

  return new ValidatorResult({
    passed: errors.length === 0,
    errors,
    duration_ms: Date.now() - startTime
  });
}

function detectPropertyTestFramework(cwd) {
  // fast-check (JS/TS)
  if (existsSync(join(cwd, "node_modules", "fast-check"))) {
    return { command: "npx vitest run --grep property 2>&1 || true", parse: parseVitestProperty };
  }
  // hypothesis (Python)
  if (existsSync(join(cwd, "node_modules"))) {}
  try {
    const pkg = JSON.parse(require("fs").readFileSync(join(cwd, "package.json"), "utf-8"));
    if (pkg.dependencies?.["fast-check"] || pkg.devDependencies?.["fast-check"]) {
      return { command: "npx vitest run --grep property 2>&1 || true", parse: parseVitestProperty };
    }
  } catch {}
  if (existsSync(join(cwd, "requirements.txt"))) {
    try {
      const reqs = require("fs").readFileSync(join(cwd, "requirements.txt"), "utf-8");
      if (reqs.includes("hypothesis")) {
        return { command: "python -m pytest -v -k property 2>&1 || true", parse: parsePytestProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    try {
      const cargo = require("fs").readFileSync(join(cwd, "Cargo.toml"), "utf-8");
      if (cargo.includes("proptest")) {
        return { command: "cargo test --features proptest 2>&1 || true", parse: parseCargoProperty };
      }
    } catch {}
  }
  return null;
}

function parseVitestProperty(output) {
  const errors = [];
  const failPattern = /×\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (match[1].toLowerCase().includes("property")) {
      errors.push({
        file: match[2], line: parseInt(match[3]),
        rule: "property-test-failure",
        message: `Property test falhou: ${match[1]}`,
        ai_hint: `O property test "${match[1]}" falhou em ${match[2]}:${match[3]}. Verifique a propriedade invariante.`
      });
    }
  }
  return errors;
}

function parsePytestProperty(output) {
  const errors = [];
  const failPattern = /FAILED\s+(.+?)::(.+?)\s+-\s+(.+)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (match[2].toLowerCase().includes("property")) {
      errors.push({
        file: match[1], line: 0,
        rule: "property-test-failure",
        message: `Property test falhou: ${match[2]}`,
        ai_hint: `O property test "${match[2]}" falhou em ${match[1]}. Erro: ${match[3]}.`
      });
    }
  }
  return errors;
}

function parseCargoProperty(output) {
  const errors = [];
  const failPattern = /test\s+(.+?)\s+\.\.\.\s+FAILED/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: "", line: 0,
      rule: "property-test-failure",
      message: `Property test falhou: ${match[1]}`,
      ai_hint: `O property test "${match[1]}" falhou. Execute 'cargo test ${match[1]}' para detalhes.`
    });
  }
  return errors;
}
