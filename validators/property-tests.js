// validators/property-tests.js — Runs property-based tests if available

import { existsSync, readFileSync } from "fs";
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
  if (existsSync(join(cwd, "node_modules", "fast-check"))) {
    return { command: "npx vitest run --grep property 2>&1 || true", parse: parseVitestProperty };
  }
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
    if (pkg.dependencies?.["fast-check"] || pkg.devDependencies?.["fast-check"]) {
      return { command: "npx vitest run --grep property 2>&1 || true", parse: parseVitestProperty };
    }
  } catch {}
  if (existsSync(join(cwd, "requirements.txt"))) {
    try {
      const reqs = readFileSync(join(cwd, "requirements.txt"), "utf-8");
      if (reqs.includes("hypothesis")) {
        return { command: "python -m pytest -v -k property 2>&1 || true", parse: parsePytestProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "pyproject.toml"))) {
    try {
      const pyproject = readFileSync(join(cwd, "pyproject.toml"), "utf-8");
      if (pyproject.includes("hypothesis")) {
        return { command: "python -m pytest -v -k property 2>&1 || true", parse: parsePytestProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    try {
      const cargo = readFileSync(join(cwd, "Cargo.toml"), "utf-8");
      if (cargo.includes("proptest")) {
        return { command: "cargo test --features proptest 2>&1 || true", parse: parseCargoProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "go.mod"))) {
    try {
      const goMod = readFileSync(join(cwd, "go.mod"), "utf-8");
      if (goMod.includes("gopter")) {
        return { command: "go test ./... -run Property -v 2>&1 || true", parse: parseGoProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "pom.xml")) || existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
    try {
      if (existsSync(join(cwd, "pom.xml"))) {
        const pom = readFileSync(join(cwd, "pom.xml"), "utf-8");
        if (pom.includes("jqwik")) {
          return { command: "mvn test -Dtest=*Property* -q 2>&1 || true", parse: parseJUnitProperty };
        }
      }
      if (existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
        const gradle = readFileSync(existsSync(join(cwd, "build.gradle.kts")) ? join(cwd, "build.gradle.kts") : join(cwd, "build.gradle"), "utf-8");
        if (gradle.includes("kotest-property") || gradle.includes("jqwik") || gradle.includes("scalacheck")) {
          return { command: "gradle test --tests *Property* 2>&1 || true", parse: parseJUnitProperty };
        }
      }
    } catch {}
  }
  if (existsSync(join(cwd, "Package.swift"))) {
    try {
      const swiftPkg = readFileSync(join(cwd, "Package.swift"), "utf-8");
      if (swiftPkg.includes("SwiftCheck") || swiftPkg.includes("swiftcheck")) {
        return { command: "swift test --filter Property 2>&1 || true", parse: parseXCTestProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "mix.exs"))) {
    try {
      const mix = readFileSync(join(cwd, "mix.exs"), "utf-8");
      if (mix.includes("stream_data") || mix.includes("StreamData")) {
        return { command: "mix test --only property 2>&1 || true", parse: parseExUnitProperty };
      }
    } catch {}
  }
  if (existsSync(join(cwd, "Gemfile"))) {
    try {
      const gemfile = readFileSync(join(cwd, "Gemfile"), "utf-8");
      if (gemfile.includes("rantly")) {
        return { command: "bundle exec rspec --tag property 2>&1 || true", parse: parseRSpecProperty };
      }
    } catch {}
  }
  return null;
}

function parseGoProperty(output) {
  const errors = [];
  const failPattern = /---\s+FAIL:\s+(.+?)\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (match[1].toLowerCase().includes("property")) {
      errors.push({
        file: match[2] || "", line: 0,
        rule: "property-test-failure",
        message: `Property test falhou: ${match[1]}`,
        ai_hint: `O property test "${match[1]}" falhou em ${match[2]}. Verifique a propriedade invariante.`
      });
    }
  }
  return errors;
}

function parseJUnitProperty(output) {
  const errors = [];
  const failPattern = /\[ERROR\]\s+(.+?)\s+-\s+(.+?)\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (match[1].toLowerCase().includes("property")) {
      errors.push({
        file: match[3] || "", line: 0,
        rule: "property-test-failure",
        message: `Property test falhou: ${match[1]}`,
        ai_hint: `O property test "${match[1]}" falhou: ${match[2]}. Verifique a propriedade invariante.`
      });
    }
  }
  return errors;
}

function parseXCTestProperty(output) {
  const errors = [];
  const failPattern = /(.+?):(\d+):\s+(.+?)\s+\[FAILED\]/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (match[3].toLowerCase().includes("property")) {
      errors.push({
        file: match[1], line: parseInt(match[2]),
        rule: "property-test-failure",
        message: `Property test falhou: ${match[3]}`,
        ai_hint: `O property test falhou em ${match[1]}:${match[2]}: ${match[3]}.`
      });
    }
  }
  return errors;
}

function parseExUnitProperty(output) {
  const errors = [];
  const failPattern = /\s+1\)\s+(.+?)\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (match[1].toLowerCase().includes("property")) {
      errors.push({
        file: match[2] || "", line: 0,
        rule: "property-test-failure",
        message: `Property test falhou: ${match[1]}`,
        ai_hint: `O property test "${match[1]}" falhou em ${match[2]}.`
      });
    }
  }
  return errors;
}

function parseRSpecProperty(output) {
  const errors = [];
  const failPattern = /Failure:\s+(.+?)\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[2] || "", line: 0,
      rule: "property-test-failure",
      message: `Property test falhou: ${match[1]}`,
      ai_hint: `O property test falhou: ${match[1]} em ${match[2]}.`
    });
  }
  return errors;
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
