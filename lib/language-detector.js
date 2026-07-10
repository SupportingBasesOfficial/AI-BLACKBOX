// lib/language-detector.js — Detects project languages

import { existsSync, readFileSync, readdirSync, statSync } from "fs";
import { join } from "path";

const LANGUAGE_MARKERS = {
  typescript: ["tsconfig.json"],
  javascript: ["package.json", ".js", ".mjs"],
  python: ["pyproject.toml", "setup.py", "requirements.txt", "Pipfile"],
  rust: ["Cargo.toml"],
  go: ["go.mod"],
  java: ["pom.xml", "build.gradle", "build.gradle.kts"],
  csharp: ["*.csproj", "*.sln"],
};

export function detectLanguages(cwd = process.cwd()) {
  const languages = [];

  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
    for (const marker of markers) {
      if (marker.startsWith(".")) {
        // Extensão: verifica se existe qualquer arquivo com essa extensão
        if (hasFilesWithExtension(cwd, marker)) {
          if (!languages.includes(lang)) languages.push(lang);
          break;
        }
      } else if (marker.includes("*")) {
        // Glob pattern
        if (hasFilesMatchingGlob(cwd, marker)) {
          if (!languages.includes(lang)) languages.push(lang);
          break;
        }
      } else {
        // Arquivo específico
        if (existsSync(join(cwd, marker))) {
          if (!languages.includes(lang)) languages.push(lang);
          break;
        }
      }
    }
  }

  // Se TypeScript detectado, remove JavaScript (TS é superset)
  if (languages.includes("typescript") && languages.includes("javascript")) {
    languages = languages.filter(l => l !== "javascript");
  }

  if (languages.length === 0) {
    languages.push("unknown");
  }

  return languages;
}

function hasFilesWithExtension(cwd, ext) {
  try {
    return checkDirForExt(cwd, ext, 2);
  } catch {
    return false;
  }
}

function checkDirForExt(dir, ext, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return false;
  const entries = readdirSync(dir);
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" || entry === "build") continue;
    const fullPath = join(dir, entry);
    const stat = statSync(fullPath);
    if (stat.isFile() && entry.endsWith(ext)) return true;
    if (stat.isDirectory() && checkDirForExt(fullPath, ext, maxDepth, currentDepth + 1)) return true;
  }
  return false;
}

function hasFilesMatchingGlob(cwd, pattern) {
  // Simplified: just check for csproj/sln
  if (pattern === "*.csproj" || pattern === "*.sln") {
    return checkDirForExt(cwd, ".csproj", 2) || checkDirForExt(cwd, ".sln", 2);
  }
  return false;
}

export const LANGUAGE_TOOLS = {
  typescript: { typeCheck: "tsc", lint: "eslint", test: "vitest", propertyTest: "fast-check", mutation: "stryker" },
  javascript: { typeCheck: null, lint: "eslint", test: "vitest", propertyTest: "fast-check", mutation: "stryker" },
  python: { typeCheck: "mypy", lint: "ruff", test: "pytest", propertyTest: "hypothesis", mutation: "mutmut" },
  rust: { typeCheck: "rustc", lint: "clippy", test: "cargo test", propertyTest: "proptest", mutation: "cargo-mutants" },
  go: { typeCheck: "go vet", lint: "golangci-lint", test: "go test", propertyTest: "gopter", mutation: "gremlins" },
  java: { typeCheck: "javac", lint: "checkstyle", test: "junit", propertyTest: "jqwik", mutation: "pit" },
  csharp: { typeCheck: "dotnet build", lint: "roslyn", test: "xunit", propertyTest: "fscheck", mutation: "stryker-net" },
};
