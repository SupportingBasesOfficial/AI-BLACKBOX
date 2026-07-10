// validators/mutation-test.js — Runs mutation testing if available

import { existsSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "mutation-test";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();
  const threshold = config.mutationThreshold || 80;

  const framework = detectMutationFramework(cwd);
  if (!framework) {
    return new ValidatorResult({
      passed: true,
      warnings: [{ rule: "no-mutation-testing", message: "Nenhum framework de mutation testing detectado." }],
      duration_ms: Date.now() - startTime
    });
  }

  try {
    const output = execSync(framework.command, {
      cwd, encoding: "utf-8",
      timeout: (config.timeout || 600) * 1000,
      stdio: ["pipe", "pipe", "pipe"]
    }).toString();

    const result = framework.parse(output);
    if (result.score !== undefined && result.score < threshold) {
      errors.push(new ValidatorError({
        file: "", rule: "mutation-score-low",
        message: `Mutation score ${result.score}% abaixo do threshold ${threshold}%`,
        ai_hint: `Mutation score ${result.score}% está abaixo do mínimo ${threshold}%. Os testes não detectam mutações suficientes. Adicione testes para cobrir os casos de mutação que sobreviveram.`,
        severity: "error"
      }));
    }
    for (const survived of result.survived || []) {
      errors.push(new ValidatorError({
        file: survived.file, line: survived.line || 0,
        rule: "mutant-survived",
        message: `Mutante sobreviveu: ${survived.mutator}`,
        ai_hint: `Um mutante (${survived.mutator}) sobreviveu em ${survived.file}:${survived.line}. Adicione um teste que detecte esta mutação.`,
        severity: "warning"
      }));
    }
  } catch (err) {
    const output = (err.stdout || "").toString() + (err.stderr || "").toString();
    if (output && framework.parse) {
      const result = framework.parse(output);
      if (result.score !== undefined && result.score < threshold) {
        errors.push(new ValidatorError({
          file: "", rule: "mutation-score-low",
          message: `Mutation score ${result.score}% abaixo do threshold ${threshold}%`,
          ai_hint: `Mutation score ${result.score}% está abaixo do mínimo ${threshold}%. Adicione testes para cobrir mutações sobreviventes.`,
          severity: "error"
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

function detectMutationFramework(cwd) {
  // Stryker (JS/TS)
  try {
    const pkg = JSON.parse(require("fs").readFileSync(join(cwd, "package.json"), "utf-8"));
    if (pkg.devDependencies?.["@stryker-mutator/core"] || pkg.dependencies?.["@stryker-mutator/core"]) {
      const mutateFlag = pkg.stryker?.mutate ? `--mutate "${pkg.stryker.mutate}"` : "";
      return {
        command: `npx stryker run ${mutateFlag} 2>&1 || true`,
        parse: parseStryker
      };
    }
  } catch {}

  // mutmut (Python)
  if (existsSync(join(cwd, "setup.cfg")) || existsSync(join(cwd, "mutmut_config.py"))) {
    return { command: "mutmut run 2>&1 || true", parse: parseMutmut };
  }

  // cargo-mutants (Rust)
  if (existsSync(join(cwd, "Cargo.toml"))) {
    try {
      execSync("cargo mutants --version 2>/dev/null", { encoding: "utf-8", timeout: 5000 });
      return { command: "cargo mutants 2>&1 || true", parse: parseCargoMutants };
    } catch {}
  }

  return null;
}

function parseStryker(output) {
  const scoreMatch = output.match(/Mutation score(?:.*?):\s*(\d+(?:\.\d+)?)%/);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : undefined;

  const survived = [];
  const survivedPattern = /Survived \[(.+?)\]\s+(.+?):(\d+)/g;
  const matches = [...output.matchAll(survivedPattern)];
  for (const match of matches) {
    survived.push({
      mutator: match[1],
      file: match[2],
      line: parseInt(match[3])
    });
  }

  return { score, survived };
}

function parseMutmut(output) {
  const survivedMatch = output.match(/survived:\s*(\d+)/);
  const killedMatch = output.match(/killed:\s*(\d+)/);
  const survived = parseInt(survivedMatch?.[1] || 0);
  const killed = parseInt(killedMatch?.[1] || 0);
  const total = survived + killed;
  const score = total > 0 ? Math.round((killed / total) * 100) : undefined;

  return {
    score,
    survived: survived > 0 ? [{ mutator: "unknown", file: "", line: 0 }] : []
  };
}

function parseCargoMutants(output) {
  const survivedMatch = output.match(/(\d+) mutants survived/);
  const killedMatch = output.match(/(\d+) mutants killed/);
  const survived = parseInt(survivedMatch?.[1] || 0);
  const killed = parseInt(killedMatch?.[1] || 0);
  const total = survived + killed;
  const score = total > 0 ? Math.round((killed / total) * 100) : undefined;

  return {
    score,
    survived: survived > 0 ? [{ mutator: "unknown", file: "", line: 0 }] : []
  };
}
