// validators/type-check.js — Runs the appropriate type checker for the project's language

import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "type-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();

  const tool = detectTypeChecker(cwd);
  if (!tool) {
    return new ValidatorResult({
      passed: true,
      warnings: [{ rule: "no-type-checker", message: "Nenhum type checker detectado." }],
      duration_ms: Date.now() - startTime
    });
  }

  try {
    const output = execSync(tool.command, {
      cwd,
      encoding: "utf-8",
      timeout: (config.timeout || 30) * 1000,
      stdio: ["pipe", "pipe", "pipe"]
    }).toString();

    const parsed = tool.parse(output);
    for (const err of parsed) {
      errors.push(new ValidatorError({
        file: err.file,
        line: err.line,
        rule: err.rule,
        message: err.message,
        ai_hint: err.ai_hint || err.message,
        severity: "error"
      }));
    }
  } catch (err) {
    if (err.stdout) {
      const parsed = tool.parse(err.stdout.toString());
      for (const e of parsed) {
        errors.push(new ValidatorError({
          file: e.file, line: e.line, rule: e.rule,
          message: e.message, ai_hint: e.ai_hint || e.message,
          severity: "error"
        }));
      }
    }
    if (errors.length === 0 && err.killed) {
      errors.push(new ValidatorError({
        file: "", rule: "timeout",
        message: "Type check excedeu o timeout",
        ai_hint: "O type check demorou muito. Verifique se há erros de tipo no projeto.",
        severity: "error"
      }));
    }
  }

  return new ValidatorResult({
    passed: errors.length === 0,
    errors,
    duration_ms: Date.now() - startTime
  });
}

function detectTypeChecker(cwd) {
  if (existsSync(join(cwd, "tsconfig.json"))) {
    return {
      command: "npx tsc --noEmit --pretty false",
      parse: parseTSC
    };
  }
  if (existsSync(join(cwd, "pyproject.toml")) || existsSync(join(cwd, "setup.cfg"))) {
    return {
      command: "mypy . --no-error-summary 2>&1 || true",
      parse: parseMypy
    };
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return {
      command: "cargo check 2>&1 || true",
      parse: parseCargo
    };
  }
  if (existsSync(join(cwd, "go.mod"))) {
    return {
      command: "go vet ./... 2>&1 || true",
      parse: parseGoVet
    };
  }
  return null;
}

function parseTSC(output) {
  const errors = [];
  const lines = output.split("\n").filter(l => l.trim());
  for (const line of lines) {
    const match = line.match(/^(.+?)\((\d+),(\d+)\):\s*(error|warning)\s+(TS\d+):\s*(.+)$/);
    if (match) {
      errors.push({
        file: match[1], line: parseInt(match[2]),
        rule: match[5], message: match[6],
        ai_hint: `${match[6]} (${match[5]}) em ${match[1]}:${match[2]}. Corrija o tipo.`
      });
    }
  }
  return errors;
}

function parseMypy(output) {
  const errors = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(.+?):(\d+):\s*(error|warning):\s*(.+)$/);
    if (match) {
      errors.push({
        file: match[1], line: parseInt(match[2]),
        rule: "mypy", message: match[4],
        ai_hint: `${match[4]} em ${match[1]}:${match[2]}. Corrija o tipo.`
      });
    }
  }
  return errors;
}

function parseCargo(output) {
  const errors = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^error(?:\[E\d+\])?:\s*(.+)$/);
    if (match) {
      errors.push({
        file: "", line: 0,
        rule: "rustc", message: match[1],
        ai_hint: `${match[1]}. Corrija o erro de compilação.`
      });
    }
  }
  return errors;
}

function parseGoVet(output) {
  const errors = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(.+?):(\d+):\s*(.+)$/);
    if (match) {
      errors.push({
        file: match[1], line: parseInt(match[2]),
        rule: "go-vet", message: match[3],
        ai_hint: `${match[3]} em ${match[1]}:${match[2]}.`
      });
    }
  }
  return errors;
}
