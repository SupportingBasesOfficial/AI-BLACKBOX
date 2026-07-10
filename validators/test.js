// validators/test.js — Runs project tests, with fallback for projects without tests

import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "test";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();

  const framework = detectTestFramework(cwd);

  if (!framework) {
    if (config.requireTests === true) {
      return new ValidatorResult({
        passed: false,
        errors: [new ValidatorError({
          file: "", rule: "no-tests",
          message: "Projeto não possui testes. Gere testes antes de commitar.",
          ai_hint: "Nenhum framework de testes detectado. Instale um framework (vitest/pytest/cargo test) e escreva testes para o código alterado antes de commitar.",
          severity: "error"
        })],
        duration_ms: Date.now() - startTime
      });
    } else {
      return new ValidatorResult({
        passed: true,
        warnings: [{ rule: "no-tests", message: "Projeto sem testes. Validação limitada." }],
        duration_ms: Date.now() - startTime
      });
    }
  }

  try {
    const output = execSync(framework.command, {
      cwd, encoding: "utf-8",
      timeout: (config.timeout || 30) * 1000,
      stdio: ["pipe", "pipe", "pipe"]
    }).toString();

    const parsed = framework.parse(output);
    for (const e of parsed) {
      errors.push(new ValidatorError({
        file: e.file, line: e.line || 0, rule: e.rule || "test-failure",
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
          file: e.file, line: e.line || 0, rule: e.rule || "test-failure",
          message: e.message, ai_hint: e.ai_hint || e.message,
          severity: "error"
        }));
      }
    }
    if (errors.length === 0 && err.killed) {
      errors.push(new ValidatorError({
        file: "", rule: "test-timeout",
        message: "Testes excederam o timeout",
        ai_hint: "Os testes demoraram muito. Verifique se há loops infinitos ou testes lentos.",
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

function detectTestFramework(cwd) {
  // Vitest
  if (existsSync(join(cwd, "vitest.config.ts")) || existsSync(join(cwd, "vitest.config.js")) ||
      existsSync(join(cwd, "vite.config.ts")) || existsSync(join(cwd, "vite.config.js"))) {
    return { command: "npx vitest run --reporter verbose 2>&1 || true", parse: parseVitest };
  }
  // Jest
  if (existsSync(join(cwd, "jest.config.js")) || existsSync(join(cwd, "jest.config.ts")) ||
      existsSync(join(cwd, "jest.config.json"))) {
    return { command: "npx jest --verbose 2>&1 || true", parse: parseJest };
  }
  // Pytest
  if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml")) ||
      existsSync(join(cwd, "conftest.py"))) {
    return { command: "python -m pytest -v 2>&1 || true", parse: parsePytest };
  }
  // Cargo test
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return { command: "cargo test 2>&1 || true", parse: parseCargoTest };
  }
  // Go test
  if (existsSync(join(cwd, "go.mod"))) {
    return { command: "go test ./... -v 2>&1 || true", parse: parseGoTest };
  }
  return null;
}

function parseVitest(output) {
  const errors = [];
  const failMatch = output.match(/FAIL\s+(.+)/g);
  if (failMatch) {
    for (const fail of failMatch) {
      const file = fail.replace("FAIL ", "").trim();
      errors.push({
        file, rule: "vitest-failure",
        message: `Teste falhou em ${file}`,
        ai_hint: `Testes falharam em ${file}. Execute 'npx vitest run ${file}' para ver os detalhes e corrija os testes.`
      });
    }
  }
  // Parse individual assertion failures
  const assertionPattern = /×\s+(.+?)\s+\((.+?):(\d+):(\d+)\)/g;
  const matches = [...output.matchAll(assertionPattern)];
  for (const match of matches) {
    errors.push({
      file: match[2], line: parseInt(match[3]),
      rule: "assertion-failure",
      message: `Assertion falhou: ${match[1]}`,
      ai_hint: `O teste "${match[1]}" falhou em ${match[2]}:${match[3]}. Verifique a assertion e corrija o código ou o teste.`
    });
  }
  return errors;
}

function parseJest(output) {
  const errors = [];
  const failPattern = /●\s+(.+?)\s+\(at\s+(.+?):(\d+):(\d+)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[2], line: parseInt(match[3]),
      rule: "jest-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste "${match[1]}" falhou em ${match[2]}:${match[3]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parsePytest(output) {
  const errors = [];
  const failPattern = /FAILED\s+(.+?)::(.+?)\s+-\s+(.+)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[1], line: 0,
      rule: "pytest-failure",
      message: `Teste falhou: ${match[2]} - ${match[3]}`,
      ai_hint: `O teste "${match[2]}" falhou em ${match[1]}. Erro: ${match[3]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parseCargoTest(output) {
  const errors = [];
  const failPattern = /test\s+(.+?)\s+\.\.\.\s+FAILED/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: "", line: 0,
      rule: "cargo-test-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste "${match[1]}" falhou. Execute 'cargo test ${match[1]}' para detalhes.`
    });
  }
  return errors;
}

function parseGoTest(output) {
  const errors = [];
  const failPattern = /---\s+FAIL:\s+(.+?)\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[2], line: 0,
      rule: "go-test-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste "${match[1]}" falhou em ${match[2]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}
