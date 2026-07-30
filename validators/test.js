// validators/test.js — Runs project tests, with fallback for projects without tests

import { existsSync, readFileSync } from "fs";
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

  const criticalPathErrors = checkCriticalPathCoverage(cwd, files, config);
  errors.push(...criticalPathErrors);

  return new ValidatorResult({
    passed: errors.length === 0,
    errors,
    duration_ms: Date.now() - startTime
  });
}

function checkCriticalPathCoverage(cwd, files, config) {
  const errors = [];
  const zeroErrorDir = config.zeroErrorDir || join(cwd, ".zero-error");
  const sourceOfTruthPath = join(zeroErrorDir, "source-of-truth.json");

  if (!existsSync(sourceOfTruthPath)) return errors;

  try {
    const sourceOfTruth = JSON.parse(readFileSync(sourceOfTruthPath, "utf-8"));
    const criticalPaths = sourceOfTruth.project_integrity?.critical_paths || [];
    const requireTestCoverage = sourceOfTruth.project_integrity?.critical_path_test_required ?? false;

    if (!requireTestCoverage || criticalPaths.length === 0) return errors;

    for (const file of (files || [])) {
      const isCritical = criticalPaths.some(cp => file.toLowerCase().includes(cp.toLowerCase().replace(/\/$/, "")));
      if (!isCritical) continue;

      const testFile = findCorrespondingTestFile(cwd, file);
      if (!testFile) {
        errors.push(new ValidatorError({
          file: file,
          line: 0,
          rule: "critical-path-no-test",
          message: `Critical path file "${file}" has no corresponding test file`,
          ai_hint: `This file is in a critical path (${criticalPaths.find(cp => file.toLowerCase().includes(cp.toLowerCase().replace(/\/$/, "")))}). Create a test file before committing.`,
          severity: "error",
        }));
      }
    }
  } catch {}

  return errors;
}

function findCorrespondingTestFile(cwd, sourceFile) {
  const baseName = sourceFile.replace(/\.\w+$/, "");
  const fileName = baseName.split("/").pop();
  const dirName = baseName.split("/").slice(0, -1).join("/");
  const candidates = [
    `${baseName}.test.ts`,
    `${baseName}.test.js`,
    `${baseName}.spec.ts`,
    `${baseName}.spec.js`,
    `${baseName}.test.tsx`,
    `${baseName}.test.jsx`,
    `tests/${baseName}.test.ts`,
    `tests/${baseName}.test.js`,
    `tests/${baseName}.spec.ts`,
    `tests/${baseName}.spec.js`,
    `test_${fileName}.py`,
    `tests/test_${fileName}.py`,
    `test_${fileName}.go`,
    `${baseName}_test.go`,
    `tests/${fileName}_test.go`,
    `tests/${baseName}.rs`,
    `${baseName}_test.rs`,
    `src/test/${baseName}.rs`,
    `${fileName}Test.java`,
    `test/${fileName}Test.java`,
    `src/test/java/${baseName}Test.java`,
    `Test${fileName}.php`,
    `tests/Test${fileName}.php`,
    `${fileName}_spec.rb`,
    `spec/${baseName}_spec.rb`,
    `${fileName}Tests.swift`,
    `Tests/${fileName}Tests.swift`,
    `${baseName}_test.dart`,
    `test/${baseName}_test.dart`,
    `test/${fileName}_test.dart`,
    `test_${fileName}.cpp`,
    `tests/test_${fileName}.cpp`,
    `${fileName}_test.exs`,
    `test/${fileName}_test.exs`,
    `${fileName}Test.kt`,
    `src/test/kotlin/${baseName}Test.kt`,
  ];

  for (const candidate of candidates) {
    if (existsSync(join(cwd, candidate))) return candidate;
  }

  return null;
}

function detectTestFramework(cwd) {
  if (existsSync(join(cwd, "vitest.config.ts")) || existsSync(join(cwd, "vitest.config.js")) ||
      existsSync(join(cwd, "vite.config.ts")) || existsSync(join(cwd, "vite.config.js"))) {
    return { command: "npx vitest run --reporter verbose 2>&1 || true", parse: parseVitest };
  }
  if (existsSync(join(cwd, "jest.config.js")) || existsSync(join(cwd, "jest.config.ts")) ||
      existsSync(join(cwd, "jest.config.json"))) {
    return { command: "npx jest --verbose 2>&1 || true", parse: parseJest };
  }
  if (existsSync(join(cwd, "pytest.ini")) || existsSync(join(cwd, "pyproject.toml")) ||
      existsSync(join(cwd, "conftest.py"))) {
    return { command: "python -m pytest -v 2>&1 || true", parse: parsePytest };
  }
  if (existsSync(join(cwd, "Cargo.toml"))) {
    return { command: "cargo test 2>&1 || true", parse: parseCargoTest };
  }
  if (existsSync(join(cwd, "go.mod"))) {
    return { command: "go test ./... -v 2>&1 || true", parse: parseGoTest };
  }
  if (existsSync(join(cwd, "pom.xml")) || existsSync(join(cwd, "build.gradle")) || existsSync(join(cwd, "build.gradle.kts"))) {
    return { command: "mvn test -q 2>&1 || true", parse: parseJUnit };
  }
  if (existsSync(join(cwd, "Gemfile")) && (existsSync(join(cwd, "spec")) || existsSync(join(cwd, ".rspec")))) {
    return { command: "bundle exec rspec --format documentation 2>&1 || true", parse: parseRSpec };
  }
  if (existsSync(join(cwd, "composer.json")) && existsSync(join(cwd, "phpunit.xml"))) {
    return { command: "vendor/bin/phpunit --testdox 2>&1 || true", parse: parsePHPUnit };
  }
  if (existsSync(join(cwd, "Package.swift")) && existsSync(join(cwd, "Tests"))) {
    return { command: "swift test 2>&1 || true", parse: parseXCTest };
  }
  if (existsSync(join(cwd, "pubspec.yaml"))) {
    return { command: "flutter test 2>&1 || true", parse: parseFlutterTest };
  }
  if (existsSync(join(cwd, "CMakeLists.txt")) && existsSync(join(cwd, "CTestTestfile.cmake"))) {
    return { command: "ctest --output-on-failure 2>&1 || true", parse: parseGTest };
  }
  if (existsSync(join(cwd, "mix.exs")) && existsSync(join(cwd, "test"))) {
    return { command: "mix test 2>&1 || true", parse: parseExUnit };
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

function parseJUnit(output) {
  const errors = [];
  const failPattern = /Tests run:\s*\d+,\s*Failures:\s*(\d+).*?\[ERROR\]\s+(.+?)\s+-\s+(.+?)\((.+?)\)/gs;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    if (parseInt(match[1]) > 0) {
      errors.push({
        file: match[4] || "", line: 0,
        rule: "junit-failure",
        message: `Teste falhou: ${match[2]} - ${match[3]}`,
        ai_hint: `O teste "${match[2]}" falhou: ${match[3]}. Corrija o código ou o teste.`
      });
    }
  }
  return errors;
}

function parseRSpec(output) {
  const errors = [];
  const failPattern = /Failure:\s+(.+?)\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[2] || "", line: 0,
      rule: "rspec-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste falhou: ${match[1]} em ${match[2]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parsePHPUnit(output) {
  const errors = [];
  const failPattern = /FAILED\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[1] || "", line: 0,
      rule: "phpunit-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste falhou em ${match[1]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parseXCTest(output) {
  const errors = [];
  const failPattern = /(.+?):(\d+):\s+(.+?)\s+\[FAILED\]/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[1], line: parseInt(match[2]),
      rule: "xctest-failure",
      message: `Teste falhou: ${match[3]}`,
      ai_hint: `O teste falhou em ${match[1]}:${match[2]}: ${match[3]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parseFlutterTest(output) {
  const errors = [];
  const failPattern = /\[E\]\s+(.+?):(\d+):\s+(.+)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[1], line: parseInt(match[2]),
      rule: "flutter-test-failure",
      message: `Teste falhou: ${match[3]}`,
      ai_hint: `O teste falhou em ${match[1]}:${match[2]}: ${match[3]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parseGTest(output) {
  const errors = [];
  const failPattern = /\[\s*FAILED\s*\]\s+(.+?)(?:,\s+where\s+.*)?$/gm;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: "", line: 0,
      rule: "gtest-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste "${match[1]}" falhou. Corrija o código ou o teste.`
    });
  }
  return errors;
}

function parseExUnit(output) {
  const errors = [];
  const failPattern = /\s+1\)\s+(.+?)\s+\((.+?)\)/g;
  const matches = [...output.matchAll(failPattern)];
  for (const match of matches) {
    errors.push({
      file: match[2] || "", line: 0,
      rule: "exunit-failure",
      message: `Teste falhou: ${match[1]}`,
      ai_hint: `O teste "${match[1]}" falhou em ${match[2]}. Corrija o código ou o teste.`
    });
  }
  return errors;
}
