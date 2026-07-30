// lib/tech-debt-scanner.js — Detects invisible technical debt
// Phantom imports, orphan env vars, unused deps, missing @types, uncommitted critical files
// Zero IA calls. Pure RegEx + file system heuristics.

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname, basename, dirname, relative, sep } from "path";

const SOURCE_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".go", ".rs", ".java", ".cs"]);
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

const EXT_TO_LANG = {
  ".ts": "js", ".tsx": "js", ".js": "js", ".jsx": "js", ".mjs": "js", ".cjs": "js",
  ".py": "py", ".go": "go", ".rs": "rs", ".java": "java", ".cs": "cs",
};

const ENV_FILE_PATTERNS = [".env", ".env.example", ".env.local", ".env.development", ".env.production", ".env.staging"];

const BUILTIN_NODE_MODULES = new Set([
  "fs", "path", "url", "http", "https", "crypto", "os", "child_process",
  "stream", "buffer", "util", "events", "net", "dns", "tls", "zlib",
  "querystring", "readline", "repl", "vm", "worker_threads", "cluster",
  "assert", "timers", "console", "process", "perf_hooks", "async_hooks",
  "inspector", "trace_events", "v8", "node:", "string_decoder", "punycode",
]);

const SCOPED_PKG_RE = /^@([^/]+)\/([^/]+)$/;

const PATH_ALIAS_PREFIXES = ["@/", "~/", "@@/", "#/"];

const INTERNAL_PKG_SCOPES = new Set(["@shared", "@module", "@app", "@core", "@common", "@lib", "@components", "@utils", "@types"]);

const BUILD_TOOL_PACKAGES = new Set([
  "turbo", "typescript", "eslint", "expo", "react-dom",
  "tree-sitter", "tree-sitter-javascript", "tree-sitter-python", "tree-sitter-typescript",
  "ts-node", "tsx", "prettier", "vite", "webpack", "rollup", "esbuild",
  "babel", "jest", "playwright", "cypress", "nyc",
  "ts-node-dev", "nodemon", "concurrently", "cross-env", "rimraf",
  "husky", "lint-staged", "npm-run-all", "npm-check-updates",
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
]);

const KNOWN_TYPED_PREFIXES = [
  "@fastify/", "@nestjs/", "@supabase/", "@shared/", "@module/",
  "@expo/", "@react-native/", "@testing-library/",
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
      if (!envUsageRegistry.has(env)) {
        envUsageRegistry.set(env, []);
      }
      envUsageRegistry.get(env).push(file.relativePath);
    }
  }

  const phantomImports = detectPhantomImports(importRegistry, allDeps);
  const orphanEnvVars = detectOrphanEnvVars(envUsageRegistry, envDeclaredFiles);
  const unusedDeps = detectUnusedDeps(allDeps, importRegistry);
  const missingTypes = detectMissingTypes(allDeps, importRegistry);
  const uncommittedCritical = detectUncommittedCritical(rootDir, scanResult);

  const findings = [
    ...phantomImports,
    ...orphanEnvVars,
    ...unusedDeps,
    ...missingTypes,
    ...uncommittedCritical,
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

  function scanDepFiles(dir) {
    mergePkg(join(dir, "package.json"));
    mergeRequirements(join(dir, "requirements.txt"));
    mergeCargo(join(dir, "Cargo.toml"));
    mergeGoMod(join(dir, "go.mod"));
    mergePom(join(dir, "pom.xml"));
    mergeGradle(join(dir, "build.gradle"));
  }

  scanDepFiles(rootDir);

  if (scanResult && scanResult.monorepo && scanResult.monorepoPackages) {
    for (const pkgInfo of scanResult.monorepoPackages) {
      scanDepFiles(join(rootDir, pkgInfo.path));
    }
  }

  if (scanResult && scanResult.allScannedFiles) {
    for (const filePath of scanResult.allScannedFiles) {
      const depFiles = ["package.json", "requirements.txt", "Cargo.toml", "go.mod", "pom.xml", "build.gradle"];
      for (const depFile of depFiles) {
        if (filePath.endsWith("/" + depFile) || filePath === depFile) {
          const fullPath = join(rootDir, filePath);
          if (depFile === "package.json") mergePkg(fullPath);
          else if (depFile === "requirements.txt") mergeRequirements(fullPath);
          else if (depFile === "Cargo.toml") mergeCargo(fullPath);
          else if (depFile === "go.mod") mergeGoMod(fullPath);
          else if (depFile === "pom.xml") mergePom(fullPath);
          else if (depFile === "build.gradle") mergeGradle(fullPath);
        }
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
        message: `Package "${pkgName}" is imported in ${files.length} file(s) but not declared in any package.json`,
        recommendation: `Add "${pkgName}" to dependencies in the appropriate package.json, or remove the import if unused`,
      });
    }
  }

  return findings;
}

function detectOrphanEnvVars(envUsageRegistry, envDeclaredVars) {
  const findings = [];

  for (const [envVar, files] of envUsageRegistry) {
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
      message: `Dependency "${depName}" is declared in package.json but never imported in source code`,
      recommendation: `Remove "${depName}" from package.json or add the missing import`,
    });
  }

  return findings;
}

function detectMissingTypes(allDeps, importRegistry) {
  const findings = [];
  const depNames = new Set(Object.keys(allDeps));
  const typePkgs = new Set();

  for (const dep of depNames) {
    if (dep.startsWith("@types/")) {
      typePkgs.add(dep.replace("@types/", ""));
    }
  }

  for (const [imp] of importRegistry) {
    if (isBuiltinOrRelative(imp)) continue;
    const pkgName = normalizePkgName(imp);
    if (!depNames.has(pkgName)) continue;

    if (!pkgName.startsWith("@types/") && !typePkgs.has(pkgName)) {
      const hasOwnTypes = checkPkgHasTypes(pkgName, allDeps);
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

function checkPkgHasTypes(pkgName, allDeps) {
  if (KNOWN_TYPED_PACKAGES.has(pkgName)) return true;
  if (KNOWN_TYPED_PREFIXES.some(p => pkgName.startsWith(p))) return true;
  const scope = pkgName.split("/")[0];
  if (INTERNAL_PKG_SCOPES.has(scope)) return true;
  return false;
}

function detectUncommittedCritical(rootDir, scanResult) {
  const findings = [];

  const criticalEnvVars = ["DATABASE_URL", "DB_URL", "DB_HOST", "DB_PASSWORD", "DB_USER"];
  const envVarsUsed = scanResult ? scanResult.envVars : [];

  for (const criticalVar of criticalEnvVars) {
    if (!envVarsUsed.includes(criticalVar)) {
      const dbFiles = findFilesWithPattern(rootDir, /database|db\.client|db\.connection|pool/i);
      if (dbFiles.length > 0) {
        findings.push({
          type: "uncommitted_critical_file",
          severity: "warning",
          env_var: criticalVar,
          related_files: dbFiles.slice(0, 3),
          message: `Critical env var "${criticalVar}" not detected in scan — the file that references it may be uncommitted or missing`,
          recommendation: `Ensure the file referencing "${criticalVar}" is committed to the repository`,
        });
      }
    }
  }

  return deduplicateByField(findings, "env_var");
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
    phantom_import: "Phantom Imports (imported but not in package.json)",
    orphan_env_var: "Orphan Environment Variables (used but not in .env)",
    unused_dependency: "Unused Dependencies (declared but never imported)",
    missing_types: "Missing Type Definitions (no @types/ package)",
    uncommitted_critical_file: "Uncommitted Critical Files (env var not detected — file may be missing)",
    missing_env_file: "Missing .env File",
  };

  for (const [type, items] of Object.entries(grouped)) {
    lines.push(`## ${typeLabels[type] || type}`);
    lines.push("");

    for (const item of items) {
      const icon = item.severity === "critical" ? "CRITICAL" : item.severity === "warning" ? "WARNING" : "INFO";
      lines.push(`### [${icon}] ${item.package || item.env_var || item.type}`);
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

  return lines.join("\n");
}
