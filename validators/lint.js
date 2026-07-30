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
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return { command: "cargo clippy --message-format json 2>&1 || true", parse: parseClippy };
  }
  if (existsSync(join(cwd, ".rubocop.yml")) || existsSync(join(cwd, "Gemfile"))) {
    return { command: "bundle exec rubocop --format json 2>&1 || true", parse: parseRubocop };
  }
  if (existsSync(join(cwd, ".php-cs-fixer.php")) || existsSync(join(cwd, "composer.json"))) {
    return { command: "vendor/bin/php-cs-fixer fix --dry-run --format json 2>&1 || true", parse: parsePHPCS };
  }
  if (existsSync(join(cwd, ".swiftlint.yml"))) {
    return { command: "swiftlint lint --reporter json 2>&1 || true", parse: parseSwiftLint };
  }
  if (existsSync(join(cwd, "pubspec.yaml"))) {
    return { command: "dart analyze --format json 2>&1 || true", parse: parseDartAnalyze };
  }
  if (existsSync(join(cwd, ".clang-tidy"))) {
    return { command: "clang-tidy --warnings-as-errors=* --format json 2>&1 || true", parse: parseClangTidy };
  }
  if (existsSync(join(cwd, "mix.exs"))) {
    return { command: "mix credo --format json 2>&1 || true", parse: parseCredo };
  }
  if (existsSync(join(cwd, ".editorconfig")) || existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
    return { command: "ktlint --reporter=json 2>&1 || true", parse: parseKTLint };
  }
  if (existsSync(join(cwd, ".checkstyle.xml")) || existsSync(join(cwd, "checkstyle.xml"))) {
    return { command: "checkstyle -c checkstyle.xml -f xml . 2>&1 || true", parse: parseCheckstyle };
  }
  return null;
}

function parseClippy(output) {
  const errors = [];
  try {
    const lines = output.split("\n");
    for (const line of lines) {
      try {
        const msg = JSON.parse(line);
        if (msg.reason === "compiler-message" && msg.message) {
          errors.push({
            file: msg.message.spans?.[0]?.file_name || "",
            line: msg.message.spans?.[0]?.line_start || 0,
            rule: msg.message.code?.code || "clippy",
            message: msg.message.message,
            ai_hint: `${msg.message.message} em ${msg.message.spans?.[0]?.file_name || ""}. Corrija conforme o Clippy.`,
            severity: msg.message.level === "error" ? "error" : "warning"
          });
        }
      } catch {}
    }
  } catch {}
  return errors;
}

function parseRubocop(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const file of results.files || []) {
      for (const offense of file.offenses || []) {
        errors.push({
          file: file.path, line: offense.location?.line || 0,
          rule: offense.cop_name, message: offense.message,
          ai_hint: `${offense.message} (${offense.cop_name}) em ${file.path}:${offense.location?.line}.`,
          severity: offense.severity === "error" ? "error" : "warning"
        });
      }
    }
    return errors;
  } catch {
    return [];
  }
}

function parsePHPCS(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const file of results.files || []) {
      for (const msg of file.messages || []) {
        errors.push({
          file: file.name || "", line: msg.line || 0,
          rule: msg.rule || "php-cs-fixer", message: msg.message,
          ai_hint: `${msg.message} em ${file.name}:${msg.line}.`,
          severity: "warning"
        });
      }
    }
    return errors;
  } catch {
    return [];
  }
}

function parseSwiftLint(output) {
  try {
    const results = JSON.parse(output);
    return (results || []).map(r => ({
      file: r.file || "", line: r.line || 0,
      rule: r.rule_id || "swiftlint", message: r.reason || "",
      ai_hint: `${r.reason} (${r.rule_id}) em ${r.file}:${r.line}.`,
      severity: r.severity === "error" ? "error" : "warning"
    }));
  } catch {
    return [];
  }
}

function parseDartAnalyze(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const diag of results.diagnostics || []) {
      errors.push({
        file: diag.location?.file || "", line: diag.location?.range?.start?.line || 0,
        rule: diag.code || "dart", message: diag.message || "",
        ai_hint: `${diag.message} em ${diag.location?.file}.`,
        severity: diag.severity === "error" ? "error" : "warning"
      });
    }
    return errors;
  } catch {
    return [];
  }
}

function parseClangTidy(output) {
  const errors = [];
  for (const line of output.split("\n")) {
    const match = line.match(/^(.+?):(\d+):(\d+):\s*(error|warning):\s*(.+)$/);
    if (match) {
      errors.push({
        file: match[1], line: parseInt(match[2]),
        rule: "clang-tidy", message: match[5],
        ai_hint: `${match[5]} em ${match[1]}:${match[2]}.`,
        severity: match[4] === "error" ? "error" : "warning"
      });
    }
  }
  return errors;
}

function parseCredo(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const issue of results.issues || []) {
      errors.push({
        file: issue.filename || "", line: issue.line_no || 0,
        rule: issue.check || "credo", message: issue.message || "",
        ai_hint: `${issue.message} (${issue.check}) em ${issue.filename}:${issue.line_no}.`,
        severity: issue.priority >= 2 ? "error" : "warning"
      });
    }
    return errors;
  } catch {
    return [];
  }
}

function parseKTLint(output) {
  try {
    const results = JSON.parse(output);
    const errors = [];
    for (const item of results || []) {
      errors.push({
        file: item.file || "", line: item.line || 0,
        rule: item.rule || "ktlint", message: item.message || "",
        ai_hint: `${item.message} (${item.rule}) em ${item.file}:${item.line}.`,
        severity: "warning"
      });
    }
    return errors;
  } catch {
    return [];
  }
}

function parseCheckstyle(output) {
  const errors = [];
  for (const line of output.split("\n")) {
    const match = line.match(/<file name="([^"]+)">[\s\S]*?<error line="(\d+)"\s+message="([^"]+)"\s+source="([^"]+)"/g);
    if (match) {
      for (const m of match) {
        const m2 = m.match(/<file name="([^"]+)">[\s\S]*?<error line="(\d+)"\s+message="([^"]+)"\s+source="([^"]+)"/);
        if (m2) {
          errors.push({
            file: m2[1], line: parseInt(m2[2]),
            rule: m2[4], message: m2[3],
            ai_hint: `${m2[3]} (${m2[4]}) em ${m2[1]}:${m2[2]}.`,
            severity: "warning"
          });
        }
      }
    }
  }
  return errors;
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
