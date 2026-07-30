// validators/mutation-test.js — Runs mutation testing if available

import { existsSync, readFileSync, readdirSync } from "fs";
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
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
    if (pkg.devDependencies?.["@stryker-mutator/core"] || pkg.dependencies?.["@stryker-mutator/core"]) {
      const mutateFlag = pkg.stryker?.mutate ? `--mutate "${pkg.stryker.mutate}"` : "";
      return {
        command: `npx stryker run ${mutateFlag} 2>&1 || true`,
        parse: parseStryker
      };
    }
  } catch {}

  if (existsSync(join(cwd, "setup.cfg")) || existsSync(join(cwd, "mutmut_config.py")) ||
      (existsSync(join(cwd, "pyproject.toml")) && readFileSync(join(cwd, "pyproject.toml"), "utf-8").includes("mutmut"))) {
    return { command: "mutmut run 2>&1 || true", parse: parseMutmut };
  }

  if (existsSync(join(cwd, "Cargo.toml"))) {
    try {
      execSync("cargo mutants --version 2>/dev/null", { encoding: "utf-8", timeout: 5000 });
      return { command: "cargo mutants 2>&1 || true", parse: parseCargoMutants };
    } catch {}
  }

  if (existsSync(join(cwd, "go.mod"))) {
    try {
      execSync("gremlins --version 2>/dev/null", { encoding: "utf-8", timeout: 5000 });
      return { command: "gremlins unleash 2>&1 || true", parse: parseGremlins };
    } catch {}
  }

  if (existsSync(join(cwd, "pom.xml"))) {
    try {
      const pom = readFileSync(join(cwd, "pom.xml"), "utf-8");
      if (pom.includes("pitest") || pom.includes("org.pitest")) {
        return { command: "mvn org.pitest:pitest-maven:mutationCoverage -q 2>&1 || true", parse: parsePIT };
      }
    } catch {}
  }

  if (existsSync(join(cwd, "Gemfile"))) {
    try {
      const gemfile = readFileSync(join(cwd, "Gemfile"), "utf-8");
      if (gemfile.includes("mutant")) {
        return { command: "bundle exec mutant run 2>&1 || true", parse: parseMutant };
      }
    } catch {}
  }

  if (existsSync(join(cwd, "composer.json"))) {
    try {
      const composer = JSON.parse(readFileSync(join(cwd, "composer.json"), "utf-8"));
      if (composer.require?.["infection/infection"] || composer["require-dev"]?.["infection/infection"]) {
        return { command: "vendor/bin/infection --no-progress 2>&1 || true", parse: parseInfection };
      }
    } catch {}
  }

  if (existsSync(join(cwd, ".csproj")) || fileExistsWithExt(cwd, ".csproj")) {
    try {
      execSync("dotnet stryker --version 2>/dev/null", { encoding: "utf-8", timeout: 5000 });
      return { command: "dotnet stryker 2>&1 || true", parse: parseStryker };
    } catch {}
  }

  if (existsSync(join(cwd, "build.sbt")) || existsSync(join(cwd, "build.gradle.kts"))) {
    try {
      const buildFile = existsSync(join(cwd, "build.sbt")) ? readFileSync(join(cwd, "build.sbt"), "utf-8") : readFileSync(join(cwd, "build.gradle.kts"), "utf-8");
      if (buildFile.includes("stryker4s")) {
        return { command: "stryker4s 2>&1 || true", parse: parseStryker };
      }
    } catch {}
  }

  return null;
}

function fileExistsWithExt(cwd, ext) {
  try {
    return readdirSync(cwd).some(f => f.endsWith(ext));
  } catch {
    return false;
  }
}

function parseGremlins(output) {
  const survivedMatch = output.match(/(\d+)\s+mutants\s+(?:survived|escaped)/i);
  const killedMatch = output.match(/(\d+)\s+mutants\s+killed/i);
  const survived = parseInt(survivedMatch?.[1] || 0);
  const killed = parseInt(killedMatch?.[1] || 0);
  const total = survived + killed;
  const score = total > 0 ? Math.round((killed / total) * 100) : undefined;
  return {
    score,
    survived: survived > 0 ? [{ mutator: "gremlins", file: "", line: 0 }] : []
  };
}

function parsePIT(output) {
  const scoreMatch = output.match(/mutation coverage\s*:\s*(\d+(?:\.\d+)?)%/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : undefined;
  const survivedMatch = output.match(/(\d+)\s+SURVIVED/i);
  const survived = parseInt(survivedMatch?.[1] || 0);
  return {
    score,
    survived: survived > 0 ? [{ mutator: "pit", file: "", line: 0 }] : []
  };
}

function parseMutant(output) {
  const survivedMatch = output.match(/(\d+)\s+alive/i);
  const killedMatch = output.match(/(\d+)\s+killed/i);
  const survived = parseInt(survivedMatch?.[1] || 0);
  const killed = parseInt(killedMatch?.[1] || 0);
  const total = survived + killed;
  const score = total > 0 ? Math.round((killed / total) * 100) : undefined;
  return {
    score,
    survived: survived > 0 ? [{ mutator: "mutant", file: "", line: 0 }] : []
  };
}

function parseInfection(output) {
  const scoreMatch = output.match(/mutation score indicator:\s*(\d+(?:\.\d+)?)\s*%/i);
  const score = scoreMatch ? parseFloat(scoreMatch[1]) : undefined;
  const survivedMatch = output.match(/(\d+)\s+escaped/i);
  const survived = parseInt(survivedMatch?.[1] || 0);
  return {
    score,
    survived: survived > 0 ? [{ mutator: "infection", file: "", line: 0 }] : []
  };
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
