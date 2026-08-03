// lib/context-scanner.js — Deep project scanner: schemas, routes, models, components
// Zero IA calls. RegEx + file system heuristics only.

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { join, extname, basename, relative, sep } from "path";
import { isTestFile, isRuntimeEnvVar } from "./classification.js";

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
  { pattern: /models\/.*\.py$/i, type: "django_model", extractor: extractDjangoModels },
  { pattern: /entities?\/.*\.(ts|js|java|kt|cs|go)$/i, type: "entity_model", extractor: extractEntityModels },
  { pattern: /schemas?\/.*\.(ts|js|py)$/i, type: "validation_schema", extractor: extractValidationSchemas },
  { pattern: /\.graphql$/i, type: "graphql_schema", extractor: extractGraphQLTypes },
  { pattern: /\.gql$/i, type: "graphql_schema", extractor: extractGraphQLTypes },
  { pattern: /schema\.(rs|go)$/i, type: "db_schema", extractor: extractDbSchema },
  { pattern: /migrations?\/.*\.(ts|js|go|rs|py|rb)$/i, type: "code_migration", extractor: extractCodeMigrations },
  { pattern: /\.supabase\.(ts|js|sql)$/i, type: "supabase_schema", extractor: extractSupabaseSchema },
  { pattern: /db\/(?:schema|models)\.(py|ts|js|go|rs)$/i, type: "db_schema", extractor: extractDbSchema },
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
  { regex: /(?:get|post|put|patch|delete)\s*\.\s*\w+\s*\(\s*['"`]([^'"`]+)['"`]\s*do\s*\|[^|]*\|/g, framework: "rails" },
  { regex: /@RequestMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)/g, framework: "spring" },
  { regex: /@GetMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)/g, framework: "spring" },
  { regex: /@PostMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)/g, framework: "spring" },
  { regex: /@PutMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)/g, framework: "spring" },
  { regex: /@DeleteMapping\s*\(\s*(?:value\s*=\s*)?['"`]([^'"`]+)/g, framework: "spring" },
  { regex: /\[HttpGet\s*\(\s*['"`]([^'"`]+)/g, framework: "aspnet" },
  { regex: /\[HttpPost\s*\(\s*['"`]([^'"`]+)/g, framework: "aspnet" },
  { regex: /\[HttpPut\s*\(\s*['"`]([^'"`]+)/g, framework: "aspnet" },
  { regex: /\[HttpDelete\s*\(\s*['"`]([^'"`]+)/g, framework: "aspnet" },
  { regex: /@app\.route\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*methods\s*=\s*\[/g, framework: "flask" },
  { regex: /r\.(GET|POST|PUT|DELETE|PATCH)\s*\(\s*['"`]([^'"`]+)/g, framework: "gin" },
  { regex: /e\.\(GET|POST|PUT|DELETE\)\s*\(\s*['"`]([^'"`]+)/g, framework: "echo" },
  { regex: /scope\s*\.\s*(?:get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g, framework: "phoenix" },
  { regex: /#\[(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g, framework: "actix" },
  { regex: /map_(get|post|put|delete)\s*!\s*\(\s*['"`]([^'"`]+)/g, framework: "axum" },
  { regex: /Router\(\)\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g, framework: "polka" },
  { regex: /\b(?:get|post|put|delete|patch)\s*\(\s*['"`]([^'"`]+)['"`]\s*,\s*(?:handler|async)/g, framework: "hapi" },
  // Hono — uses app.get('/path', handler) like Express, but also supports
  // app.openapi(route, handler) and app.route('/path', subApp) which the
  // Express pattern doesn't catch.
  { regex: /\.openapi\s*\(\s*[a-zA-Z_]\w*\s*,/g, framework: "hono" },
  { regex: /\.route\s*\(\s*['"`]([^'"`]+)/g, framework: "hono" },
  { regex: /createRoute\s*\(\s*\{[\s\S]*?method:\s*['"`](get|post|put|patch|delete)['"`][\s\S]*?path:\s*['"`]([^'"`]+)/g, framework: "hono" },
];

const COMPONENT_PATTERNS = [
  { regex: /export\s+(default\s+)?function\s+(\w+)/g, type: "react_function" },
  { regex: /export\s+(default\s+)?class\s+(\w+)\s+extends\s+(React\.Component|Component)/g, type: "react_class" },
  { regex: /defineComponent\s*\(\s*\{/g, type: "vue_define" },
  { regex: /export\s+default\s+\{/g, type: "vue_sfc" },
  { regex: /@Component\s*\(/g, type: "angular_component" },
  { regex: /export\s+class\s+(\w+)\s+implements\s+OnInit/g, type: "angular_class" },
  { regex: /export\s+default\s+function\s+\w+\s*\(\s*\)/g, type: "svelte_component" },
  { regex: /<script\s+setup/g, type: "vue_setup" },
  { regex: /createSignal\s*\(/g, type: "solid_component" },
  { regex: /class\s+\w+\s+extends\s+StatelessWidget/g, type: "flutter_widget" },
  { regex: /class\s+\w+\s+extends\s+StatefulWidget/g, type: "flutter_widget" },
  { regex: /class\s+\w+\s+extends\s+HookWidget/g, type: "flutter_hook" },
  { regex: /struct\s+\w+\s*:\s*View/g, type: "swiftui_view" },
  { regex: /@main\s+struct\s+\w+\s*App/g, type: "swiftui_app" },
  { regex: /@BlazorComponent\s*\(/g, type: "blazor_component" },
  { regex: /@page\s*['"`]([^'"`]+)/g, type: "blazor_page" },
  { regex: /@Component\s*\(\s*\{[\s\S]*?selector\s*:/g, type: "angular_standalone" },
  { regex: /export\s+default\s+\w+\s*=\s*\(\s*\)\s*=>\s*\{/g, type: "arrow_component" },
  { regex: /styled\s*\.\s*(?:div|span|button|section|article|header|footer|nav|main|aside|p|a|img|ul|ol|li|table|tr|td|th|input|label|form|h[1-6])/g, type: "styled_component" },
  { regex: /makeStyles\s*\(\s*\{/g, type: "mui_styles" },
  { regex: /tv\s*\(\s*\{/g, type: "tailwind_variants" },
  { regex: /class\s+\w+\s+extends\s+HTMLElement/g, type: "web_component" },
  { regex: /customElements\.define\s*\(/g, type: "web_component" },
];

// Patterns that only make sense in JSX-capable files (.tsx/.jsx).
// Running these on plain .ts/.js causes massive false positives: any
// `export function foo()` utility (e.g. lib/api-client.ts) would be
// misclassified as a React component and pushed into the Ingress layer.
const JSX_ONLY_TYPES = new Set([
  "react_function", "react_class", "arrow_component",
  "styled_component", "mui_styles", "tailwind_variants",
]);
const JSX_EXTS = new Set([".tsx", ".jsx"]);

// Next.js App Router: files at app/**/route.{ts,js,tsx,jsx} export HTTP
// method handlers (GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS) instead of
// using express-style app.get(...) calls. These were silently missed.
const NEXT_APP_ROUTE_RE = /(?:^|\/)app\/.*\/route\.(ts|js|tsx|jsx)$/i;
const NEXT_HANDLER_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

const ENV_PATTERNS = [
  /process\.env\.(\w+)/g,
  /os\.environ\.get\s*\(\s*['"`]([^'"`]+)/g,
  /os\.environ\[\s*['"`]([^'"`]+)/g,
  /os\.getenv\s*\(\s*['"`]([^'"`]+)/g,
  /System\.getenv\s*\(\s*['"`]([^'"`]+)/g,
  /System\.getProperty\s*\(\s*['"`]([^'"`]+)/g,
  /os\.Getenv\s*\(\s*['"`]([^'"`]+)/g,
  /os\.LookupEnv\s*\(\s*['"`]([^'"`]+)/g,
  /std::env::var\s*\(\s*['"`]([^'"`]+)/g,
  /env::var\s*\(\s*['"`]([^'"`]+)/g,
  /ENV\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
  /ENV\.fetch\s*\(\s*['"`]([^'"`]+)/g,
  /\$_ENV\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
  /\$_SERVER\[\s*['"`]([^'"`]+)['"`]\s*\]/g,
  /getenv\s*\(\s*['"`]([^'"`]+)/g,
  /Environment\.GetEnvironmentVariable\s*\(\s*['"`]([^'"`]+)/g,
  /ProcessInfo\.processInfo\.environment\[\s*['"`]([^'"`]+)/g,
  /Platform\.environment\[\s*['"`]([^'"`]+)/g,
  /String\.fromEnvironment\s*\(\s*['"`]([^'"`]+)/g,
  /System\.get_env\s*\(\s*['"`]([^'"`]+)/g,
  /System\.fetch_env!\s*\(\s*['"`]([^'"`]+)/g,
];

// ENV_NOISE covers IDE/editor-injected vars that are not runtime vars (those
// are handled by isRuntimeEnvVar from classification.js). NODE_ENV is kept
// here because it is a standard Node env var, not a CI/runtime injection.
const ENV_NOISE = new Set([
  "CURSOR_DEBUG", "WINDSURF_DEBUG", "VSCODE_CLI", "NVIM", "VIMRUNTIME",
  "INTELLIJ_ENVIRONMENT_READER", "IDEA_INITIAL_DIRECTORY", "ZERO_ERROR",
  "NODE_ENV",
]);

const CRITICAL_PATH_KEYWORDS = [
  "auth", "payment", "billing", "user", "transaction", "security",
  "checkout", "invoice", "charge", "refund", "password", "token",
  "session", "permission", "role", "admin",
];

const MONOREPO_MARKERS = [
  "pnpm-workspace.yaml", "turbo.json", "lerna.json", "nx.json",
  "rush.json", "package-workspace.yaml",
  "go.work", "Cargo.toml", "pyproject.toml", "composer.json",
  "pubspec.yaml", "Package.swift", "CMakeLists.txt", "mix.exs",
];

export function scanProject(rootDir) {
  const files = collectFiles(rootDir, rootDir, 0, 20);
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

    const routeMatches = matchRoutes(content, file.relativePath);
    if (routeMatches.length > 0) {
      routes.push({
        file: file.relativePath,
        endpoints: routeMatches,
      });
    }

    const componentMatches = matchComponents(content, ext, file.relativePath);
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
      if (!ENV_NOISE.has(env) && !isRuntimeEnvVar(env)) {
        envVars.add(env);
      }
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
    allScannedFiles: files.map(f => f.relativePath),
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

function matchRoutes(content, filePath) {
  // Next.js App Router route handlers: app/**/route.ts exporting
  // GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS. Derive the URL path from the
  // filesystem location (the convention) since there is no path string.
  if (filePath && NEXT_APP_ROUTE_RE.test(filePath)) {
    return matchNextAppRouterRoutes(content, filePath);
  }

  // Test files exercise routes but are not routes themselves.
  if (filePath && isTestFile(filePath)) return [];

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

function matchNextAppRouterRoutes(content, filePath) {
  const found = [];
  for (const method of NEXT_HANDLER_METHODS) {
    const re = new RegExp(`export\\s+(?:async\\s+)?function\\s+${method}\\s*\\(`, "i");
    if (re.test(content)) found.push(method);
  }

  // Derive URL path from filesystem path:
  // app/api/users/[id]/route.ts -> /api/users/:id
  // app/api/[...slug]/route.ts -> /api/:slug*
  let routePath = filePath
    .replace(/(?:^|\/)app\//i, "/")
    .replace(/\/route\.(ts|js|tsx|jsx)$/i, "")
    .replace(/\[\[\.\.\.([^\]]+)\]\]/g, ":$1*")
    .replace(/\[\.\.\.([^\]]+)\]/g, ":$1*")
    .replace(/\[([^\]]+)\]/g, ":$1");
  if (routePath === "" || routePath === "/index") routePath = "/";

  const methods = found.length > 0 ? found : ["ANY"];
  return methods.map(method => ({ method, path: routePath, framework: "nextjs_app" }));
}

function matchComponents(content, ext, filePath) {
  // Test files exercise components but are not components themselves.
  if (filePath && isTestFile(filePath)) return [];

  const componentExts = new Set([
    ".tsx", ".jsx", ".vue", ".svelte", ".ts", ".js",
    ".dart", ".swift", ".cs", ".rs", ".html", ".kt",
  ]);
  if (!componentExts.has(ext)) return [];

  const matches = [];
  for (const { regex, type } of COMPONENT_PATTERNS) {
    // React function/arrow/styled patterns match any exported function on
    // plain .ts/.js (e.g. `export function apiClient()` in lib/). Require a
    // JSX-capable extension so utility modules are not misclassified as
    // React components and shoved into the Ingress layer.
    if (JSX_ONLY_TYPES.has(type) && !JSX_EXTS.has(ext)) continue;

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
    const pydanticMatches = content.matchAll(/class\s+(\w+)\s*\(\s*BaseModel\s*\)/g);
    for (const m of pydanticMatches) {
      models.push({ name: m[1], orm: "pydantic" });
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
    const mongooseMatches = content.matchAll(/(?:new\s+)?Schema\s*\(\s*\{/g);
    for (const m of mongooseMatches) {
      models.push({ name: "mongoose_schema", orm: "mongoose" });
    }
  }

  if (ext === ".java" || ext === ".kt") {
    const jpaMatches = content.matchAll(/@Entity\s*(?:\([^)]*\))?\s*(?:public\s+)?(?:class|data class)\s+(\w+)/g);
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

  if (ext === ".rs") {
    const dieselMatches = content.matchAll(/table!\s*\{\s*(\w+)\s*\(/g);
    for (const m of dieselMatches) {
      models.push({ name: m[1], orm: "diesel" });
    }
    const sqlxMatches = content.matchAll(/(?:#\[(?:derive|sqlx)\][\s\S]*?struct\s+(\w+)\s*\{)/g);
    for (const m of sqlxMatches) {
      models.push({ name: m[1], orm: "sqlx" });
    }
  }

  if (ext === ".cs") {
    const efMatches = content.matchAll(/public\s+class\s+(\w+)\s*(?::\s*(?:DbContext|IdentityDbContext)\s*)?\{/g);
    for (const m of efMatches) {
      models.push({ name: m[1], orm: "entity_framework" });
    }
    const efTableMatches = content.matchAll(/\[Table\s*\(\s*["']([^"']+)["']\s*\)\]\s*(?:public\s+)?class\s+(\w+)/g);
    for (const m of efTableMatches) {
      models.push({ name: m[2], orm: "entity_framework" });
    }
  }

  if (ext === ".rb") {
    const arMatches = content.matchAll(/class\s+(\w+)\s*<\s*(?:ApplicationRecord|ActiveRecord::Base)/g);
    for (const m of arMatches) {
      models.push({ name: m[1], orm: "activerecord" });
    }
  }

  if (ext === ".php") {
    const eloquentMatches = content.matchAll(/class\s+(\w+)\s+extends\s+Model\b/g);
    for (const m of eloquentMatches) {
      models.push({ name: m[1], orm: "eloquent" });
    }
    const doctrineMatches = content.matchAll(/#\[(?:ORM\\Entity|Entity)\][\s\S]*?class\s+(\w+)/g);
    for (const m of doctrineMatches) {
      models.push({ name: m[1], orm: "doctrine" });
    }
  }

  if (ext === ".swift") {
    let cdMatches = content.matchAll(/@Model\s+(?:final\s+)?class\s+(\w+)/g);
    for (const m of cdMatches) {
      models.push({ name: m[1], orm: "coredata" });
    }
    const grdbMatches = content.matchAll(/class\s+(\w+)\s*:\s*Record\b/g);
    for (const m of grdbMatches) {
      models.push({ name: m[1], orm: "grdb" });
    }
  }

  if (ext === ".dart") {
    const driftMatches = content.matchAll(/class\s+(\w+)\s+extends\s+Table\b/g);
    for (const m of driftMatches) {
      models.push({ name: m[1], orm: "drift" });
    }
    const floorMatches = content.matchAll(/@entity\s+class\s+(\w+)/g);
    for (const m of floorMatches) {
      models.push({ name: m[1], orm: "floor" });
    }
  }

  if (ext === ".ex" || ext === ".exs") {
    const ectoMatches = content.matchAll(/schema\s+["']([^"']+)["']\s+do/g);
    for (const m of ectoMatches) {
      models.push({ name: m[1], orm: "ecto" });
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

  const PKG_MARKERS = [
    "package.json", "pyproject.toml", "setup.py", "go.mod", "Cargo.toml",
    "pom.xml", "build.gradle", "build.gradle.kts", "Gemfile", "composer.json",
    "pubspec.yaml", "mix.exs", "CMakeLists.txt",
  ];

  function tryReadPkgName(pkgPath, fallbackName) {
    try {
      if (pkgPath.endsWith("package.json") || pkgPath.endsWith("composer.json")) {
        const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"));
        return pkg.name || fallbackName;
      }
      if (pkgPath.endsWith("pyproject.toml")) {
        const content = readFileSync(pkgPath, "utf-8");
        const nameMatch = content.match(/^name\s*=\s*["']([^"']+)["']/m);
        if (nameMatch) return nameMatch[1];
      }
      if (pkgPath.endsWith("go.mod")) {
        const content = readFileSync(pkgPath, "utf-8");
        const modMatch = content.match(/^module\s+(\S+)/m);
        if (modMatch) return modMatch[1];
      }
      if (pkgPath.endsWith("Cargo.toml")) {
        const content = readFileSync(pkgPath, "utf-8");
        const nameMatch = content.match(/^name\s*=\s*["']([^"']+)["']/m);
        if (nameMatch) return nameMatch[1];
      }
      if (pkgPath.endsWith("pom.xml")) {
        const content = readFileSync(pkgPath, "utf-8");
        const artMatch = content.match(/<artifactId>([^<]+)<\/artifactId>/);
        if (artMatch) return artMatch[1];
      }
      if (pkgPath.endsWith("pubspec.yaml")) {
        const content = readFileSync(pkgPath, "utf-8");
        const nameMatch = content.match(/^name:\s*(\S+)/m);
        if (nameMatch) return nameMatch[1];
      }
      if (pkgPath.endsWith("mix.exs")) {
        const content = readFileSync(pkgPath, "utf-8");
        const nameMatch = content.match(/app:\s*:([\w_]+)/);
        if (nameMatch) return nameMatch[1];
      }
    } catch {}
    return fallbackName;
  }

  function findPkgMarker(dirPath) {
    for (const marker of PKG_MARKERS) {
      const markerPath = join(dirPath, marker);
      if (existsSync(markerPath)) return markerPath;
    }
    if (existsSync(dirPath)) {
      try {
        const entries = readdirSync(dirPath);
        for (const entry of entries) {
          if (entry.endsWith(".csproj") || entry.endsWith(".sln")) {
            return join(dirPath, entry);
          }
        }
      } catch {}
    }
    return null;
  }

  for (const dir of candidateDirs) {
    const dirPath = join(rootDir, dir);
    if (!existsSync(dirPath)) continue;

    try {
      const entries = readdirSync(dirPath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const entryPath = join(dirPath, entry.name);
        const markerPath = findPkgMarker(entryPath);
        if (markerPath) {
          const pkgName = tryReadPkgName(markerPath, entry.name);
          packages.push({
            name: pkgName,
            path: `${dir}/${entry.name}`,
          });
        } else {
          const subDirs = ["backend", "frontend", "api", "web", "server", "worker"];
          for (const subDir of subDirs) {
            const subPath = join(entryPath, subDir);
            const subMarker = findPkgMarker(subPath);
            if (subMarker) {
              const pkgName = tryReadPkgName(subMarker, `${entry.name}/${subDir}`);
              packages.push({
                name: pkgName,
                path: `${dir}/${entry.name}/${subDir}`,
              });
            }
          }
          if (!packages.some(p => p.path.startsWith(`${dir}/${entry.name}/`))) {
            packages.push({ name: entry.name, path: `${dir}/${entry.name}` });
          }
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

function extractDjangoModels(content, filePath) {
  const models = [];
  const matches = content.matchAll(/class\s+(\w+)\s*\((?:models\.Model|[^)]*Model[^)]*)\)\s*:/g);
  for (const m of matches) {
    models.push({
      file: filePath,
      type: "django_model",
      name: m[1],
      fields: [],
    });
  }
  return models;
}

function extractEntityModels(content, filePath) {
  const models = [];
  const matches = content.matchAll(/@(?:Entity|Table|Document|Collection)\s*(?:\([^)]*\))?\s*(?:public\s+)?(?:class|struct)\s+(\w+)/g);
  for (const m of matches) {
    models.push({
      file: filePath,
      type: "entity_model",
      name: m[1],
      fields: [],
    });
  }
  const pydanticMatches = content.matchAll(/class\s+(\w+)\s*(?:\([^)]*BaseModel[^)]*)?\s*:/g);
  for (const m of pydanticMatches) {
    models.push({
      file: filePath,
      type: "pydantic_model",
      name: m[1],
      fields: [],
    });
  }
  return models;
}

function extractValidationSchemas(content, filePath) {
  const schemas = [];
  const zodMatches = content.matchAll(/(?:const|let|var)\s+(\w+Schema)\s*=\s*z\.(?:object|string|number|array|record)/g);
  for (const m of zodMatches) {
    schemas.push({
      file: filePath,
      type: "zod_schema",
      name: m[1],
      fields: [],
    });
  }
  const joiMatches = content.matchAll(/(?:const|let|var)\s+(\w+Schema)\s*=\s*Joi\.(?:object|string|number|array)/g);
  for (const m of joiMatches) {
    schemas.push({
      file: filePath,
      type: "joi_schema",
      name: m[1],
      fields: [],
    });
  }
  const yupMatches = content.matchAll(/(?:const|let|var)\s+(\w+Schema)\s*=\s*yup\.(?:object|string|number|array)/g);
  for (const m of yupMatches) {
    schemas.push({
      file: filePath,
      type: "yup_schema",
      name: m[1],
      fields: [],
    });
  }
  return schemas;
}

function extractGraphQLTypes(content, filePath) {
  const types = [];
  const typeMatches = content.matchAll(/(?:type|input|interface|union|enum)\s+(\w+)\s*(?:\{|implements)/g);
  for (const m of typeMatches) {
    types.push({
      file: filePath,
      type: "graphql_type",
      name: m[1],
      fields: [],
    });
  }
  return types;
}

function extractDbSchema(content, filePath) {
  const schemas = [];
  const tableMatches = content.matchAll(/(?:CREATE\s+TABLE|create_table|Table::new|sqlx::query)\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?/gi);
  for (const m of tableMatches) {
    schemas.push({
      file: filePath,
      type: "db_schema",
      name: m[1],
      fields: [],
    });
  }
  const structMatches = content.matchAll(/struct\s+(\w+)\s*\{[^}]*sqlx/g);
  for (const m of structMatches) {
    schemas.push({
      file: filePath,
      type: "rust_db_struct",
      name: m[1],
      fields: [],
    });
  }
  return schemas;
}

function extractCodeMigrations(content, filePath) {
  const migrations = [];
  const upMatches = content.matchAll(/(?:up|up_|upgrade|forward|migrate)\s*(?:\(|:)\s*(?:async\s*)?\(?/g);
  const tableMatches = content.matchAll(/(?:createTable|create_table|addColumn|add_column|dropTable|drop_table|alterTable|alter_table)\s*\(\s*['"`]?(\w+)/g);
  for (const m of tableMatches) {
    migrations.push({
      file: filePath,
      type: "code_migration",
      name: m[1],
      fields: [],
    });
  }
  return migrations;
}

function extractSupabaseSchema(content, filePath) {
  const schemas = [];
  const rlsMatches = content.matchAll(/CREATE\s+(?:POLICY|TABLE|FUNCTION|TRIGGER)/gi);
  const tableMatches = content.matchAll(/(?:from|into|update|table)\s+['"`]?(\w+)['"`]?/gi);
  const seen = new Set();
  for (const m of tableMatches) {
    if (!seen.has(m[1]) && !["select", "insert", "update", "delete", "from", "into", "table"].includes(m[1].toLowerCase())) {
      seen.add(m[1]);
      schemas.push({
        file: filePath,
        type: "supabase_schema",
        name: m[1],
        fields: [],
      });
    }
  }
  return schemas;
}
