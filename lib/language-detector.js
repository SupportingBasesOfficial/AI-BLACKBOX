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

  const extCounts = countExtensions(cwd, 4);
  const tsCount = extCounts.get(".ts") || 0;
  const tsxCount = extCounts.get(".tsx") || 0;
  const jsCount = extCounts.get(".js") || 0;
  const jsxCount = extCounts.get(".jsx") || 0;
  const totalTs = tsCount + tsxCount;
  const totalJs = jsCount + jsxCount;

  if (existsSync(join(cwd, "tsconfig.json")) || totalTs > 0) {
    if (!languages.includes("typescript")) languages.push("typescript");
  }

  if (totalJs > 0 && totalTs === 0) {
    if (!languages.includes("javascript")) languages.push("javascript");
  }

  if (existsSync(join(cwd, "package.json")) && totalTs === 0 && totalJs === 0) {
    if (!languages.includes("javascript")) languages.push("javascript");
  }

  for (const [lang, markers] of Object.entries(LANGUAGE_MARKERS)) {
    if (lang === "typescript" || lang === "javascript") continue;
    for (const marker of markers) {
      if (marker.startsWith(".")) {
        if (hasFilesWithExtension(cwd, marker)) {
          if (!languages.includes(lang)) languages.push(lang);
          break;
        }
      } else if (marker.includes("*")) {
        if (hasFilesMatchingGlob(cwd, marker)) {
          if (!languages.includes(lang)) languages.push(lang);
          break;
        }
      } else {
        if (existsSync(join(cwd, marker))) {
          if (!languages.includes(lang)) languages.push(lang);
          break;
        }
      }
    }
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

function countExtensions(dir, maxDepth, currentDepth = 0) {
  const counts = new Map();
  if (currentDepth > maxDepth) return counts;
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return counts;
  }
  for (const entry of entries) {
    if (entry === "node_modules" || entry === ".git" || entry === "dist" ||
        entry === "build" || entry === ".next" || entry === ".turbo" ||
        entry === ".zero-error" || entry === "coverage" || entry === "target") continue;
    const fullPath = join(dir, entry);
    let stat;
    try { stat = statSync(fullPath); } catch { continue; }
    if (stat.isFile()) {
      const dotIdx = entry.lastIndexOf(".");
      if (dotIdx > 0) {
        const ext = entry.substring(dotIdx).toLowerCase();
        counts.set(ext, (counts.get(ext) || 0) + 1);
      }
    } else if (stat.isDirectory()) {
      const subCounts = countExtensions(fullPath, maxDepth, currentDepth + 1);
      for (const [ext, count] of subCounts) {
        counts.set(ext, (counts.get(ext) || 0) + count);
      }
    }
  }
  return counts;
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
