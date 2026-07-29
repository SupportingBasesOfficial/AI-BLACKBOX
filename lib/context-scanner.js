// lib/context-scanner.js — Deep project scanner: schemas, routes, models, components
// Zero IA calls. RegEx + file system heuristics only.

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname, basename, relative, sep } from "path";

const SCAN_IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", ".gradle", "build", "dist",
  ".next", ".nuxt", ".cache", "__pycache__", ".pytest_cache",
  "target", "bin", "obj", ".vscode", ".idea", ".zero-error",
  "coverage", ".turbo", ".output",
]);

const SCAN_IGNORE_EXTS = new Set([
  ".log", ".lock", ".sum", ".md5", ".sha256", ".map",
  ".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".ico",
  ".svg", ".ttf", ".woff", ".woff2", ".eot", ".mp4", ".mp3",
  ".zip", ".tar", ".gz", ".rar", ".7z", ".pdf", ".doc", ".docx",
]);

const SCHEMA_PATTERNS = [
  { pattern: /schema\.prisma$/i, type: "prisma", extractor: extractPrismaModels },
  { pattern: /migrations?\/.*\.sql$/i, type: "sql_migration", extractor: extractSqlTables },
  { pattern: /models\/.*\.(py|js|ts)$/i, type: "orm_model", extractor: extractOrmModels },
  { pattern: /\.proto$/i, type: "grpc_proto", extractor: extractProtoMessages },
  { pattern: /openapi\.(json|yaml|yml)$/i, type: "openapi", extractor: extractOpenApiPaths },
  { pattern: /swagger\.(json|yaml|yml)$/i, type: "openapi", extractor: extractOpenApiPaths },
];

const ROUTE_PATTERNS = [
  { regex: /(?:app|router)\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)/g, framework: "express" },
  { regex: /@Get\s*\(\s*['"`]([^'"`]+)/g, framework: "nestjs" },
  { regex: /@Post\s*\(\s*['"`]([^'"`]+)/g, framework: "nestjs" },
  { regex: /@Put\s*\(\s*['"`]([^'"`]+)/g, framework: "nestjs" },
  { regex: /@Delete\s*\(\s*['"`]([^'"`]+)/g, framework: "nestjs" },
  { regex: /router\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)/g, framework: "koa" },
  { regex: /@app\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g, framework: "fastapi" },
  { regex: /def\s+(get|post|put|delete)_\w+\s*\(/g, framework: "django" },
  { regex: /func\s+\w+\s*\(\s*\w+\s+\*fiber\.Ctx\s*\)/g, framework: "gofiber" },
  { regex: /http\.HandleFunc\s*\(\s*['"`]([^'"`]+)/g, framework: "gonethttp" },
];

const COMPONENT_PATTERNS = [
  { regex: /export\s+(default\s+)?function\s+(\w+)/g, type: "react_function" },
  { regex: /export\s+(default\s+)?class\s+(\w+)\s+extends\s+(React\.Component|Component)/g, type: "react_class" },
  { regex: /defineComponent\s*\(\s*\{/g, type: "vue_define" },
  { regex: /export\s+default\s+\{/g, type: "vue_sfc" },
  { regex: /@Component\s*\(/g, type: "angular_component" },
  { regex: /export\s+class\s+(\w+)\s+implements\s+OnInit/g, type: "angular_class" },
];

const ENV_PATTERNS = [
  /process\.env\.(\w+)/g,
  /os\.environ\.get\s*\(\s*['"`]([^'"`]+)/g,
  /os\.getenv\s*\(\s*['"`]([^'"`]+)/g,
  /System\.getenv\s*\(\s*['"`]([^'"`]+)/g,
  /\$\{?(\w+)_DIR\}?/g,
];

const CRITICAL_PATH_KEYWORDS = [
  "auth", "payment", "billing", "user", "transaction", "security",
  "checkout", "invoice", "charge", "refund", "password", "token",
  "session", "permission", "role", "admin",
];

const MONOREPO_MARKERS = [
  "pnpm-workspace.yaml", "turbo.json", "lerna.json", "nx.json",
  "rush.json", "package-workspace.yaml",
];

export function scanProject(rootDir) {
  const files = collectFiles(rootDir, rootDir, 0, 15);
  const schemas = [];
  const routes = [];
  const components = [];
  const models = [];
  const envVars = new Set();
  const criticalPaths = [];
  const monorepo = detectMonorepo(rootDir);
  const monorepoPackages = monorepo ? detectPackages(rootDir) : [];

  for (const file of files) {
    const content = safeRead(file.absolutePath);
    if (!content) continue;

    const ext = extname(file.relativePath).toLowerCase();
    if (SCAN_IGNORE_EXTS.has(ext)) continue;

    const schemaMatch = matchSchema(file.relativePath);
    if (schemaMatch) {
      const extracted = schemaMatch.extractor(content, file.relativePath);
      schemas.push(...extracted);
    }

    const routeMatches = matchRoutes(content);
    if (routeMatches.length > 0) {
      routes.push({
        file: file.relativePath,
        endpoints: routeMatches,
      });
    }

    const componentMatches = matchComponents(content);
    if (componentMatches.length > 0) {
      components.push({
        file: file.relativePath,
        components: componentMatches,
      });
    }

    const modelMatches = matchModels(content, ext);
    if (modelMatches.length > 0) {
      models.push({
        file: file.relativePath,
        models: modelMatches,
      });
    }

    const envMatches = matchEnvVars(content);
    for (const env of envMatches) {
      envVars.add(env);
    }

    const pathLower = file.relativePath.toLowerCase();
    for (const keyword of CRITICAL_PATH_KEYWORDS) {
      if (pathLower.includes(keyword) && !criticalPaths.includes(keyword)) {
        const dirPath = file.relativePath.split(sep).slice(0, -1).join(sep) + sep;
        const criticalPath = dirPath.includes(keyword) ? dirPath : file.relativePath;
        if (!criticalPaths.some(cp => cp.path === criticalPath)) {
          criticalPaths.push({ path: criticalPath, keyword });
        }
      }
    }
  }

  return {
    monorepo,
    monorepoPackages,
    schemas,
    routes,
    components,
    models,
    envVars: Array.from(envVars).sort(),
    criticalPaths: criticalPaths.sort((a, b) => a.keyword.localeCompare(b.keyword)),
    totalFiles: files.length,
  };
}

function collectFiles(rootDir, currentDir, depth, maxDepth) {
  if (depth > maxDepth) return [];

  let results = [];
  let entries = [];

  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;
    if (SCAN_IGNORE_DIRS.has(entry.name)) continue;

    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      results = results.concat(collectFiles(rootDir, fullPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!SCAN_IGNORE_EXTS.has(ext)) {
        results.push({ absolutePath: fullPath, relativePath: relPath });
      }
    }
  }

  return results;
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function matchSchema(filePath) {
  for (const { pattern, type, extractor } of SCHEMA_PATTERNS) {
    if (pattern.test(filePath)) {
      return { type, extractor };
    }
  }
  return null;
}

function matchRoutes(content) {
  const matches = [];
  for (const { regex, framework } of ROUTE_PATTERNS) {
    let m;
    const re = new RegExp(regex.source, regex.flags);
    while ((m = re.exec(content)) !== null) {
      const path = m[1] || m[2] || "";
      const method = m[0].match(/(get|post|put|patch|delete)/i);
      matches.push({
        method: method ? method[1].toUpperCase() : "UNKNOWN",
        path: path,
        framework: framework,
      });
    }
  }
  return matches;
}

function matchComponents(content) {
  const matches = [];
  for (const { regex, type } of COMPONENT_PATTERNS) {
    let m;
    const re = new RegExp(regex.source, regex.flags);
    while ((m = re.exec(content)) !== null) {
      matches.push({
        name: m[2] || m[1] || "anonymous",
        type: type,
      });
    }
  }
  return matches;
}

function matchModels(content, ext) {
  const models = [];

  if (ext === ".py") {
    const classMatches = content.matchAll(/class\s+(\w+)\s*\((?:models\.Model|Model|db\.Model)\)/g);
    for (const m of classMatches) {
      models.push({ name: m[1], orm: "django" });
    }
    const sqlalchemyMatches = content.matchAll(/class\s+(\w+)\s*\(\s*Base\s*\)/g);
    for (const m of sqlalchemyMatches) {
      models.push({ name: m[1], orm: "sqlalchemy" });
    }
  }

  if (ext === ".ts" || ext === ".js") {
    const prismaModelMatches = content.matchAll(/model\s+(\w+)\s*\{/g);
    for (const m of prismaModelMatches) {
      models.push({ name: m[1], orm: "prisma" });
    }
    const typeormMatches = content.matchAll(/@Entity\s*\(\s*['"`]?(\w+)['"`]?\s*\)/g);
    for (const m of typeormMatches) {
      models.push({ name: m[1], orm: "typeorm" });
    }
    const sequelizeMatches = content.matchAll(/\.define\s*\(\s*['"`](\w+)['"`]/g);
    for (const m of sequelizeMatches) {
      models.push({ name: m[1], orm: "sequelize" });
    }
  }

  if (ext === ".java") {
    const jpaMatches = content.matchAll(/@Entity\s*(?:\([^)]*\))?\s*\n\s*public\s+class\s+(\w+)/g);
    for (const m of jpaMatches) {
      models.push({ name: m[1], orm: "jpa" });
    }
  }

  if (ext === ".go") {
    const gormMatches = content.matchAll(/type\s+(\w+)\s+struct\s*\{/g);
    for (const m of gormMatches) {
      models.push({ name: m[1], orm: "gorm" });
    }
  }

  return models;
}

function matchEnvVars(content) {
  const vars = new Set();
  for (const pattern of ENV_PATTERNS) {
    let m;
    const re = new RegExp(pattern.source, pattern.flags);
    while ((m = re.exec(content)) !== null) {
      vars.add(m[1]);
    }
  }
  return Array.from(vars);
}

function detectMonorepo(rootDir) {
  for (const marker of MONOREPO_MARKERS) {
    if (existsSync(join(rootDir, marker))) return true;
  }

  const hasPackagesDir = existsSync(join(rootDir, "packages"));
  const hasAppsDir = existsSync(join(rootDir, "apps"));
  const hasModulesDir = existsSync(join(rootDir, "modules"));

  if (hasPackagesDir && (hasAppsDir || hasModulesDir)) return true;

  try {
    const pkgJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf-8"));
    if (pkgJson.workspaces) return true;
  } catch {}

  return false;
}

function detectPackages(rootDir) {
  const packages = [];
  const candidateDirs = ["packages", "apps", "modules", "services"];

  for (const dir of candidateDirs) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) continue;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const pkgJsonPath = join(dirPath, entry.name, "package.json");
        if (existsSync(pkgJsonPath)) {
          try {
            const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
            packages.push({
              name: pkg.name || entry.name,
              path: `${dir}/${entry.name}`,
            });
          } catch {
            packages.push({ name: entry.name, path: `${dir}/${entry.name}` });
          }
        } else {
          packages.push({ name: entry.name, path: `${dir}/${entry.name}` });
        }
      }
    } catch {}
  }

  return packages;
}

function extractPrismaModels(content, filePath) {
  const models = [];
  const matches = content.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g);
  for (const m of matches) {
    const fields = extractPrismaFields(m[2]);
    models.push({
      file: filePath,
      type: "prisma_model",
      name: m[1],
      fields: fields,
    });
  }
  return models;
}

function extractPrismaFields(body) {
  const fields = [];
  const lines = body.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2 && !parts[0].startsWith("@")) {
      fields.push({ name: parts[0], type: parts[1] });
    }
  }
  return fields;
}

function extractSqlTables(content, filePath) {
  const tables = [];
  const matches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([^;]*)\)/gis);
  for (const m of matches) {
    const columns = extractSqlColumns(m[2]);
    tables.push({
      file: filePath,
      type: "sql_table",
      name: m[1],
      columns: columns,
    });
  }
  return tables;
}

function extractSqlColumns(body) {
  const columns = [];
  const lines = body.split(",");
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.toUpperCase().startsWith("CONSTRAINT") ||
        trimmed.toUpperCase().startsWith("PRIMARY") ||
        trimmed.toUpperCase().startsWith("FOREIGN") ||
        trimmed.toUpperCase().startsWith("UNIQUE") ||
        trimmed.toUpperCase().startsWith("INDEX") ||
        trimmed.toUpperCase().startsWith("CHECK")) {
      continue;
    }
    const parts = trimmed.split(/\s+/);
    if (parts.length >= 2) {
      columns.push({ name: parts[0].replace(/[`"]/g, ""), type: parts[1] });
    }
  }
  return columns;
}

function extractOrmModels(content, filePath) {
  return matchModels(content, extname(filePath)).map(m => ({
    file: filePath,
    type: "orm_model",
    name: m.name,
    orm: m.orm,
  }));
}

function extractProtoMessages(content, filePath) {
  const messages = [];
  const matches = content.matchAll(/message\s+(\w+)\s*\{([^}]*)\}/g);
  for (const m of matches) {
    const fields = [];
    const fieldLines = m[2].split("\n");
    for (const line of fieldLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const parts = trimmed.split(/\s+/);
      if (parts.length >= 3) {
        fields.push({ name: parts[2], type: parts[1], modifier: parts[0] });
      }
    }
    messages.push({
      file: filePath,
      type: "proto_message",
      name: m[1],
      fields: fields,
    });
  }
  return messages;
}

function extractOpenApiPaths(content, filePath) {
  const paths = [];
  try {
    const spec = JSON.parse(content);
    if (spec.paths) {
      for (const [path, methods] of Object.entries(spec.paths)) {
        for (const method of Object.keys(methods)) {
          if (["get", "post", "put", "patch", "delete"].includes(method.toLowerCase())) {
            paths.push({
              file: filePath,
              type: "openapi_path",
              method: method.toUpperCase(),
              path: path,
            });
          }
        }
      }
    }
  } catch {
    // YAML OpenAPI — extract paths with regex
    const pathMatches = content.matchAll(/^\s*(\/[\w\/\-{}]+):\s*$/gm);
    for (const m of pathMatches) {
      paths.push({
        file: filePath,
        type: "openapi_path",
        path: m[1],
      });
    }
  }
  return paths;
}
