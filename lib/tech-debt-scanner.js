// lib/tech-debt-scanner.js — Detects invisible technical debt
// Phantom imports, orphan env vars, unused deps, missing @types, uncommitted critical files
// Zero IA calls. Pure RegEx + file system heuristics.

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname, basename, dirname, relative, sep } from "path";
import { isRuntimeEnvVar, isTestFile } from "./classification.js";

const SOURCE_EXTS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
  ".py", ".go", ".rs", ".java", ".cs",
  ".kt", ".kts", ".scala", ".groovy",
  ".rb", ".php", ".swift", ".dart",
  ".c", ".cpp", ".cc", ".h", ".hpp",
  ".ex", ".exs", ".elixir",
]);
const IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", ".gradle", "build", "dist",
  ".next", ".nuxt", ".cache", "__pycache__", ".pytest_cache",
  "target", "bin", "obj", ".vscode", ".idea", ".zero-error",
  "coverage", ".turbo", ".output",
]);

const JS_IMPORT_PATTERNS = [
  /import\s+(?:[\w\s{},*]+\s+from\s+)?["']([^"']+)["']/g,
  /require\s*\(\s*["']([^"']+)["']\s*\)/g,
  /from\s+["']([^"']+)["']\s+import\s+/g,
  // Dynamic import() — captures: import("..."), await import("..."),
  // dynamic(() => import("...")), import.resolve("...")
  /import\s*\(\s*["']([^"']+)["']\s*\)/g,
];

const PY_IMPORT_PATTERNS = [
  /^\s*import\s+([\w.]+)/gm,
  /^\s*from\s+([\w.]+)\s+import/gm,
];

const GO_IMPORT_PATTERNS = [
  /^\s*"([^"]+)"/gm,
  /^\s*import\s+\(([\s\S]*?)\)/gm,
];

const RS_IMPORT_PATTERNS = [
  /^\s*use\s+([\w:]+)/gm,
  /^\s*extern\s+crate\s+(\w+)/gm,
];

const JAVA_IMPORT_PATTERNS = [
  /^\s*import\s+([\w.]+);/gm,
];

const CS_IMPORT_PATTERNS = [
  /^\s*using\s+([\w.]+);/gm,
];

const JS_ENV_PATTERNS = [
  /process\.env\.(\w+)/g,
];

const PY_ENV_PATTERNS = [
  /os\.environ\.get\s*\(\s*["']([\w]+)["']/g,
  /os\.getenv\s*\(\s*["']([\w]+)["']/g,
  /os\.environ\[\s*["']([\w]+)["']/g,
];

const GO_ENV_PATTERNS = [
  /os\.Getenv\s*\(\s*["']([\w]+)["']/g,
  /os\.LookupEnv\s*\(\s*["']([\w]+)["']/g,
];

const RS_ENV_PATTERNS = [
  /std::env::var\s*\(\s*["']([\w]+)["']/g,
  /env::var\s*\(\s*["']([\w]+)["']/g,
];

const JAVA_ENV_PATTERNS = [
  /System\.getenv\s*\(\s*["']([\w]+)["']/g,
  /System\.getProperty\s*\(\s*["']([\w]+)["']/g,
];

const CS_ENV_PATTERNS = [
  /Environment\.GetEnvironmentVariable\s*\(\s*["']([\w]+)["']/g,
];

const KT_IMPORT_PATTERNS = [
  /^\s*import\s+([\w.]+)/gm,
];

const KT_ENV_PATTERNS = [
  /System\.getenv\s*\(\s*["']([\w]+)["']/g,
];

const SCALA_IMPORT_PATTERNS = [
  /^\s*import\s+([\w.]+)/gm,
];

const GROOVY_IMPORT_PATTERNS = [
  /^\s*import\s+([\w.]+)/gm,
];

const RB_IMPORT_PATTERNS = [
  /^\s*require\s+["']([^"']+)["']/gm,
  /^\s*require_relative\s+["']([^"']+)["']/gm,
  /^\s*require\s*\(\s*["']([^"']+)["']/gm,
];

const RB_ENV_PATTERNS = [
  /ENV\[\s*["']([\w]+)["']\s*\]/g,
  /ENV\.fetch\s*\(\s*["']([\w]+)["']/g,
];

const PHP_IMPORT_PATTERNS = [
  /^\s*use\s+([\w\\]+)\s*;/gm,
  /^\s*include\s+["']([^"']+)["']/gm,
  /^\s*require\s+["']([^"']+)["']/gm,
  /^\s*include_once\s+["']([^"']+)["']/gm,
  /^\s*require_once\s+["']([^"']+)["']/gm,
];

const PHP_ENV_PATTERNS = [
  /\$_ENV\[\s*["']([\w]+)["']\s*\]/g,
  /\$_SERVER\[\s*["']([\w]+)["']\s*\]/g,
  /getenv\s*\(\s*["']([\w]+)["']/g,
];

const SWIFT_IMPORT_PATTERNS = [
  /^\s*import\s+([\w.]+)/gm,
];

const SWIFT_ENV_PATTERNS = [
  /ProcessInfo\.processInfo\.environment\[\s*["']([\w]+)["']/g,
];

const DART_IMPORT_PATTERNS = [
  /^\s*import\s+["']([^"']+)["']/gm,
  /^\s*export\s+["']([^"']+)["']/gm,
];

const DART_ENV_PATTERNS = [
  /String\.fromEnvironment\s*\(\s*["']([\w]+)["']/g,
  /Platform\.environment\[\s*["']([\w]+)["']/g,
];

const C_INCLUDE_PATTERNS = [
  /^\s*#include\s+[<"]([^>"]+)[>"]/gm,
];

const C_ENV_PATTERNS = [
  /getenv\s*\(\s*["']([\w]+)["']/g,
];

const EX_IMPORT_PATTERNS = [
  /^\s*defmodule\s+([\w.]+)/gm,
];

const EX_ENV_PATTERNS = [
  /System\.get_env\s*\(\s*["']([\w]+)["']/g,
  /System\.fetch_env!\s*\(\s*["']([\w]+)["']/g,
];

const EXT_TO_LANG = {
  ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".py": "py", ".go": "go", ".rs": "rs", ".java": "java", ".cs": "cs",
  ".kt": "kt", ".kts": "kt", ".scala": "scala", ".groovy": "groovy",
  ".rb": "rb", ".php": "php", ".swift": "swift", ".dart": "dart",
  ".c": "c", ".cpp": "c", ".cc": "c", ".h": "c", ".hpp": "c",
  ".ex": "ex", ".exs": "ex",
};

const ENV_FILE_PATTERNS = [".env", ".env.example", ".env.local", ".env.development", ".env.production", ".env.staging"];

// Runtime env var detection is centralized in lib/classification.js so the
// context-scanner and tech-debt-scanner share one implementation.

const BUILTIN_NODE_MODULES = new Set([
  "fs", "path", "url", "http", "https", "crypto", "os", "child_process",
  "stream", "buffer", "util", "events", "net", "dns", "tls", "zlib",
  "querystring", "readline", "repl", "vm", "worker_threads", "cluster",
  "assert", "timers", "console", "process", "perf_hooks", "async_hooks",
  "inspector", "trace_events", "v8", "node:", "string_decoder", "punycode",
]);

const SCOPED_PKG_RE = /^@([^/]+)\/([^/]+)$/;

const PATH_ALIAS_PREFIXES = ["@/", "~/", "@@/", "#/"];

const INTERNAL_PKG_SCOPES = new Set(["@shared", "@module", "@app", "@core", "@common", "@lib", "@components", "@utils", "@types", "@repo", "@workspace", "@local"]);

const BUILD_TOOL_PACKAGES = new Set([
  "turbo", "typescript", "eslint", "expo", "react-dom",
  "tree-sitter", "tree-sitter-javascript", "tree-sitter-python", "tree-sitter-typescript",
  "ts-node", "tsx", "prettier", "vite", "webpack", "rollup", "esbuild",
  "babel", "jest", "playwright", "cypress", "nyc",
  "ts-node-dev", "nodemon", "concurrently", "cross-env", "rimraf",
  "husky", "lint-staged", "npm-run-all", "npm-check-updates",
  // CI/build tools — not imported in source code, used via CLI/config
  "@changesets/cli", "@commitlint/cli", "@commitlint/config-conventional",
  "@testing-library/user-event", "@vitest/coverage-v8", "jsdom",
  "autoprefixer", "postcss", "tailwindcss",
  "@next/eslint-plugin-next", "@next/bundle-analyzer",
  "eslint-plugin-react-hooks", "@repo/typescript-config",
  "pino-pretty", "node-pg-migrate",
  // Logging/observability — often declared at root but used via @repo/logger
  "pino", "winston", "bunyan", "loglevel",
]);

const BUILD_TOOL_PREFIXES = [
  "eslint-", "@babel/", "@typescript-eslint/", "@vitejs/", "@rollup/",
  "@swc/", "babel-", "jest-", "vitest-",
];

const KNOWN_TYPED_PACKAGES = new Set([
  "zod", "fastify", "next", "expo", "react", "react-native",
  "stripe", "bcryptjs", "jsonwebtoken", "pino", "winston",
  "vitest", "turbo", "typescript", "axios", "dayjs", "date-fns",
  "dotenv", "expo-status-bar", "expo-secure-store", "react-dom",
  "typescript-eslint", "tree-sitter-typescript", "tree-sitter-javascript",
  "tree-sitter-python", "tree-sitter",
  // Modern packages that ship their own TypeScript types
  "hono", "@hono/node-server", "@sentry/node", "argon2", "ioredis",
  "prom-client", "bullmq", "recharts", "next-themes", "sonner",
  "otplib", "swr", "tailwindcss", "postcss", "autoprefixer",
  "@t3-oss/env-nextjs", "@playwright/test", "@next/eslint-plugin-next",
  "@next/bundle-analyzer", "eslint-plugin-react-hooks",
  "@changesets/cli", "@commitlint/cli", "@commitlint/config-conventional",
  "@testing-library/user-event", "@vitest/coverage-v8", "jsdom",
  "node-pg-migrate", "pino-pretty", "@repo/typescript-config",
  "drizzle-orm", "@libsql/client", "better-sqlite3", "pg",
  "class-variance-authority", "clsx", "tailwind-merge",
  "lucide-react", "@radix-ui/react-dialog",
  "echarts", "tailwindcss-animate", "echarts-for-react",
  "redlock", "pino",
]);

const KNOWN_TYPED_PREFIXES = [
  "@fastify/", "@nestjs/", "@supabase/", "@shared/", "@module/",
  "@expo/", "@react-native/", "@testing-library/",
  "@hono/", "@sentry/", "@t3-oss/", "@next/", "@changesets/",
  "@commitlint/", "@vitest/", "@repo/", "@radix-ui/",
  "@playwright/", "@testing-library/",
  "eslint-", "hono-", "drizzle-",
];

export function scanTechDebt(rootDir, scanResult) {
  const allFiles = collectSourceFiles(rootDir);
  const allDeps = collectAllDeclaredDeps(rootDir, scanResult);
  const envDeclaredFiles = collectEnvDeclaredVars(rootDir);

  const importRegistry = new Map();
  const envUsageRegistry = new Map();

  for (const file of allFiles) {
    const content = safeRead(file.absolutePath);
    if (!content) continue;

    const ext = extname(file.absolutePath).toLowerCase();
    const imports = extractImports(content, ext);
    for (const imp of imports) {
      if (!importRegistry.has(imp)) {
        importRegistry.set(imp, []);
      }
      importRegistry.get(imp).push(file.relativePath);
    }

    const envVars = extractEnvVars(content, ext);
    for (const env of envVars) {
      if (isRuntimeEnvVar(env)) continue;
      if (!envUsageRegistry.has(env)) {
        envUsageRegistry.set(env, []);
      }
      envUsageRegistry.get(env).push(file.relativePath);
    }
  }

  const phantomImports = detectPhantomImports(importRegistry, allDeps);
  const orphanEnvVars = detectOrphanEnvVars(envUsageRegistry, envDeclaredFiles);
  const unusedDeps = detectUnusedDeps(allDeps, importRegistry);
  const missingTypes = detectMissingTypes(allDeps, importRegistry, rootDir);
  // Pass orphan env var names to avoid duplicate warnings — an env var
  // already flagged as "orphan" should not also be flagged as "uncommitted
  // critical" (same root cause, different message = confusing duplicate).
  const orphanEnvVarNames = new Set(orphanEnvVars.map(f => f.env_var));
  const uncommittedCritical = detectUncommittedCritical(rootDir, scanResult, orphanEnvVarNames);
  const circularDeps = detectCircularDependencies(allFiles, rootDir);

  const typeIssues = detectTypeIssues(allFiles);
  const unusedExports = detectUnusedExports(allFiles, rootDir);

  const findings = [
    ...phantomImports,
    ...orphanEnvVars,
    ...unusedDeps,
    ...missingTypes,
    ...uncommittedCritical,
    ...circularDeps,
    ...typeIssues,
    ...unusedExports,
  ];

  const criticalCount = findings.filter(f => f.severity === "critical").length;
  const warningCount = findings.filter(f => f.severity === "warning").length;
  const infoCount = findings.filter(f => f.severity === "info").length;

  return {
    summary: {
      total_findings: findings.length,
      critical: criticalCount,
      warnings: warningCount,
      info: infoCount,
      files_scanned: allFiles.length,
      deps_declared: Object.keys(allDeps).length,
      imports_detected: importRegistry.size,
      env_vars_used: envUsageRegistry.size,
    },
    findings: findings.sort((a, b) => {
      const order = { critical: 0, warning: 1, info: 2 };
      if (order[a.severity] !== order[b.severity]) return order[a.severity] - order[b.severity];
      return a.type.localeCompare(b.type);
    }),
  };
}

function collectSourceFiles(rootDir) {
  const results = [];
  function walk(dir, depth) {
    if (depth > 20) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (SOURCE_EXTS.has(ext)) {
          results.push({ absolutePath: fullPath, relativePath: relPath });
        }
      }
    }
  }
  walk(rootDir, 0);
  return results;
}

function safeRead(filePath) {
  try { return readFileSync(filePath, "utf-8"); } catch { return null; }
}

function extractImports(content, ext) {
  const imports = new Set();
  const lang = EXT_TO_LANG[ext] || "js";

  let patterns;
  switch (lang) {
    case "py": patterns = PY_IMPORT_PATTERNS; break;
    case "go": patterns = GO_IMPORT_PATTERNS; break;
    case "rs": patterns = RS_IMPORT_PATTERNS; break;
    case "java": patterns = JAVA_IMPORT_PATTERNS; break;
    case "cs": patterns = CS_IMPORT_PATTERNS; break;
    case "kt": patterns = KT_IMPORT_PATTERNS; break;
    case "scala": patterns = SCALA_IMPORT_PATTERNS; break;
    case "groovy": patterns = GROOVY_IMPORT_PATTERNS; break;
    case "rb": patterns = RB_IMPORT_PATTERNS; break;
    case "php": patterns = PHP_IMPORT_PATTERNS; break;
    case "swift": patterns = SWIFT_IMPORT_PATTERNS; break;
    case "dart": patterns = DART_IMPORT_PATTERNS; break;
    case "c": patterns = C_INCLUDE_PATTERNS; break;
    case "ex": patterns = EX_IMPORT_PATTERNS; break;
    default: patterns = JS_IMPORT_PATTERNS; break;
  }

  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      if (m[1] && !m[1].includes("\n")) {
        imports.add(m[1].trim());
      } else if (m[1] && lang === "go") {
        const blockLines = m[1].split("\n");
        for (const line of blockLines) {
          const lineMatch = line.match(/\s*"([^"]+)"/);
          if (lineMatch) imports.add(lineMatch[1].trim());
        }
      }
    }
  }

  if (lang === "go") {
    const singleImports = content.matchAll(/^\s*import\s+"([^"]+)"/gm);
    for (const m of singleImports) {
      if (m[1]) imports.add(m[1].trim());
    }
  }

  return Array.from(imports);
}

function extractEnvVars(content, ext) {
  const vars = new Set();
  const lang = EXT_TO_LANG[ext] || "js";

  let patterns;
  switch (lang) {
    case "py": patterns = PY_ENV_PATTERNS; break;
    case "go": patterns = GO_ENV_PATTERNS; break;
    case "rs": patterns = RS_ENV_PATTERNS; break;
    case "java": patterns = JAVA_ENV_PATTERNS; break;
    case "cs": patterns = CS_ENV_PATTERNS; break;
    case "kt": patterns = KT_ENV_PATTERNS; break;
    case "scala": patterns = KT_ENV_PATTERNS; break;
    case "groovy": patterns = KT_ENV_PATTERNS; break;
    case "rb": patterns = RB_ENV_PATTERNS; break;
    case "php": patterns = PHP_ENV_PATTERNS; break;
    case "swift": patterns = SWIFT_ENV_PATTERNS; break;
    case "dart": patterns = DART_ENV_PATTERNS; break;
    case "c": patterns = C_ENV_PATTERNS; break;
    case "ex": patterns = EX_ENV_PATTERNS; break;
    default: patterns = JS_ENV_PATTERNS; break;
  }

  for (const pattern of patterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      vars.add(m[1]);
    }
  }
  return Array.from(vars);
}

function collectAllDeclaredDeps(rootDir, scanResult) {
  const allDeps = {};

  function mergePkg(pkgPath) {
    if (!existsSync(pkgPath)) return;
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
      Object.assign(allDeps, pkg.dependencies || {});
      Object.assign(allDeps, pkg.devDependencies || {});
      Object.assign(allDeps, pkg.peerDependencies || {});
      Object.assign(allDeps, pkg.optionalDependencies || {});
    } catch {}
  }

  function mergeRequirements(reqPath) {
    if (!existsSync(reqPath)) return;
    try {
      const content = readFileSync(reqPath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("-")) continue;
        const match = trimmed.match(/^([\w.-]+)/);
        if (match) {
          allDeps[match[1]] = trimmed.includes("==") ? trimmed.split("==")[1] :
                              trimmed.includes(">=") ? trimmed.split(">=")[1] :
                              trimmed.includes("~=") ? trimmed.split("~=")[1] :
                              "latest";
        }
      }
    } catch {}
  }

  function mergeCargo(cargoPath) {
    if (!existsSync(cargoPath)) return;
    try {
      const content = readFileSync(cargoPath, "utf-8");
      const depSection = content.match(/\[dependencies\]([\s\S]*?)(?:\[|$)/);
      if (depSection) {
        for (const line of depSection[1].split("\n")) {
          const match = line.match(/^\s*([\w-]+)\s*=\s*["']([^"']+)["']/);
          if (match) {
            allDeps[match[1]] = match[2];
          } else {
            const match2 = line.match(/^\s*([\w-]+)\s*=\s*\{[^}]*version\s*=\s*["']([^"']+)["']/);
            if (match2) allDeps[match2[1]] = match2[2];
          }
        }
      }
    } catch {}
  }

  function mergeGoMod(goModPath) {
    if (!existsSync(goModPath)) return;
    try {
      const content = readFileSync(goModPath, "utf-8");
      const requireBlock = content.match(/require\s*\(([\s\S]*?)\)/);
      const lines = requireBlock ? requireBlock[1].split("\n") : [];
      for (const line of lines) {
        const match = line.match(/^\s*([^\s]+)\s+([\w.-]+)/);
        if (match && !match[1].startsWith("//")) {
          allDeps[match[1]] = match[2];
        }
      }
      const singleRequire = content.matchAll(/require\s+([^\s]+)\s+([\w.-]+)/g);
      for (const m of singleRequire) {
        allDeps[m[1]] = m[2];
      }
    } catch {}
  }

  function mergePom(pomPath) {
    if (!existsSync(pomPath)) return;
    try {
      const content = readFileSync(pomPath, "utf-8");
      const depMatches = content.matchAll(/<dependency>\s*<groupId>([^<]+)<\/groupId>\s*<artifactId>([^<]+)<\/artifactId>(?:\s*<version>([^<]+)<\/version>)?/g);
      for (const m of depMatches) {
        const key = m[2].includes(":") ? m[2] : `${m[1]}:${m[2]}`;
        allDeps[key] = m[3] || "managed";
      }
    } catch {}
  }

  function mergeGradle(gradlePath) {
    if (!existsSync(gradlePath)) return;
    try {
      const content = readFileSync(gradlePath, "utf-8");
      const implMatches = content.matchAll(/(?:implementation|api|compileOnly|runtimeOnly)\s+['"]([^'":]+):([^'":]+):([^'"]+)['"]/g);
      for (const m of implMatches) {
        allDeps[`${m[1]}:${m[2]}`] = m[3];
      }
    } catch {}
  }

  function mergeGemfile(gemfilePath) {
    if (!existsSync(gemfilePath)) return;
    try {
      const content = readFileSync(gemfilePath, "utf-8");
      const gemMatches = content.matchAll(/^\s*gem\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm);
      for (const m of gemMatches) {
        allDeps[m[1]] = m[2] || "latest";
      }
    } catch {}
  }

  function mergeComposer(composerPath) {
    if (!existsSync(composerPath)) return;
    try {
      const pkg = JSON.parse(readFileSync(composerPath, "utf-8"));
      Object.assign(allDeps, pkg.require || {});
      Object.assign(allDeps, pkg["require-dev"] || {});
    } catch {}
  }

  function mergePubspec(pubspecPath) {
    if (!existsSync(pubspecPath)) return;
    try {
      const content = readFileSync(pubspecPath, "utf-8");
      const depSection = content.match(/dependencies:\s*\n([\s\S]*?)(?:\n\S|$)/);
      if (depSection) {
        for (const line of depSection[1].split("\n")) {
          const match = line.match(/^\s+([\w_]+):\s*\^?([\w.]+)/);
          if (match) allDeps[match[1]] = match[2];
        }
      }
    } catch {}
  }

  function mergeSwiftPackage(pkgPath) {
    if (!existsSync(pkgPath)) return;
    try {
      const content = readFileSync(pkgPath, "utf-8");
      const depMatches = content.matchAll(/\.package\s*\(\s*url:\s*["']([^"']+)["'].*?from:\s*["']([^"']+)["']/g);
      for (const m of depMatches) {
        const name = m[1].split("/").pop().replace(".git", "");
        allDeps[name] = m[2];
      }
    } catch {}
  }

  function mergeCMake(cmakePath) {
    if (!existsSync(cmakePath)) return;
    try {
      const content = readFileSync(cmakePath, "utf-8");
      const depMatches = content.matchAll(/find_package\s*\(\s*(\w+)/g);
      for (const m of depMatches) {
        allDeps[m[1]] = "system";
      }
    } catch {}
  }

  function mergeMixExs(mixPath) {
    if (!existsSync(mixPath)) return;
    try {
      const content = readFileSync(mixPath, "utf-8");
      const depMatches = content.matchAll(/\{\s*:([\w_]+),\s*["']([^"']+)["']/g);
      for (const m of depMatches) {
        allDeps[m[1]] = m[2];
      }
    } catch {}
  }

  function mergePyproject(tomlPath) {
    if (!existsSync(tomlPath)) return;
    try {
      const content = readFileSync(tomlPath, "utf-8");
      const depSection = content.match(/\[project\][\s\S]*?dependencies\s*=\s*\[([\s\S]*?)\]/);
      if (depSection) {
        for (const line of depSection[1].split("\n")) {
          const match = line.match(/["']([\w.-]+)(?:[<>=!~][^"']*)?["']/);
          if (match) allDeps[match[1]] = "latest";
        }
      }
      const poetrySection = content.match(/\[tool\.poetry\.dependencies\]([\s\S]*?)(?:\[|$)/);
      if (poetrySection) {
        for (const line of poetrySection[1].split("\n")) {
          const match = line.match(/^([\w.-]+)\s*=\s*["']?([^"'\n]+)?["']?/);
          if (match && match[1] !== "python") allDeps[match[1]] = match[2] || "latest";
        }
      }
    } catch {}
  }

  function mergeCsproj(csprojPath) {
    if (!existsSync(csprojPath)) return;
    try {
      const content = readFileSync(csprojPath, "utf-8");
      const depMatches = content.matchAll(/<PackageReference\s+Include=["']([^"']+)["']\s+Version=["']([^"']+)["']/g);
      for (const m of depMatches) {
        allDeps[m[1]] = m[2];
      }
    } catch {}
  }

  function scanDepFiles(dir) {
    mergePkg(join(dir, "package.json"));
    mergeRequirements(join(dir, "requirements.txt"));
    mergePyproject(join(dir, "pyproject.toml"));
    mergeCargo(join(dir, "Cargo.toml"));
    mergeGoMod(join(dir, "go.mod"));
    mergePom(join(dir, "pom.xml"));
    mergeGradle(join(dir, "build.gradle"));
    mergeGemfile(join(dir, "Gemfile"));
    mergeComposer(join(dir, "composer.json"));
    mergePubspec(join(dir, "pubspec.yaml"));
    mergeSwiftPackage(join(dir, "Package.swift"));
    mergeCMake(join(dir, "CMakeLists.txt"));
    mergeMixExs(join(dir, "mix.exs"));
    mergeGradle(join(dir, "build.gradle.kts"));
    const csprojFiles = findCsprojFiles(dir);
    for (const csproj of csprojFiles) {
      mergeCsproj(csproj);
    }
  }

  function findCsprojFiles(dir) {
    try {
      return readdirSync(dir)
        .filter(f => f.endsWith(".csproj"))
        .map(f => join(dir, f));
    } catch {
      return [];
    }
  }

  scanDepFiles(rootDir);

  if (scanResult && scanResult.monorepo && scanResult.monorepoPackages) {
    for (const pkgInfo of scanResult.monorepoPackages) {
      scanDepFiles(join(rootDir, pkgInfo.path));
    }
  }

  if (scanResult && scanResult.allScannedFiles) {
    const depFileMap = {
      "package.json": mergePkg,
      "requirements.txt": mergeRequirements,
      "pyproject.toml": mergePyproject,
      "Cargo.toml": mergeCargo,
      "go.mod": mergeGoMod,
      "pom.xml": mergePom,
      "build.gradle": mergeGradle,
      "Gemfile": mergeGemfile,
      "composer.json": mergeComposer,
      "pubspec.yaml": mergePubspec,
      "Package.swift": mergeSwiftPackage,
      "CMakeLists.txt": mergeCMake,
      "mix.exs": mergeMixExs,
      "build.gradle.kts": mergeGradle,
    };
    for (const filePath of scanResult.allScannedFiles) {
      for (const [depFile, merger] of Object.entries(depFileMap)) {
        if (filePath.endsWith("/" + depFile) || filePath === depFile) {
          merger(join(rootDir, filePath));
        }
      }
      if (filePath.endsWith(".csproj")) {
        mergeCsproj(join(rootDir, filePath));
      }
    }
  }

  return allDeps;
}

function collectEnvDeclaredVars(rootDir) {
  const declared = new Set();
  for (const envFile of ENV_FILE_PATTERNS) {
    const envPath = join(rootDir, envFile);
    if (existsSync(envPath)) {
      const content = safeRead(envPath);
      if (content) {
        const lines = content.split("\n");
        for (const line of lines) {
          const match = line.match(/^\s*([\w]+)\s*=/);
          if (match) declared.add(match[1]);
        }
      }
    }
  }
  return declared;
}

const PY_BUILTIN_MODULES = new Set([
  "os", "sys", "json", "re", "time", "datetime", "math", "random",
  "collections", "itertools", "functools", "pathlib", "typing",
  "asyncio", "logging", "unittest", "argparse", "subprocess",
  "threading", "multiprocessing", "io", "csv", "xml", "html",
  "email", "http", "urllib", "socket", "ssl", "hashlib", "hmac",
  "secrets", "sqlite3", "pickle", "shutil", "tempfile", "glob",
  "inspect", "traceback", "warnings", "contextlib", "dataclasses",
  "enum", "abc", "copy", "pprint", "string", "textwrap", "unicodedata",
  "decimal", "fractions", "statistics", "base64", "binascii", "uuid",
  "importlib", "configparser", "toml", "platform", "getpass",
]);

const GO_BUILTIN_PACKAGES = new Set([
  "fmt", "os", "io", "net", "http", "crypto", "encoding", "errors",
  "log", "time", "strings", "strconv", "sort", "sync", "context",
  "database", "sql", "bytes", "bufio", "reflect", "unsafe", "runtime",
  "path", "filepath", "flag", "testing", "math", "rand", "regexp",
  "unicode", "syscall", "signal", "env", "slices", "maps", "cmp",
]);

const RS_BUILTIN_CRATES = new Set([
  "std", "core", "alloc", "proc_macro", "test",
]);

const JAVA_BUILTIN_PACKAGES = new Set([
  "java.lang", "java.util", "java.io", "java.net", "java.nio",
  "java.time", "java.math", "java.sql", "java.security",
  "java.text", "java.util.regex", "java.util.concurrent",
  "java.util.function", "java.util.stream", "java.util.collections",
]);

const KT_BUILTIN_PACKAGES = new Set([
  "kotlin", "kotlin.collections", "kotlin.io", "kotlin.text",
  "kotlin.math", "kotlin.ranges", "kotlin.sequences", "kotlin.comparisons",
  "kotlin.concurrent", "kotlin.properties", "kotlin.reflect",
]);

const RB_BUILTIN_GEMS = new Set([
  "rubygems", "fileutils", "pathname", "json", "yaml", "csv",
  "set", "time", "date", "uri", "net", "open3", "tempfile",
  "logger", "monitor", "singleton", "forwardable", "observer",
  "base64", "digest", "securerandom", "pp", "prettyprint",
  "optparse", "shellwords", "find", "tmpdir", "mutex_m",
]);

const PHP_BUILTIN_MODULES = new Set([
  "PHP", "stdClass", "Exception", "Error", "TypeError", "ValueError",
  "ArrayObject", "SplStack", "SplQueue", "SplObjectStorage",
  "DateTime", "DateTimeImmutable", "DateInterval", "DatePeriod",
  "PDO", "PDOStatement", "ReflectionClass", "ReflectionMethod",
  "Closure", "Generator", "WeakMap", "WeakReference",
]);

const SWIFT_BUILTIN_MODULES = new Set([
  "Swift", "Foundation", "Dispatch", "Combine", "CoreFoundation",
  "XCTest", "Test", "os", "UIKit", "AppKit", "SwiftUI",
  "CoreGraphics", "CoreText", "CoreLocation", "CoreData",
]);

const DART_CORE_LIBRARIES = new Set([
  "dart:core", "dart:async", "dart:collection", "dart:convert",
  "dart:developer", "dart:ffi", "dart:html", "dart:io",
  "dart:isolate", "dart:js", "dart:math", "dart:mirrors",
  "dart:typed_data", "dart:ui",
]);

const C_SYSTEM_HEADERS = new Set([
  "stdio.h", "stdlib.h", "string.h", "math.h", "ctype.h",
  "time.h", "errno.h", "assert.h", "stddef.h", "stdbool.h",
  "stdint.h", "inttypes.h", "limits.h", "float.h", "signal.h",
  "setjmp.h", "locale.h", "stdarg.h", "wchar.h", "wctype.h",
  "complex.h", "fenv.h", "tgmath.h", "iso646.h",
]);

const CXX_SYSTEM_HEADERS = new Set([
  "iostream", "fstream", "sstream", "string", "vector", "list",
  "map", "unordered_map", "set", "unordered_set", "queue", "stack",
  "deque", "array", "memory", "algorithm", "numeric", "functional",
  "iterator", "utility", "tuple", "pair", "chrono", "thread",
  "mutex", "condition_variable", "future", "atomic", "regex",
  "random", "exception", "stdexcept", "type_traits", "typeinfo",
  "cstdint", "cstddef", "cstdlib", "cstdio", "cstring", "cmath",
  "ctime", "cassert", "climits", "cfloat", "cctype", "cwchar",
  "cwctype", "cinttypes", "clocale", "csignal", "csetjmp",
  "optional", "variant", "any", "filesystem", "charconv",
  "format", "span", "ranges", "concepts", "coroutine",
]);

const EX_BUILTIN_MODULES = new Set([
  "Elixir", "Kernel", "Agent", "Application", "Atom", "Base",
  "Behaviour", "Bitwise", "Code", "Collectable", "Enum", "Exception",
  "File", "Float", "Function", "GenServer", "HashDict", "HashSet",
  "IO", "Integer", "Kernel", "Keyword", "List", "Macro", "Map",
  "MapSet", "Module", "Node", "OptionParser", "Path", "Port",
  "Process", "Protocol", "Range", "Record", "Regex", "Registry",
  "Stream", "String", "StringIO", "Supervisor", "System", "Task",
  "Tuple", "URI", "UUID",
]);

function isBuiltinOrRelative(imp) {
  if (imp.startsWith(".") || imp.startsWith("/")) return true;
  if (imp.startsWith("node:")) return true;
  if (BUILTIN_NODE_MODULES.has(imp)) return true;
  if (PATH_ALIAS_PREFIXES.some(p => imp.startsWith(p))) return true;

  if (PY_BUILTIN_MODULES.has(imp) || PY_BUILTIN_MODULES.has(imp.split(".")[0])) return true;
  if (GO_BUILTIN_PACKAGES.has(imp) || (imp.includes("/") && GO_BUILTIN_PACKAGES.has(imp.split("/")[0]))) return true;
  if (RS_BUILTIN_CRATES.has(imp) || imp.startsWith("std::") || imp.startsWith("core::") || imp.startsWith("alloc::")) return true;
  if (JAVA_BUILTIN_PACKAGES.has(imp) || (imp.startsWith("java.") && JAVA_BUILTIN_PACKAGES.has(imp.split(".")[0] + "." + imp.split(".")[1]))) return true;
  if (imp.startsWith("javax.")) return true;
  if (imp.startsWith("org.w3c.") || imp.startsWith("org.xml.")) return true;

  if (imp.startsWith("crate::") || imp.startsWith("self::") || imp.startsWith("super::")) return true;

  if (KT_BUILTIN_PACKAGES.has(imp) || (imp.startsWith("kotlin.") && KT_BUILTIN_PACKAGES.has(imp.split(".")[0] + "." + imp.split(".")[1]))) return true;

  if (RB_BUILTIN_GEMS.has(imp)) return true;

  if (PHP_BUILTIN_MODULES.has(imp)) return true;

  if (SWIFT_BUILTIN_MODULES.has(imp)) return true;

  if (DART_CORE_LIBRARIES.has(imp) || imp.startsWith("dart:")) return true;

  if (C_SYSTEM_HEADERS.has(imp) || CXX_SYSTEM_HEADERS.has(imp)) return true;
  if (imp.startsWith("bits/") || imp.startsWith("sys/") || imp.startsWith("arpa/") || imp.startsWith("net/") || imp.startsWith("netinet/") || imp.startsWith("linux/")) return true;

  if (EX_BUILTIN_MODULES.has(imp) || imp.startsWith("Elixir.")) return true;

  return false;
}

function normalizePkgName(imp) {
  if (imp.startsWith("@")) {
    const m = imp.match(/^(@[^/]+\/[^/]+)/);
    return m ? m[1] : imp;
  }

  if (imp.includes(".") && !imp.includes("/") && !imp.includes("::")) {
    return imp.split(".")[0];
  }

  if (imp.includes("::")) {
    return imp.split("::")[0];
  }

  if (imp.includes("/")) {
    const parts = imp.split("/");
    if (parts.length >= 2 && parts[0].includes(".")) {
      return `${parts[0]}/${parts[1]}`;
    }
    return parts[0];
  }

  return imp;
}

function detectPhantomImports(importRegistry, allDeps) {
  const findings = [];
  const depNames = new Set(Object.keys(allDeps));
  const checked = new Set();

  for (const [imp, files] of importRegistry) {
    if (isBuiltinOrRelative(imp)) continue;

    const pkgName = normalizePkgName(imp);
    if (checked.has(pkgName)) continue;
    checked.add(pkgName);

    if (!depNames.has(pkgName)) {
      const isScoped = pkgName.startsWith("@");
      const isTypePkg = pkgName.startsWith("@types/");
      const severity = isTypePkg ? "info" : (isScoped ? "warning" : "critical");

      findings.push({
        type: "phantom_import",
        severity: severity,
        package: pkgName,
        import_statement: imp,
        used_in_files: files.slice(0, 5),
        total_files: files.length,
        message: `Package "${pkgName}" is imported in ${files.length} file(s) but not declared in any dependency file`,
        recommendation: `Add "${pkgName}" to the appropriate dependency file (package.json, requirements.txt, Cargo.toml, go.mod, pom.xml, Gemfile, composer.json, pubspec.yaml, mix.exs, etc.), or remove the import if unused`,
      });
    }
  }

  return findings;
}

function detectOrphanEnvVars(envUsageRegistry, envDeclaredVars) {
  const findings = [];

  for (const [envVar, files] of envUsageRegistry) {
    if (isRuntimeEnvVar(envVar)) continue;

    if (envDeclaredVars.size > 0 && !envDeclaredVars.has(envVar)) {
      findings.push({
        type: "orphan_env_var",
        severity: "warning",
        env_var: envVar,
        used_in_files: files.slice(0, 5),
        total_files: files.length,
        message: `Environment variable "${envVar}" is referenced in ${files.length} file(s) but not declared in any .env file`,
        recommendation: `Add "${envVar}=<value>" to .env.example and .env, or remove the reference if unused`,
      });
    }

    if (envDeclaredVars.size === 0 && files.length > 0) {
      findings.push({
        type: "missing_env_file",
        severity: "info",
        env_var: envVar,
        used_in_files: files.slice(0, 3),
        total_files: files.length,
        message: `No .env files found but ${envUsageRegistry.size} env vars are referenced in code`,
        recommendation: `Create .env.example with all referenced environment variables`,
      });
      break;
    }
  }

  return findings;
}

function detectUnusedDeps(allDeps, importRegistry) {
  const findings = [];
  const importedPkgs = new Set();

  for (const imp of importRegistry.keys()) {
    if (isBuiltinOrRelative(imp)) continue;
    importedPkgs.add(normalizePkgName(imp));
  }

  for (const depName of Object.keys(allDeps)) {
    if (importedPkgs.has(depName)) continue;

    if (depName.startsWith("@types/")) continue;
    if (BUILD_TOOL_PACKAGES.has(depName)) continue;
    if (BUILD_TOOL_PREFIXES.some(p => depName.startsWith(p))) continue;
    if (INTERNAL_PKG_SCOPES.has(depName.split("/")[0]) && depName.includes("/")) continue;

    const baseName = depName.replace(/^@[^/]+\//, "");
    let found = false;
    for (const imported of importedPkgs) {
      if (imported === depName) { found = true; break; }
      const importedBase = imported.replace(/^@[^/]+\//, "");
      if (importedBase === baseName) { found = true; break; }
    }
    if (found) continue;

    findings.push({
      type: "unused_dependency",
      severity: "info",
      package: depName,
      version: allDeps[depName],
      message: `Dependency "${depName}" is declared in a dependency file but never imported in source code`,
      recommendation: `Remove "${depName}" from the dependency file or add the missing import`,
    });
  }

  return findings;
}

function detectMissingTypes(allDeps, importRegistry, rootDir) {
  const findings = [];
  const depNames = new Set(Object.keys(allDeps));
  const typePkgs = new Set();

  for (const dep of depNames) {
    if (dep.startsWith("@types/")) {
      typePkgs.add(dep.replace("@types/", ""));
    }
  }

  const jsDeps = new Set();
  for (const dep of depNames) {
    if (!dep.includes(":") && !dep.startsWith("github.com/") && !dep.startsWith("golang.org/") && !dep.startsWith("crates.io")) {
      jsDeps.add(dep);
    }
  }

  for (const [imp] of importRegistry) {
    if (isBuiltinOrRelative(imp)) continue;
    const pkgName = normalizePkgName(imp);
    if (!depNames.has(pkgName)) continue;

    if (!jsDeps.has(pkgName)) continue;

    if (!pkgName.startsWith("@types/") && !typePkgs.has(pkgName)) {
      const hasOwnTypes = checkPkgHasTypes(pkgName, allDeps, rootDir);
      if (!hasOwnTypes) {
        findings.push({
          type: "missing_types",
          severity: "info",
          package: pkgName,
          message: `Package "${pkgName}" is imported but has no @types/${pkgName} and may lack bundled types`,
          recommendation: `Install "@types/${pkgName}" as devDependency or verify the package ships its own .d.ts files`,
        });
      }
    }
  }

  return deduplicateByField(findings, "package");
}

function checkPkgHasTypes(pkgName, allDeps, rootDir) {
  if (KNOWN_TYPED_PACKAGES.has(pkgName)) return true;
  if (KNOWN_TYPED_PREFIXES.some(p => pkgName.startsWith(p))) return true;
  const scope = pkgName.split("/")[0];
  if (INTERNAL_PKG_SCOPES.has(scope)) return true;

  // Check if the package ships its own types by reading its package.json
  // from node_modules. Modern packages declare types via "types",
  // "typings", or "exports" with type conditions. If any of these exist,
  // the package does NOT need @types/.
  if (rootDir) {
    const pkgJsonPath = join(rootDir, "node_modules", pkgName, "package.json");
    if (existsSync(pkgJsonPath)) {
      try {
        const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
        if (pkg.types || pkg.typings) return true;
        // Check exports field for type conditions
        if (pkg.exports) {
          if (typeof pkg.exports === "string") return true;
          if (typeof pkg.exports === "object") {
            for (const key of Object.keys(pkg.exports)) {
              const exp = pkg.exports[key];
              if (typeof exp === "string") return true;
              if (typeof exp === "object") {
                if (exp.types || exp["./types"] || exp.default) return true;
              }
            }
          }
        }
      } catch {}
    }
  }

  return false;
}

function detectUncommittedCritical(rootDir, scanResult, alreadyFlaggedOrphans) {
  const findings = [];
  const alreadyFlagged = alreadyFlaggedOrphans || new Set();

  // Only flag env vars that ARE actually referenced in the project's code.
  // The previous implementation flagged generic names (DB_URL, JWT_SECRET,
  // etc.) that the project doesn't use — producing 14 completely invented
  // warnings. Now we only check env vars from scanResult.envVars (actually
  // detected in source files) that match critical patterns.
  const envVarsUsed = scanResult ? scanResult.envVars : [];

  // Patterns that indicate a critical/secret env var — matched against
  // env vars that ARE actually used in the code.
  const CRITICAL_ENV_PATTERNS = [
    /DATABASE_URL/i, /DB_PASSWORD/i, /DB_USER/i,
    /REDIS_URL/i, /SECRET/i, /JWT_/i, /API_KEY/i, /PRIVATE_KEY/i,
    /AWS_ACCESS/i, /AWS_SECRET/i,
    /ENCRYPTION_KEY/i, /LDAP_BIND_PASSWORD/i,
    /GOOGLE_OAUTH/i, /DOCS_PASSWORD/i,
  ];

  for (const envVar of envVarsUsed) {
    if (isRuntimeEnvVar(envVar)) continue;
    const isCritical = CRITICAL_ENV_PATTERNS.some(p => p.test(envVar));
    if (!isCritical) continue;

    // Skip env vars already flagged as orphan — reporting them twice with
    // different messages (orphan + uncommitted) is confusing duplication.
    if (alreadyFlagged.has(envVar)) continue;

    // Check if this env var is declared in any .env file. If it IS declared
    // in .env.example, the file is likely committed and this is not a warning.
    // If it's NOT in .env.example, it's an orphan (already flagged by
    // detectOrphanEnvVars) — don't double-report it here.
    const envDeclaredFiles = collectEnvDeclaredVars(rootDir);
    if (envDeclaredFiles.has(envVar)) continue;

    // Find files that reference this env var to report as related.
    const relatedFiles = findFilesReferencingEnvVar(rootDir, envVar);

    findings.push({
      type: "uncommitted_critical_file",
      severity: "warning",
      env_var: envVar,
      related_files: relatedFiles.slice(0, 3),
      message: `Critical env var "${envVar}" is referenced in code but not declared in .env.example — it may be uncommitted or missing`,
      recommendation: `Add "${envVar}=<value>" to .env.example and ensure the referencing file is committed`,
    });
  }

  return deduplicateByField(findings, "env_var");
}

function findFilesReferencingEnvVar(rootDir, envVar) {
  const results = [];
  function walk(dir, depth) {
    if (depth > 15 || results.length >= 10) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase();
        if (!SOURCE_EXTS.has(ext)) continue;
        const content = safeRead(fullPath);
        if (content && content.includes(envVar)) {
          results.push(relPath);
        }
      }
    }
  }
  walk(rootDir, 0);
  return results;
}

function findFilesWithPattern(rootDir, pattern) {
  const results = [];
  function walk(dir, depth) {
    if (depth > 15 || results.length >= 10) return;
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (IGNORE_DIRS.has(entry.name)) continue;
      if (entry.name.startsWith(".") && entry.name !== ".env") continue;
      const fullPath = join(dir, entry.name);
      const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        walk(fullPath, depth + 1);
      } else if (entry.isFile() && pattern.test(entry.name)) {
        results.push(relPath);
      }
    }
  }
  walk(rootDir, 0);
  return results;
}

function deduplicateByField(items, field) {
  const seen = new Set();
  return items.filter(item => {
    const key = item[field];
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Circular dependency detection — builds a file→file import graph and runs
// DFS cycle detection. Reports actual cycles, not just "might have cycles".
// ---------------------------------------------------------------------------

function resolveImportPath(importPath, fromFileRelPath, allFilePaths) {
  // Only resolve relative imports (./ or ../) — third-party imports can't
  // create cycles within the project.
  if (!importPath.startsWith(".")) return null;

  const fromDir = fromFileRelPath.includes("/")
    ? fromFileRelPath.substring(0, fromFileRelPath.lastIndexOf("/"))
    : "";
  const resolved = normalizeRelativePath(fromDir + "/" + importPath);

  // Try matching with common extensions and /index
  for (const ext of ["", ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"]) {
    if (allFilePaths.has(resolved + ext)) return resolved + ext;
  }
  for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
    if (allFilePaths.has(resolved + "/index" + ext)) return resolved + "/index" + ext;
  }
  return null;
}

function normalizeRelativePath(p) {
  const parts = p.split("/");
  const resolved = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

function detectCircularDependencies(allFiles, rootDir) {
  const findings = [];

  // Build set of all file relative paths for quick lookup
  const allFilePaths = new Set(allFiles.map(f => f.relativePath));

  // Build adjacency list: file → [imported file paths]
  const graph = new Map();

  for (const file of allFiles) {
    const content = safeRead(file.absolutePath);
    if (!content) continue;
    const ext = extname(file.absolutePath).toLowerCase();
    const imports = extractImports(content, ext);

    const resolvedImports = [];
    for (const imp of imports) {
      const resolved = resolveImportPath(imp, file.relativePath, allFilePaths);
      if (resolved && resolved !== file.relativePath) {
        resolvedImports.push(resolved);
      }
    }
    if (resolvedImports.length > 0) {
      graph.set(file.relativePath, resolvedImports);
    }
  }

  // DFS cycle detection with colors: white=unvisited, gray=in-stack, black=done
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map();
  const parent = new Map();
  const cycles = [];

  function dfs(node) {
    color.set(node, GRAY);
    const neighbors = graph.get(node) || [];
    for (const neighbor of neighbors) {
      if (!color.has(neighbor)) color.set(neighbor, WHITE);
      const c = color.get(neighbor);
      if (c === GRAY) {
        // Found a cycle — reconstruct it
        const cycle = [neighbor];
        let curr = node;
        while (curr && curr !== neighbor) {
          cycle.unshift(curr);
          curr = parent.get(curr);
        }
        cycle.unshift(neighbor);
        cycles.push(cycle);
      } else if (c === WHITE) {
        parent.set(neighbor, node);
        dfs(neighbor);
      }
    }
    color.set(node, BLACK);
  }

  for (const node of graph.keys()) {
    if (!color.has(node) || color.get(node) === WHITE) {
      dfs(node);
    }
  }

  // Deduplicate cycles by normalizing (rotate to start with smallest element)
  const seenCycles = new Set();
  for (const cycle of cycles) {
    // Normalize: find the smallest element and rotate
    const minIdx = cycle.reduce((minI, val, i) => val < cycle[minI] ? i : minI, 0);
    const normalized = [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)];
    const key = normalized.join(" → ");
    if (seenCycles.has(key)) continue;
    seenCycles.add(key);

    findings.push({
      type: "circular_dependency",
      severity: "warning",
      cycle: normalized,
      message: `Circular dependency detected: ${normalized.join(" → ")}`,
      recommendation: "Break the cycle by extracting shared logic into a separate module, or use dependency inversion (interface in a common package)",
    });
  }

  // Limit to top 20 cycles to avoid flooding the report
  return findings.slice(0, 20);
}

// ---------------------------------------------------------------------------
// File complexity analysis — LOC and cyclomatic complexity estimation.
// ---------------------------------------------------------------------------

export function analyzeFileComplexity(filePath) {
  const content = safeRead(filePath);
  if (!content) return null;

  const lines = content.split("\n");
  let loc = 0;
  let totalLines = lines.length;

  for (const line of lines) {
    const trimmed = line.trim();
    // Skip blank lines and comment-only lines
    if (!trimmed) continue;
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) continue;
    if (trimmed.startsWith("#") && !trimmed.includes("#include")) continue;
    loc++;
  }

  // Cyclomatic complexity estimation: count branching keywords
  // This is an approximation — real CC requires AST parsing. But counting
  // branching constructs gives a useful relative complexity metric.
  const branchPatterns = [
    /\bif\s*\(/g, /\belse\s*\{/g, /\belse\s+if\s*\(/g,
    /\bfor\s*\(/g, /\bfor\s+of\s/g, /\bfor\s+in\s/g, /\bwhile\s*\(/g,
    /\bdo\s*\{/g, /\bswitch\s*\(/g, /\bcase\s+/g, /\bcatch\s*\(/g,
    /\?\s*[^?]+\s*:/g, // ternary
    /&&/g, /\|\|/g, // logical operators add paths
    /\bawait\s+/g, // async adds implicit branching (success/error)
  ];

  let complexity = 1; // Base path
  for (const pattern of branchPatterns) {
    const re = new RegExp(pattern.source, pattern.flags);
    let m;
    while ((m = re.exec(content)) !== null) {
      complexity++;
    }
  }

  return {
    loc,
    total_lines: totalLines,
    cyclomatic_complexity: complexity,
    complexity_label: complexity <= 5 ? "low" : complexity <= 10 ? "medium" : complexity <= 20 ? "high" : "very-high",
  };
}

// ---------------------------------------------------------------------------
// Type issues detection — finds `any` types and missing return type annotations
// in TypeScript files. These are real code quality issues, not style preferences.
// ---------------------------------------------------------------------------

function detectTypeIssues(allFiles) {
  const findings = [];
  const tsFiles = allFiles.filter(f => {
    const ext = extname(f.absolutePath).toLowerCase();
    return ext === ".ts" || ext === ".tsx";
  });

  // Patterns that indicate `any` type usage
  const ANY_TYPE_PATTERNS = [
    // : any (explicit any annotation)
    /:\s*any\b/g,
    // <any> (type assertion)
    /<any>/g,
    // as any (type assertion to any)
    /\bas\s+any\b/g,
    // Array<any>, Promise<any>, etc.
    /\b(?:Array|Promise|Record|Map|Set)<any>/g,
  ];

  // Pattern for function without return type: function foo(...) { or export function foo(...) {
  // We look for functions that don't have : ReturnType before the {
  const FUNC_NO_RETURN_RE = /(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*\([^)]*\)\s*\{/g;
  // Arrow functions without return type: const foo = (...) => {
  const ARROW_NO_RETURN_RE = /(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s*)?\([^)]*\)\s*=>\s*\{/g;

  const anyTypeCount = new Map(); // file → count
  const missingReturnFiles = new Map(); // file → [function names]

  for (const file of tsFiles) {
    const content = safeRead(file.absolutePath);
    if (!content) continue;

    // Count `any` types
    let anyCount = 0;
    for (const pattern of ANY_TYPE_PATTERNS) {
      const re = new RegExp(pattern.source, pattern.flags);
      while (re.exec(content) !== null) anyCount++;
    }
    if (anyCount > 0) {
      anyTypeCount.set(file.relativePath, anyCount);
    }

    // Find functions without return type
    // A function has a return type if there's `: Type` between params and `{`
    const missingReturns = [];
    let m;

    // Check named functions
    FUNC_NO_RETURN_RE.lastIndex = 0;
    while ((m = FUNC_NO_RETURN_RE.exec(content)) !== null) {
      // Check if there's a return type annotation between ) and {
      const afterParams = content.substring(m.index + m[0].length - 1);
      const closingParen = content.lastIndexOf(")", m.index + m[0].length);
      const betweenParensAndBrace = content.substring(closingParen + 1, m.index + m[0].length - 1);
      if (!betweenParensAndBrace.includes(":")) {
        missingReturns.push(m[1]);
      }
    }

    // Check arrow functions
    ARROW_NO_RETURN_RE.lastIndex = 0;
    while ((m = ARROW_NO_RETURN_RE.exec(content)) !== null) {
      const closingParen = content.lastIndexOf(")", m.index + m[0].length);
      const betweenParensAndArrow = content.substring(closingParen + 1, m.index + m[0].length);
      if (!betweenParensAndArrow.includes(":")) {
        missingReturns.push(m[1]);
      }
    }

    if (missingReturns.length > 0) {
      missingReturnFiles.set(file.relativePath, missingReturns);
    }
  }

  // Report `any` types — only files with 3+ occurrences (avoid noise)
  for (const [file, count] of anyTypeCount) {
    if (count < 3) continue;
    findings.push({
      type: "any_type_usage",
      severity: "warning",
      file,
      any_count: count,
      message: `${count} \`any\` type usages in ${file}`,
      recommendation: "Replace `any` with specific types. Use `unknown` if the type is truly unknown, then narrow with type guards.",
    });
  }

  // Report missing return types — only files with 3+ missing
  for (const [file, funcs] of missingReturnFiles) {
    if (funcs.length < 3) continue;
    findings.push({
      type: "missing_return_type",
      severity: "info",
      file,
      function_count: funcs.length,
      message: `${funcs.length} functions without return type annotation in ${file}`,
      recommendation: "Add explicit return type annotations to exported functions for better type safety and IDE support.",
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Path alias resolution — reads tsconfig.json compilerOptions.paths to resolve
// aliases like @/components/* → apps/web/components/* or src/components/*
// ---------------------------------------------------------------------------

function loadPathAliases(rootDir) {
  const aliases = new Map(); // alias prefix (e.g. "@/*") → base path (e.g. "src")

  // Try tsconfig.json at root
  const tsconfigPaths = [
    join(rootDir, "tsconfig.json"),
    join(rootDir, "apps", "web", "tsconfig.json"),
    join(rootDir, "apps", "api", "tsconfig.json"),
  ];

  for (const tsconfigPath of tsconfigPaths) {
    if (!existsSync(tsconfigPath)) continue;
    try {
      const content = readFileSync(tsconfigPath, "utf-8");
      // Strip JSON comments (tsconfig allows comments)
      const clean = content.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      const config = JSON.parse(clean);
      const paths = config?.compilerOptions?.paths;
      const baseUrl = config?.compilerOptions?.baseUrl || ".";
      if (!paths) continue;
      for (const [alias, targets] of Object.entries(paths)) {
        if (!Array.isArray(targets) || targets.length === 0) continue;
        // Take the first target — most common case
        const target = targets[0].replace(/\*$/, "");
        const aliasPrefix = alias.replace(/\*$/, "");
        // Resolve relative to baseUrl
        const fullBase = join(rootDir, baseUrl, target).replace(/\\/g, "/").replace(/\/+$/, "");
        aliases.set(aliasPrefix, fullBase);
      }
    } catch {
      // Invalid JSON or missing fields — skip
    }
  }

  return aliases;
}

// Resolve a relative import (./foo, ../bar) to a full project path
function resolveRelativeImport(imp, fromPath) {
  if (!imp.startsWith(".")) return null;
  const fromDir = fromPath.includes("/") ? fromPath.substring(0, fromPath.lastIndexOf("/")) : "";
  const parts = (fromDir + "/" + imp).split("/");
  const resolved = [];
  for (const p of parts) {
    if (p === "" || p === ".") continue;
    if (p === "..") resolved.pop();
    else resolved.push(p);
  }
  return resolved.join("/").replace(/\.(ts|js|tsx|jsx)$/, "");
}

// Resolve an alias import (@/components/foo) using loaded path aliases
function resolveAliasImport(imp, aliases, fromPath) {
  // Try to find a matching alias prefix
  for (const [prefix, basePath] of aliases) {
    if (imp.startsWith(prefix)) {
      const subPath = imp.substring(prefix.length);
      // Join basePath with subPath
      const fullParts = (basePath + "/" + subPath).split("/");
      const resolved = [];
      for (const p of fullParts) {
        if (p === "" || p === ".") continue;
        if (p === "..") resolved.pop();
        else resolved.push(p);
      }
      return resolved.join("/").replace(/\.(ts|js|tsx|jsx)$/, "");
    }
  }
  // Fallback: @/ typically maps to src/ — try resolving against src/ in fromPath
  if (imp.startsWith("@/")) {
    const subPath = imp.substring(2);
    const fromParts = fromPath.split("/");
    const srcIdx = fromParts.indexOf("src");
    if (srcIdx >= 0) {
      const baseDir = fromParts.slice(0, srcIdx + 1).join("/");
      const parts = (baseDir + "/" + subPath).split("/");
      const resolved = [];
      for (const p of parts) {
        if (p === "" || p === ".") continue;
        if (p === "..") resolved.pop();
        else resolved.push(p);
      }
      return resolved.join("/").replace(/\.(ts|js|tsx|jsx)$/, "");
    }
    // Also try without src/ — @/ might map to root
    return subPath.replace(/\.(ts|js|tsx|jsx)$/, "");
  }
  return null;
}

// ---------------------------------------------------------------------------
// Unused exports detection — finds exported symbols that are never imported
// by any other file in the project. These are dead code.
// ---------------------------------------------------------------------------

function detectUnusedExports(allFiles, rootDir) {
  const findings = [];

  // --- Load tsconfig.json path aliases ---
  // This is critical for resolving @/ imports that map to real file paths.
  // Without this, any file imported via @/ would be falsely flagged as unused.
  const pathAliases = loadPathAliases(rootDir);

  // --- Collect all imports across all files ---
  // We store both base names AND resolved full paths for robust matching.
  const importedBases = new Set();
  const importedPaths = new Set();

  for (const file of allFiles) {
    const content = safeRead(file.absolutePath);
    if (!content) continue;
    const ext = extname(file.absolutePath).toLowerCase();
    const imports = extractImports(content, ext);
    for (const imp of imports) {
      // Relative imports — extract base name
      if (imp.startsWith(".")) {
        const base = imp.split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
        if (base && base !== "index") importedBases.add(base);
        // Also resolve to full path
        const resolved = resolveRelativeImport(imp, file.relativePath);
        if (resolved) importedPaths.add(resolved);
      }
      // @repo/* / @app/* imports — extract subpath base
      else if (imp.startsWith("@repo/") || imp.startsWith("@app/") || imp.startsWith("@lib/")) {
        const parts = imp.split("/");
        if (parts.length > 2) {
          const subPath = parts.slice(2).join("/").replace(/\.(ts|js|tsx|jsx)$/, "");
          const base = subPath.split("/").pop();
          if (base && base !== "index") importedBases.add(base);
        }
        // Also add full import string for matching
        importedBases.add(imp.replace(/\.(ts|js|tsx|jsx)$/, ""));
      }
      // @/ path alias — resolve using tsconfig paths
      else if (imp.startsWith("@/") || pathAliases.has(imp.split("/")[0] + "/")) {
        const resolved = resolveAliasImport(imp, pathAliases, file.relativePath);
        if (resolved) {
          const base = resolved.split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
          if (base && base !== "index") importedBases.add(base);
          importedPaths.add(resolved.replace(/\.(ts|js|tsx|jsx)$/, ""));
        }
      }
    }
  }

  // --- Next.js convention files — auto-discovered by the framework ---
  // These are never explicitly imported but are used by Next.js routing.
  const NEXTJS_CONVENTION_FILES = new Set([
    "loading", "error", "global-error", "not-found", "robots", "sitemap",
    "template", "default", "opengraph-image", "twitter-image", "icon",
    "apple-icon", "manifest", "favicon",
    // instrumentation.ts — Next.js convention for OpenTelemetry setup
    "instrumentation",
    // middleware.ts — already handled separately but include for safety
    "middleware",
  ]);

  // --- Config files — not imported by application code ---
  const CONFIG_FILE_PATTERNS = [
    /\.config\.(js|ts|mjs|cjs)$/,
    /eslint\.config\./,
    /vitest\.config\./,
    /jest\.config\./,
    /vite\.config\./,
    /next\.config\./,
    /tailwind\.config\./,
    /postcss\.config\./,
    /prettier\.config\./,
    /tsconfig\.json$/,
    /\.d\.ts$/,
    // ESLint flat config helper files (e.g. eslint-node.js, eslint-base.js)
    /eslint[\w-]*\.(js|ts|mjs|cjs)$/,
    // Vitest setup files
    /vitest\.(setup|globals)\./,
    // Babel config
    /babel\.config\./,
    /\.babelrc/,
  ];

  function isConfigFile(path) {
    return CONFIG_FILE_PATTERNS.some(re => re.test(path));
  }

  function isNextjsConvention(base, path) {
    // Only treat as convention if in app/ directory (Next.js App Router)
    // Path may or may not have a leading /
    if (!path.includes("/app/") && !path.startsWith("app/")) return false;
    return NEXTJS_CONVENTION_FILES.has(base);
  }

  // --- CLI scripts — executed directly, not imported ---
  // Detected by: shebang (#!/usr/bin/env node), scripts/ directory, or
  // common CLI script naming patterns (migrate, gen-*, stress-test, etc.)
  function isCliScript(base, path, content) {
    // Shebang check — definitive indicator of a CLI script
    if (content && content.startsWith("#!")) return true;
    // In scripts/ or bin/ directory
    if (/(?:^|\/)(scripts?|bin|cli)\//i.test(path)) return true;
    // Common CLI script names that are run directly
    const CLI_SCRIPT_NAMES = new Set([
      "migrate", "gen-api", "gen-component", "gen-page", "gen-route",
      "gen-model", "gen-service", "stress-test", "seed", "setup",
      "init-db", "create-migration", "deploy", "build-schema",
    ]);
    if (CLI_SCRIPT_NAMES.has(base)) return true;
    // gen-*.mjs pattern (scaffold generators)
    if (/^gen-.*\.(mjs|js|ts)$/.test(base)) return true;
    return false;
  }

  // --- Collect all exported file base names ---
  // Also track re-exports: if index.ts imports and re-exports a file,
  // that file is "used" even if no other file imports it directly.
  const reExportedBases = new Set(); // base names re-exported by index files

  const exportedFiles = new Map(); // base name → file path
  for (const file of allFiles) {
    const base = file.relativePath.split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
    if (base === "index" || base === "route" || base === "page" || base === "layout") continue;
    // Skip test files
    if (isTestFile(file.relativePath)) continue;
    // Skip config files
    if (isConfigFile(file.relativePath)) continue;
    // Skip Next.js convention files
    if (isNextjsConvention(base, file.relativePath)) continue;
    // Skip middleware
    if (file.relativePath.endsWith("middleware.ts") || file.relativePath.endsWith("middleware.js")) continue;

    const content = safeRead(file.absolutePath);
    if (!content) continue;
    // Only check files that have exports
    if (!/\bexport\s+/.test(content)) continue;

    // Skip CLI scripts (shebang, scripts/ dir, or known CLI names)
    if (isCliScript(base, file.relativePath, content)) continue;

    if (!exportedFiles.has(base)) {
      exportedFiles.set(base, file.relativePath);
    }
  }

  // --- Track re-exports from index.ts files ---
  // If index.ts does `export { x } from './circuit-breaker'` or
  // `export * from './circuit-breaker'`, then circuit-breaker is used
  // via re-export even if no other file imports it directly.
  for (const file of allFiles) {
    const base = file.relativePath.split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
    if (base !== "index") continue;
    const content = safeRead(file.absolutePath);
    if (!content) continue;
    // Match: export { ... } from './file' and export * from './file'
    const REEXPORT_RE = /export\s+(?:\*\s*(?:as\s+\w+\s+)?|\{[^}]+\})\s+from\s+["'](\.[^"']+)["']/g;
    let m;
    REEXPORT_RE.lastIndex = 0;
    while ((m = REEXPORT_RE.exec(content)) !== null) {
      const reExportedBase = m[1].split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
      if (reExportedBase && reExportedBase !== "index") {
        reExportedBases.add(reExportedBase);
      }
    }
  }

  // --- Find exported files that are never imported ---
  const unused = [];
  for (const [base, path] of exportedFiles) {
    // Check base name in imports
    if (importedBases.has(base)) continue;
    // Check full path in imports
    const pathWithoutExt = path.replace(/\.(ts|js|tsx|jsx)$/, "");
    if (importedPaths.has(pathWithoutExt)) continue;
    // Check if re-exported by an index.ts file
    if (reExportedBases.has(base)) continue;

    // Check if the file is an entry point (in routes/, app/api/, etc.)
    if (/(?:^|\/)(routes?|app\/api|controllers?)\//i.test(path)) continue;
    unused.push({ base, path });
  }

  // Limit to 20 to avoid flooding
  for (const { base, path } of unused.slice(0, 20)) {
    findings.push({
      type: "unused_export",
      severity: "info",
      file: path,
      message: `Exported file \`${base}\` (${path}) is never imported by any other file`,
      recommendation: "Remove the file if it's dead code, or add an import if it should be used.",
    });
  }

  return findings;
}

export function generateTechDebtReport(scanResult) {
  const lines = [];
  lines.push("# Tech Debt Report — AI Black Box Deep Audit");
  lines.push("");
  lines.push("> Auto-generated by tech-debt-scanner.js. Zero IA calls.");
  lines.push("");

  lines.push("## Summary");
  lines.push("");
  lines.push(`- **Total findings**: ${scanResult.summary.total_findings}`);
  lines.push(`- **Critical**: ${scanResult.summary.critical}`);
  lines.push(`- **Warnings**: ${scanResult.summary.warnings}`);
  lines.push(`- **Info**: ${scanResult.summary.info}`);
  lines.push(`- **Files scanned**: ${scanResult.summary.files_scanned}`);
  lines.push(`- **Dependencies declared**: ${scanResult.summary.deps_declared}`);
  lines.push(`- **Imports detected**: ${scanResult.summary.imports_detected}`);
  lines.push(`- **Env vars used**: ${scanResult.summary.env_vars_used}`);
  lines.push("");

  if (scanResult.findings.length === 0) {
    lines.push("## No technical debt detected. Project is clean.");
    lines.push("");
    return lines.join("\n");
  }

  const grouped = {};
  for (const f of scanResult.findings) {
    if (!grouped[f.type]) grouped[f.type] = [];
    grouped[f.type].push(f);
  }

  const typeLabels = {
    phantom_import: "Phantom Imports (imported but not in any dependency file)",
    orphan_env_var: "Orphan Environment Variables (used but not in .env)",
    unused_dependency: "Unused Dependencies (declared but never imported)",
    missing_types: "Missing Type Definitions (no @types/ package — JS/TS only)",
    uncommitted_critical_file: "Uncommitted Critical Files (env var not detected — file may be missing)",
    missing_env_file: "Missing .env File",
    circular_dependency: "Circular Dependencies (import cycles between modules)",
    any_type_usage: "Any Type Usage (explicit `any` — type safety bypass)",
    missing_return_type: "Missing Return Types (functions without return type annotation)",
    unused_export: "Unused Exports (exported files never imported — dead code)",
  };

  for (const [type, items] of Object.entries(grouped)) {
    lines.push(`## ${typeLabels[type] || type}`);
    lines.push("");

    for (const item of items) {
      const icon = item.severity === "critical" ? "CRITICAL" : item.severity === "warning" ? "WARNING" : "INFO";
      const title = item.package || item.env_var || item.type ||
        (item.cycle ? item.cycle.join(" → ") : "Unknown");
      lines.push(`### [${icon}] ${title}`);
      lines.push(`- ${item.message}`);
      lines.push(`- **Recommendation**: ${item.recommendation}`);
      if (item.used_in_files && item.used_in_files.length > 0) {
        lines.push(`- **Used in**: ${item.used_in_files.join(", ")}${item.total_files > item.used_in_files.length ? ` (+${item.total_files - item.used_in_files.length} more)` : ""}`);
      }
      if (item.version) {
        lines.push(`- **Version**: ${item.version}`);
      }
      lines.push("");
    }
  }

  // --- Feature Flags section ---
  if (scanResult.featureFlags && scanResult.featureFlags.length > 0) {
    lines.push("## Feature Flags Detected");
    lines.push("");
    lines.push("> Feature flags control runtime behavior. Review for stale flags that can be removed.");
    lines.push("");
    if (scanResult.featureFlagProviders && scanResult.featureFlagProviders.length > 0) {
      lines.push(`**Providers**: ${scanResult.featureFlagProviders.join(", ")}`);
      lines.push("");
    }
    for (const flag of scanResult.featureFlags) {
      lines.push(`### \`${flag.name}\``);
      lines.push(`- **Provider**: ${flag.provider}`);
      if (flag.files && flag.files.length > 0) {
        lines.push(`- **Used in**: ${flag.files.slice(0, 5).map(f => `\`${f}\``).join(", ")}${flag.files.length > 5 ? ` (+${flag.files.length - 5} more)` : ""}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}
