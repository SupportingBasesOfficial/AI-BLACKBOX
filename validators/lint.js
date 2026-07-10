// validators/lint.js — Runs the appropriate linter for the project's language

import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "lint";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();

  const tool = detectLinter(cwd);
  if (!tool) {
    return new ValidatorResult({
      passed: true,
      warnings: [{ rule: "no-linter", message: "Nenhum linter detectado." }],
      duration_ms: Date.now() - startTime
    });
  }

  try {
    const output = execSync(tool.command, {
      cwd, encoding: "utf-8",
      timeout: (config.timeout || 30) * 1000,
      stdio: ["pipe", "pipe", "pipe"]
    }).toString();

    const parsed = tool.parse(output);
    for (const e of parsed) {
      errors.push(new ValidatorError({
        file: e.file, line: e.line, rule: e.rule,
        message: e.message, ai_hint: e.ai_hint || e.message,
        severity: e.severity || "error"
      }));
    }
  } catch (err) {
    const output = (err.stdout || "").toString() + (err.stderr || "").toString();
    if (output) {
      const parsed = tool.parse(output);
      for (const e of parsed) {
        errors.push(new ValidatorError({
          file: e.file, line: e.line, rule: e.rule,
          message: e.message, ai_hint: e.ai_hint || e.message,
          severity: e.severity || "error"
        }));
      }
    }
  }

  return new ValidatorResult({
    passed: errors.filter(e => e.severity === "error").length === 0,
    errors,
    duration_ms: Date.now() - startTime
  });
}

function detectLinter(cwd) {
  if (existsSync(join(cwd, ".eslintrc")) || existsSync(join(cwd, ".eslintrc.js")) ||
      existsSync(join(cwd, ".eslintrc.json")) || existsSync(join(cwd, ".eslintrc.cjs")) ||
      existsSync(join(cwd, "eslint.config.js")) || existsSync(join(cwd, "eslint.config.mjs"))) {
    return { command: "npx eslint . --format json 2>&1 || true", parse: parseESLint };
  }
  if (existsSync(join(cwd, "ruff.toml")) || existsSync(join(cwd, ".ruff.toml"))) {
    return { command: "ruff check . --output-format json 2>&1 || true", parse: parseRuff };
  }
  if (existsSync(join(cwd, ".golangci.yml")) || existsSync(join(cwd, ".golangci.yaml"))) {
    return { command: "golangci-lint run --format json 2>&1 || true", parse: parseGolangCI };
  }
  return null;
}

function parseESLint(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const file of results) {
      for (const msg of file.messages || []) {
        errors.push({
          file: file.filePath,
          line: msg.line || 0,
          rule: msg.ruleId || "eslint",
          message: msg.message,
          ai_hint: `${msg.message} (${msg.ruleId}) em ${file.filePath}:${msg.line}. Corrija conforme a regra do ESLint.`,
          severity: msg.severity === 2 ? "error" : "warning"
        });
      }
    }
    return errors;
  } catch {
    return [];
  }
}

function parseRuff(output) {
  try {
    const results = JSON.parse(output);
    return results.map(r => ({
      file: r.filename, line: r.location?.row || 0,
      rule: r.code, message: r.message,
      ai_hint: `${r.message} (${r.code}) em ${r.filename}. Corrija conforme a regra do Ruff.`,
      severity: "error"
    }));
  } catch {
    return [];
  }
}

function parseGolangCI(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const issue of results.Issues || []) {
      errors.push({
        file: issue.Pos.Filename, line: issue.Pos.Line,
        rule: issue.FromLinter, message: issue.Text,
        ai_hint: `${issue.Text} (${issue.FromLinter}) em ${issue.Pos.Filename}:${issue.Pos.Line}.`,
        severity: "error"
      });
    }
    return errors;
  } catch {
    return [];
  }
}
