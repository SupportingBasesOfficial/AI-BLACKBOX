// lib/classification.js — Single source of truth for file classification.
//
// ROOT CAUSE this module fixes:
//   The original architecture-mapper classified files using substring regex
//   on filenames (/api/i, /route/i, /handler/i, /view/i). This is structurally
//   unreliable: /api/i matches "api-client", /view/i matches "review",
//   /route/i matches "route-helper". No amount of blacklists fixes that.
//
// SOLUTION:
//   Token-based scoring. A file's path is split into whole-word tokens. Each
//   token (directory segment or filename part) votes for a (layer, subtype)
//   with a weight. Directory context is weighted more than filename tokens
//   because "api" in app/api/ means route but "api" in api-client.ts does
//   not. Non-ingress directories (lib/, utils/, hooks/) apply a structural
//   penalty to ingress scores so utility modules are never pulled into the
//   entry-point layer. The highest-scoring (layer, subtype) wins only if it
//   crosses a confidence threshold and is not tied — ties go to unclassified
//   rather than guessing.
//
// This module also centralizes test-file detection and runtime env-var
// detection so context-scanner.js and tech-debt-scanner.js share one
// implementation instead of duplicating logic.

// ---------------------------------------------------------------------------
// Test file detection — test files are never architecturally classified.
// They exercise routes/components but are not routes/components themselves.
// ---------------------------------------------------------------------------

const TEST_DIR_RE = /(^|\/)(tests?|__tests__|spec|specs|__specs__|fixtures)\//i;
const TEST_FILE_RE = /\.(test|spec|bench|stories)\.[a-z0-9]+$/i;

export function isTestFile(relativePath) {
  if (!relativePath) return false;
  return TEST_DIR_RE.test(relativePath) || TEST_FILE_RE.test(relativePath);
}

// ---------------------------------------------------------------------------
// Runtime env var detection — env vars injected by the runtime, CI, or
// package manager. They are NEVER declared in .env files, so flagging them
// as "orphan" is a false positive.
// ---------------------------------------------------------------------------

const RUNTIME_ENV_EXACT = new Set([
  // OS / shell
  "PWD", "HOME", "PATH", "SHELL", "TERM", "USER", "LOGNAME", "LANG", "LC_ALL",
  "LC_CTYPE", "APPDATA", "LOCALAPPDATA", "PROGRAMFILES", "PROGRAMDATA",
  "TEMP", "TMP", "TMPDIR", "OLDPWD", "SHLVL", "_",
  // Node / npm runtime
  "NODE_ENV", "INIT_CWD", "PREFIX", "NODE_PATH", "NODE_OPTIONS",
  "npm_package_version", "npm_package_name", "npm_package_json",
  "npm_lifecycle_event", "npm_lifecycle_script", "npm_node_execpath",
  "npm_execpath", "npm_command",
  // CI providers
  "CI", "GITHUB_ACTIONS", "RUNNER_OS", "RUNNER_ARCH", "RUNNER_TEMP",
  "RUNNER_WORKSPACE", "BUILD_NUMBER", "BUILD_ID", "JOB_NAME",
  "GITLAB_CI", "GITLAB_USER_ID", "JENKINS_URL", "TEAMCITY_VERSION",
  "CIRCLECI", "TRAVIS", "DRONE", "BITBUCKET_BUILD_NUMBER",
  "VERCEL", "RAILWAY_PROJECT_ID", "RENDER_SERVICE_ID",
  // IDE / editor injected
  "CURSOR_DEBUG", "WINDSURF_DEBUG", "VSCODE_CLI", "NVIM", "VIMRUNTIME",
  "INTELLIJ_ENVIRONMENT_READER", "IDEA_INITIAL_DIRECTORY", "ZERO_ERROR",
]);

const RUNTIME_ENV_PREFIXES = [
  "npm_",            // npm_* (npm_config_*, npm_package_*, etc.)
  "GITHUB_",         // GitHub Actions: GITHUB_REPOSITORY, GITHUB_SHA, etc.
  "RUNNER_",         // GitHub Actions runner vars
  "INPUT_",          // GitHub Actions workflow inputs
  "GITLAB_",         // GitLab CI
  "TEAMCITY_",       // TeamCity
  "BITBUCKET_",      // Bitbucket Pipelines
  "NETLIFY_",        // Netlify build env
  "VERCEL_",         // Vercel build env
  "FEATURE_",        // Feature flags (build-time, not runtime env vars)
  "ENABLE_",         // Enable flags (build-time, e.g. ENABLE_REACT_COMPILER)
  "SKIP_",           // Skip flags (build-time, e.g. SKIP_ENV_VALIDATION)
  "NEXT_",           // Next.js automatic vars (NEXT_RUNTIME, etc.)
  "BUILD_",          // Build flags (BUILD_STANDALONE, etc.)
  "ANALYZE",         // Next.js bundle analyzer flag
];

export function isRuntimeEnvVar(name) {
  if (!name) return false;
  if (RUNTIME_ENV_EXACT.has(name)) return true;
  for (const p of RUNTIME_ENV_PREFIXES) {
    if (name.startsWith(p)) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Token extraction — splits a path into whole-word tokens for exact matching.
// "lib/api-client.ts"           -> ["lib", "api", "client"]
// "app/api/users/[id]/route.ts" -> ["app", "api", "users", "id", "route"]
// ---------------------------------------------------------------------------

export function tokenizePath(relativePath) {
  const normalized = (relativePath || "").toLowerCase().replace(/\\/g, "/");
  const segments = normalized.split("/");
  const tokens = [];
  for (const segment of segments) {
    // Normalize dynamic route params: [id] -> id, [...slug] -> slug, [[...slug]] -> slug
    const cleaned = segment
      .replace(/\[\[\.\.\.([^\]]+)\]\]/g, "$1")
      .replace(/\[\.\.\.([^\]]+)\]/g, "$1")
      .replace(/\[([^\]]+)\]/g, "$1");
    for (const piece of cleaned.split(/[-_.]+/)) {
      // Skip empty and 1-char tokens (like "ts", "js" extensions, single letters)
      if (piece && piece.length >= 2) tokens.push(piece);
    }
  }
  return tokens;
}

function dirSegments(relativePath) {
  const normalized = (relativePath || "").toLowerCase().replace(/\\/g, "/");
  const parts = normalized.split("/");
  return parts.slice(0, -1);
}

// ---------------------------------------------------------------------------
// Config file exclusion — orthogonal to architectural classification.
// ---------------------------------------------------------------------------

const CONFIG_FILENAMES = new Set([
  "package.json", "package-lock.json", "tsconfig.json", "jsconfig.json",
  "dockerfile", "docker-compose", "docker-compose.yml", "docker-compose.yaml",
  ".dockerignore", ".gitignore", ".npmrc", ".yarnrc", ".editorconfig",
  "babel.config.js", "babel.config.json", "webpack.config.js", "vite.config.ts",
  "vitest.config.ts", "vitest.config.js", "jest.config.js", "jest.config.ts",
  "rollup.config.js", "esbuild.config.js", "turbo.json", "lerna.json",
  "pnpm-workspace.yaml", ".env", ".env.example", ".env.local",
  "makefile", "cmakelists.txt", "gemfile", "rakefile",
]);

const CONFIG_EXTS = new Set([
  ".json", ".yml", ".yaml", ".toml", ".ini", ".cfg", ".conf",
  ".env", ".dockerfile", ".lock", ".txt",
]);

// ---------------------------------------------------------------------------
// Non-architectural file exclusion — scripts, docs, temp files.
// These are never architectural components regardless of directory or name.
// ---------------------------------------------------------------------------

// Script extensions — these are automation/test scripts, not application code.
const SCRIPT_EXTS = new Set([".ps1", ".sh", ".bat", ".cmd", ".bash"]);

// All markdown files are documentation, not code. The original scanner only
// excluded readme.md and license — ARCHITECTURE.md, TECHNICAL-GUIDE.md, etc.
// leaked through and got classified as routes.
const DOC_EXTS = new Set([".md", ".mdx", ".rst", ".txt"]);

// Temp/test script filename patterns — files like tmp-e2e-test.mjs,
// test-zabbix-curl.ps1, test-new-routes.mjs are scripts, not routes.
const TEMP_FILE_RE = /^(tmp|temp)[-_.]/i;
const TEST_SCRIPT_RE = /^test[-_]/i;
const CHECK_SCRIPT_RE = /^check[-_]/i;
const APPLY_SCRIPT_RE = /^(apply|register|run|setup|init|bootstrap|seed|migrate)[-_.]/i;

function isNonArchitecturalFile(fullName, ext, relativePath) {
  if (SCRIPT_EXTS.has(ext)) return true;
  if (DOC_EXTS.has(ext)) return true;
  if (TEMP_FILE_RE.test(fullName)) return true;
  if (TEST_SCRIPT_RE.test(fullName)) return true;
  if (CHECK_SCRIPT_RE.test(fullName)) return true;
  // Script-like .mjs/.js files (apply-migrations.mjs, register-migration.mjs)
  // These are build/migration scripts, not application code.
  if (APPLY_SCRIPT_RE.test(fullName) && (ext === ".mjs" || ext === ".js" || ext === ".cjs")) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Signal definitions
// ---------------------------------------------------------------------------
//
// Each signal is { re, subtype, weight } for directory signals, or stored in
// a Map<token, { subtype, weight }> for filename token signals.
//
// Weight guidelines:
//   5 = scanner content analysis (strongest — actual route/component code)
//   4 = unambiguous directory convention (app/api/, routes/, controllers/)
//   3 = strong directory convention (middleware/, components/, services/)
//   3 = unambiguous filename token (router, controller, middleware, resolver)
//   2 = weaker/ambiguous directory (handlers/, pages/)
//   2 = weaker filename token (endpoint, gateway, lambda)
//
// IMPORTANT: "api", "route", "handler", "view", "resource" are deliberately
// NOT filename token signals. They are too ambiguous as standalone words:
//   "api-client" is not a route, "review" is not a view, "resource-manager"
//   is not an entry point. These words are only meaningful in directory
//   context (app/api/, routes/, views/), which is handled by dir signals.
// ---------------------------------------------------------------------------

// --- Ingress: directory signals ---

const INGRESS_DIR_SIGNALS = [
  // Next.js App Router API routes — strongest route signal
  { re: /(?:^|\/)app\/api\//, subtype: "route", weight: 4 },
  // Next.js Pages Router API routes
  { re: /(?:^|\/)pages\/api\//, subtype: "route", weight: 4 },
  // Classic web framework route/controller directories
  { re: /(?:^|\/)controllers?\//, subtype: "route", weight: 3 },
  { re: /(?:^|\/)routes?\//, subtype: "route", weight: 3 },
  { re: /(?:^|\/)endpoints?\//, subtype: "route", weight: 3 },
  { re: /(?:^|\/)viewsets?\//, subtype: "route", weight: 3 },
  { re: /(?:^|\/)resources?\//, subtype: "route", weight: 2 },
  // GraphQL
  { re: /(?:^|\/)resolvers?\//, subtype: "graphql", weight: 3 },
  // Middleware / interceptors / filters — ingress pipeline, own subtype
  { re: /(?:^|\/)middleware\//, subtype: "middleware", weight: 3 },
  { re: /(?:^|\/)interceptors?\//, subtype: "middleware", weight: 3 },
  { re: /(?:^|\/)filters?\//, subtype: "middleware", weight: 2 },
  // UI components / views / pages — presentation entry points
  { re: /(?:^|\/)components?\//, subtype: "component", weight: 3 },
  { re: /(?:^|\/)views?\//, subtype: "component", weight: 2 },
  { re: /(?:^|\/)screens?\//, subtype: "component", weight: 2 },
  { re: /(?:^|\/)widgets?\//, subtype: "component", weight: 2 },
  // Next.js Pages Router pages (not API)
  { re: /(?:^|\/)pages\/(?!api)/, subtype: "component", weight: 2 },
];

// --- Ingress: filename token signals (exact whole-word match only) ---

const INGRESS_FILENAME_TOKENS = new Map([
  ["router",       { subtype: "route",      weight: 3 }],
  ["routes",       { subtype: "route",      weight: 3 }],
  ["controller",   { subtype: "route",      weight: 3 }],
  ["controllers",  { subtype: "route",      weight: 3 }],
  ["middleware",   { subtype: "middleware", weight: 3 }],
  ["interceptor",  { subtype: "middleware", weight: 3 }],
  ["interceptors", { subtype: "middleware", weight: 3 }],
  ["filter",       { subtype: "middleware", weight: 2 }],
  ["filters",      { subtype: "middleware", weight: 2 }],
  ["resolver",     { subtype: "graphql",    weight: 3 }],
  ["resolvers",    { subtype: "graphql",    weight: 3 }],
  ["viewset",      { subtype: "route",      weight: 3 }],
  ["viewsets",     { subtype: "route",      weight: 3 }],
  ["servlet",      { subtype: "route",      weight: 2 }],
  ["endpoint",     { subtype: "route",      weight: 2 }],
  ["endpoints",    { subtype: "route",      weight: 2 }],
  ["gateway",      { subtype: "route",      weight: 2 }],
  ["lambda",       { subtype: "route",      weight: 2 }],
  // NOT included: api, route, handler, view, resource, action — too ambiguous
]);

// --- Ingress: file extension suffixes (unambiguous) ---

const INGRESS_FILE_SUFFIXES = [
  { suffix: ".controller.ts",  subtype: "route",      weight: 3 },
  { suffix: ".controller.js",  subtype: "route",      weight: 3 },
  { suffix: ".route.ts",       subtype: "route",      weight: 3 },
  { suffix: ".route.js",       subtype: "route",      weight: 3 },
  { suffix: ".middleware.ts",  subtype: "middleware", weight: 3 },
  { suffix: ".middleware.js",  subtype: "middleware", weight: 3 },
  { suffix: ".resolver.ts",    subtype: "graphql",    weight: 3 },
  { suffix: ".resolver.js",    subtype: "graphql",    weight: 3 },
];

// --- Ingress: special file-convention patterns ---

const NEXT_APP_ROUTE_RE = /(?:^|\/)app\/.*\/route\.(ts|js|tsx|jsx)$/i;
const NEXT_APP_PAGE_RE  = /(?:^|\/)app\/.*\/page\.(tsx|jsx|ts|js)$/i;
const NEXT_APP_LAYOUT_RE = /(?:^|\/)app\/.*\/layout\.(tsx|jsx|ts|js)$/i;

// --- Non-ingress directory penalty ---
// Files in these directories are internal modules, not entry points. They
// get a penalty on their ingress score. This is structural, not a blacklist:
// a file in lib/ CAN still be ingress if it has a strong enough positive
// signal (e.g. scanner type "route" from content analysis = +5, minus lib/
// penalty -3 = +2, still ingress). The penalty just prevents weak substring
// matches from pulling utilities into the ingress layer.

const NON_INGRESS_DIR_SIGNALS = [
  { re: /(?:^|\/)lib\//,         weight: 3 },
  { re: /(?:^|\/)libs?\//,       weight: 3 },
  { re: /(?:^|\/)utils?\//,      weight: 3 },
  { re: /(?:^|\/)helpers?\//,    weight: 3 },
  { re: /(?:^|\/)hooks?\//,      weight: 3 },
  { re: /(?:^|\/)shared?\//,     weight: 2 },
  { re: /(?:^|\/)common?\//,     weight: 2 },
  { re: /(?:^|\/)types?\//,      weight: 3 },
  { re: /(?:^|\/)config\//,      weight: 3 },
  { re: /(?:^|\/)constants?\//,  weight: 3 },
  { re: /(?:^|\/)internal\//,    weight: 3 },
];

// --- Logic Core: directory signals ---

const LOGIC_CORE_DIR_SIGNALS = [
  { re: /(?:^|\/)services?\//,       subtype: "business",     weight: 3 },
  { re: /(?:^|\/)domain\//,          subtype: "business",     weight: 3 },
  { re: /(?:^|\/)business\//,        subtype: "business",     weight: 3 },
  { re: /(?:^|\/)logic\//,           subtype: "business",     weight: 3 },
  { re: /(?:^|\/)application\//,     subtype: "business",     weight: 3 },
  { re: /(?:^|\/)use-cases?\//,      subtype: "business",     weight: 3 },
  { re: /(?:^|\/)use_cases?\//,      subtype: "business",     weight: 3 },
  { re: /(?:^|\/)interactors?\//,    subtype: "business",     weight: 3 },
  { re: /(?:^|\/)commands?\//,       subtype: "business",     weight: 2 },
  { re: /(?:^|\/)queries?\//,        subtype: "business",     weight: 2 },
  { re: /(?:^|\/)actions?\//,        subtype: "business",     weight: 2 },
  { re: /(?:^|\/)processors?\//,     subtype: "business",     weight: 2 },
  { re: /(?:^|\/)orchestrators?\//,  subtype: "business",     weight: 3 },
  { re: /(?:^|\/)managers?\//,       subtype: "business",     weight: 2 },
  { re: /(?:^|\/)workers?\//,        subtype: "business",     weight: 2 },
  { re: /(?:^|\/)jobs?\//,           subtype: "business",     weight: 2 },
  { re: /(?:^|\/)tasks?\//,          subtype: "business",     weight: 2 },
  { re: /(?:^|\/)listeners?\//,      subtype: "business",     weight: 2 },
  { re: /(?:^|\/)core\//,            subtype: "business",     weight: 2 },
  { re: /(?:^|\/)rules?\//,          subtype: "business",     weight: 2 },
  { re: /(?:^|\/)policies?\//,       subtype: "business",     weight: 2 },
  // Data access sublayer
  { re: /(?:^|\/)repositories?\//,   subtype: "data-access",  weight: 3 },
  { re: /(?:^|\/)repo\//,            subtype: "data-access",  weight: 3 },
  { re: /(?:^|\/)adapters?\//,       subtype: "data-access",  weight: 2 },
  // Pattern sublayer
  { re: /(?:^|\/)factories?\//,      subtype: "pattern",      weight: 2 },
  { re: /(?:^|\/)strategies?\//,     subtype: "pattern",      weight: 2 },
  { re: /(?:^|\/)builders?\//,       subtype: "pattern",      weight: 2 },
];

// --- Logic Core: filename token signals ---

const LOGIC_CORE_FILENAME_TOKENS = new Map([
  ["service",       { subtype: "business",    weight: 2 }],
  ["services",      { subtype: "business",    weight: 2 }],
  ["usecase",       { subtype: "business",    weight: 2 }],
  ["usecases",      { subtype: "business",    weight: 2 }],
  ["domain",        { subtype: "business",    weight: 2 }],
  ["business",      { subtype: "business",    weight: 2 }],
  ["logic",         { subtype: "business",    weight: 2 }],
  ["interactor",    { subtype: "business",    weight: 2 }],
  ["orchestrator",  { subtype: "business",    weight: 2 }],
  ["processor",     { subtype: "business",    weight: 2 }],
  ["manager",       { subtype: "business",    weight: 2 }],
  ["calculator",    { subtype: "business",    weight: 2 }],
  ["worker",        { subtype: "business",    weight: 2 }],
  ["command",       { subtype: "business",    weight: 1 }],
  ["query",         { subtype: "business",    weight: 1 }],
  ["action",        { subtype: "business",    weight: 1 }],
  // Business logic engines and analyzers — common in lib/ directories.
  // Without these, lib/alerting-engine.ts, lib/correlation-engine.ts, etc.
  // are unclassified because lib/ only has an ingress penalty, no logic-core
  // bonus. These tokens provide the logic-core signal.
  ["engine",        { subtype: "business",    weight: 2 }],
  ["detector",      { subtype: "business",    weight: 2 }],
  ["predictor",     { subtype: "business",    weight: 2 }],
  ["analyzer",      { subtype: "business",    weight: 2 }],
  ["scorer",        { subtype: "business",    weight: 1 }],
  ["score",         { subtype: "business",    weight: 1 }],
  ["delivery",      { subtype: "business",    weight: 2 }],
  ["scheduler",     { subtype: "business",    weight: 2 }],
  ["sync",          { subtype: "business",    weight: 2 }],
  ["collector",     { subtype: "business",    weight: 2 }],
  ["downsample",    { subtype: "business",    weight: 2 }],
  ["lifecycle",     { subtype: "business",    weight: 2 }],
  ["generator",     { subtype: "business",    weight: 2 }],
  ["aggregator",    { subtype: "business",    weight: 2 }],
  ["dispatcher",    { subtype: "business",    weight: 2 }],
  ["coordinator",   { subtype: "business",    weight: 2 }],
  ["monitor",       { subtype: "business",    weight: 1 }],
  ["tracker",       { subtype: "business",    weight: 1 }],
  ["push",          { subtype: "business",    weight: 2 }],
  // Data access
  ["repository",    { subtype: "data-access", weight: 2 }],
  ["repositories",  { subtype: "data-access", weight: 2 }],
  ["dao",           { subtype: "data-access", weight: 2 }],
  ["adapter",       { subtype: "data-access", weight: 2 }],
  ["mapper",        { subtype: "data-access", weight: 2 }],
  ["connector",     { subtype: "data-access", weight: 2 }],
  // "client" removed as a logic-core token — it causes false positives
  // (sentry.client.config.ts, api-client.ts). "client" is too ambiguous:
  // it can be a config file, a frontend wrapper, or a DB client. Only
  // "connector" is kept as a data-access signal.
  // Pattern
  ["factory",       { subtype: "pattern",     weight: 2 }],
  ["builder",       { subtype: "pattern",     weight: 2 }],
  ["strategy",      { subtype: "pattern",     weight: 2 }],
  ["validator",     { subtype: "pattern",     weight: 2 }],
]);

// --- State Store: directory signals ---

const STATE_STORE_DIR_SIGNALS = [
  { re: /(?:^|\/)models?\//,        weight: 3 },
  { re: /(?:^|\/)entities?\//,      weight: 3 },
  { re: /(?:^|\/)schemas?\//,       weight: 3 },
  { re: /(?:^|\/)migrations?\//,    weight: 3 },
  { re: /(?:^|\/)db\//,             weight: 3 },
  { re: /(?:^|\/)database\//,       weight: 3 },
  { re: /(?:^|\/)cache\//,          weight: 3 },
  { re: /(?:^|\/)queues?\//,        weight: 3 },
  { re: /(?:^|\/)storage\//,        weight: 3 },
  { re: /(?:^|\/)prisma\//,         weight: 3 },
  { re: /(?:^|\/)drizzle\//,        weight: 3 },
];

// --- State Store: filename token signals ---

const STATE_STORE_FILENAME_TOKENS = new Map([
  ["model",       { weight: 2 }],
  ["models",      { weight: 2 }],
  ["entity",      { weight: 2 }],
  ["entities",    { weight: 2 }],
  ["schema",      { weight: 2 }],
  ["schemas",     { weight: 2 }],
  ["migration",   { weight: 2 }],
  ["migrations",  { weight: 2 }],
  ["table",       { weight: 2 }],
  ["database",    { weight: 2 }],
  ["cache",       { weight: 2 }],
  ["queue",       { weight: 2 }],
  ["storage",     { weight: 2 }],
  ["prisma",      { weight: 2 }],
  ["orm",         { weight: 2 }],
]);

// ---------------------------------------------------------------------------
// Scoring classifier
// ---------------------------------------------------------------------------

function addSignal(scores, layer, subtype, weight, source) {
  const key = `${layer}:${subtype || "default"}`;
  if (!scores[key]) {
    scores[key] = { layer, subtype: subtype || null, weight: 0, signals: [] };
  }
  scores[key].weight += weight;
  scores[key].signals.push({ source, weight });
}

/**
 * Classify a file into an architectural layer using token-based scoring.
 *
 * @param {string} relativePath - Project-relative file path (forward slashes).
 * @param {string} [fileType]   - Type from the content scanner ("route",
 *                                "component", "orm_model", "source", etc.).
 * @returns {{ layer: string, subtype: string|null, confidence: number,
 *             signals: Array<{source:string, weight:number}>, tie: boolean }}
 */
export function classifyPath(relativePath, fileType) {
  const pathLower = (relativePath || "").toLowerCase().replace(/\\/g, "/");
  const fullName = pathLower.split("/").pop() || "";
  const ext = fullName.includes(".") ? "." + fullName.split(".").pop() : "";

  // --- Hard exclusions (not architectural) ---

  if (pathLower.startsWith(".zero-error/") || pathLower.includes("/.zero-error/")) {
    return result("unclassified", null, 0, [], false);
  }
  if (CONFIG_FILENAMES.has(fullName)) {
    return result("unclassified", null, 0, [], false);
  }
  if (CONFIG_EXTS.has(ext) && fileType === "source") {
    return result("unclassified", null, 0, [], false);
  }
  if (isNonArchitecturalFile(fullName, ext, relativePath)) {
    return result("unclassified", null, 0, [], false);
  }
  if (isTestFile(relativePath)) {
    return result("unclassified", null, 0, [], false);
  }

  const scores = {};
  const tokens = tokenizePath(relativePath);

  // --- Barrel/entry file exclusion ---
  // index.ts/index.js files are package barrel files or entry points that
  // re-export other modules. They are NOT route handlers even if the content
  // scanner detected route patterns (those patterns come from re-exported
  // route modules, not from the index file itself defining routes).
  const isBarrelFile = fullName === "index.ts" || fullName === "index.js" ||
                       fullName === "index.tsx" || fullName === "index.jsx";

  // --- File type signals (strongest — from content analysis) ---
  // BUT: the content scanner can produce false "route" detections in
  // component files (e.g. a component using router.push() matches a route
  // regex) and in barrel files (re-exporting routes). We guard against these
  // by checking the directory context before applying the route type signal.

  if (fileType === "route" || fileType === "openapi_path") {
    // Don't apply route type signal to barrel files — they re-export, not define
    if (isBarrelFile) {
      // Barrel files are unclassified unless they have other strong signals
    } else if (/(?:^|\/)components?\//i.test(pathLower) && (ext === ".tsx" || ext === ".jsx")) {
      // File is in components/ with JSX extension — it's a component, not a
      // route, even if the scanner detected route patterns (false positive
      // from router usage in the component). Apply as component, not route.
      addSignal(scores, "ingress", "component", 5, "scanner-type:route-overridden-by-component-dir");
    } else {
      addSignal(scores, "ingress", "route", 5, "scanner-type:route");
    }
  }
  if (fileType === "component") {
    addSignal(scores, "ingress", "component", 5, "scanner-type:component");
  }
  if (fileType === "proto_message") {
    addSignal(scores, "ingress", "grpc", 5, "scanner-type:proto");
  }
  if (fileType === "prisma_model" || fileType === "sql_table" || fileType === "orm_model") {
    addSignal(scores, "state-store", null, 5, "scanner-type:orm-model");
  }

  // --- Special file-convention patterns (Next.js App Router) ---

  if (NEXT_APP_ROUTE_RE.test(pathLower)) {
    addSignal(scores, "ingress", "route", 4, "nextjs-app-router:route-file");
  }
  if (NEXT_APP_PAGE_RE.test(pathLower)) {
    addSignal(scores, "ingress", "component", 3, "nextjs-app-router:page");
  }
  if (NEXT_APP_LAYOUT_RE.test(pathLower)) {
    addSignal(scores, "ingress", "component", 2, "nextjs-app-router:layout");
  }

  // --- Directory signals ---

  for (const sig of INGRESS_DIR_SIGNALS) {
    if (sig.re.test(pathLower)) {
      addSignal(scores, "ingress", sig.subtype, sig.weight, `dir:${sig.re.source}`);
    }
  }
  for (const sig of LOGIC_CORE_DIR_SIGNALS) {
    if (sig.re.test(pathLower)) {
      addSignal(scores, "logic-core", sig.subtype, sig.weight, `dir:${sig.re.source}`);
    }
  }
  for (const sig of STATE_STORE_DIR_SIGNALS) {
    if (sig.re.test(pathLower)) {
      addSignal(scores, "state-store", null, sig.weight, `dir:${sig.re.source}`);
    }
  }

  // --- Non-ingress directory penalty ---
  // Applied AFTER positive ingress signals so it reduces their net score.

  let nonIngressPenalty = 0;
  for (const sig of NON_INGRESS_DIR_SIGNALS) {
    if (sig.re.test(pathLower)) nonIngressPenalty += sig.weight;
  }
  if (nonIngressPenalty > 0) {
    for (const key of Object.keys(scores)) {
      if (key.startsWith("ingress:")) {
        scores[key].weight -= nonIngressPenalty;
        scores[key].signals.push({ source: "non-ingress-dir-penalty", weight: -nonIngressPenalty });
      }
    }
  }

  // --- Filename token signals (exact whole-word match) ---

  // Config/setup filename tokens penalize logic-core — these are
  // configuration files (sentry.client.config.ts, next.config.ts, etc.),
  // not business logic.
  const CONFIG_NAME_TOKENS = new Set(["config", "setup", "configuration", "options", "settings"]);

  for (const token of tokens) {
    if (INGRESS_FILENAME_TOKENS.has(token)) {
      const sig = INGRESS_FILENAME_TOKENS.get(token);
      addSignal(scores, "ingress", sig.subtype, sig.weight, `filename-token:${token}`);
    }
    if (LOGIC_CORE_FILENAME_TOKENS.has(token)) {
      // Skip logic-core tokens for config files
      if (CONFIG_NAME_TOKENS.has(token)) continue;
      const sig = LOGIC_CORE_FILENAME_TOKENS.get(token);
      addSignal(scores, "logic-core", sig.subtype, sig.weight, `filename-token:${token}`);
    }
    if (STATE_STORE_FILENAME_TOKENS.has(token)) {
      const sig = STATE_STORE_FILENAME_TOKENS.get(token);
      addSignal(scores, "state-store", null, sig.weight, `filename-token:${token}`);
    }
  }

  // Penalize logic-core for config filename tokens
  if (tokens.some(t => CONFIG_NAME_TOKENS.has(t))) {
    for (const key of Object.keys(scores)) {
      if (key.startsWith("logic-core:")) {
        scores[key].weight -= 3;
        scores[key].signals.push({ source: "config-filename-penalty", weight: -3 });
      }
    }
  }

  // --- File suffix signals (e.g. .controller.ts) ---

  for (const { suffix, subtype, weight } of INGRESS_FILE_SUFFIXES) {
    if (fullName.endsWith(suffix)) {
      addSignal(scores, "ingress", subtype, weight, `suffix:${suffix}`);
    }
  }

  // --- SQL migration files ---
  // Files like 20260725190000_firewall_rules.sql are migrations even if
  // they're not in a migrations/ directory (e.g. in drizzle/ or supabase/).
  const SQL_MIGRATION_RE = /^\d{10,}.*\.sql$/i;
  if (ext === ".sql" && SQL_MIGRATION_RE.test(fullName)) {
    addSignal(scores, "state-store", null, 4, "sql-migration-timestamp-pattern");
  }

  // --- Pick winner ---

  const entries = Object.values(scores).filter(e => e.weight > 0);
  if (entries.length === 0) {
    return result("unclassified", null, 0, [], false);
  }
  entries.sort((a, b) => b.weight - a.weight);

  // Tie → unclassified. Don't guess when signals are ambiguous.
  if (entries.length > 1 && entries[0].weight === entries[1].weight) {
    return result("unclassified", null, 0, entries[0].signals, true);
  }

  const winner = entries[0];
  return result(winner.layer, winner.subtype, winner.weight, winner.signals, false);
}

function result(layer, subtype, confidence, signals, tie) {
  return { layer, subtype, confidence, signals, tie };
}
