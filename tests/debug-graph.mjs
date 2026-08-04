// Debug script — simulate the real project structure to verify
// dependency graph and delegation checker work correctly
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanProject } from "../lib/context-scanner.js";
import { mapArchitecture, generateArchitectureMap } from "../lib/architecture-mapper.js";

const root = mkdtempSync(join(tmpdir(), "zero-error-realtest-"));

try {
  // Simulate monorepo structure matching the real project
  // apps/api/src/routes/correlation.ts imports ../lib/correlation-engine
  // apps/api/src/lib/correlation-engine.ts is logic-core
  // apps/api/src/routes/anomaly.ts imports ../lib/anomaly-detector
  // packages/db/src/index.ts is state-store
  // routes import @repo/db

  const dirs = [
    "apps/api/src/routes",
    "apps/api/src/lib",
    "apps/api/src/middleware",
    "apps/web/app/api/zabbix/ping",
    "apps/web/app/dashboard",
    "packages/db/src",
    "packages/logger/src",
    "packages/cache/src",
  ];
  for (const d of dirs) mkdirSync(join(root, d), { recursive: true });

  // package.json for monorepo detection
  writeFileSync(join(root, "package.json"), JSON.stringify({
    name: "test-monorepo",
    workspaces: ["apps/*", "packages/*"],
  }));

  // Routes that delegate to logic-core
  writeFileSync(join(root, "apps/api/src/routes/correlation.ts"),
    "import { correlate } from '../lib/correlation-engine';\nexport function GET() { return correlate(); }\n");
  writeFileSync(join(root, "apps/api/src/routes/anomaly.ts"),
    "import { detect } from '../lib/anomaly-detector';\nexport function GET() { return detect(); }\n");
  writeFileSync(join(root, "apps/api/src/routes/notifications.ts"),
    "import { send } from '../lib/notification-delivery';\nexport function POST() { return send(); }\n");

  // Route that does NOT delegate (inline logic)
  writeFileSync(join(root, "apps/api/src/routes/assets.ts"),
    "import { query } from '@repo/db';\nexport function GET() { return query('SELECT * FROM assets'); }\n");

  // Logic-core files
  writeFileSync(join(root, "apps/api/src/lib/correlation-engine.ts"),
    "import { query } from '@repo/db';\nexport function correlate() { return query('SELECT 1'); }\n");
  writeFileSync(join(root, "apps/api/src/lib/anomaly-detector.ts"),
    "export function detect() { return []; }\n");
  writeFileSync(join(root, "apps/api/src/lib/notification-delivery.ts"),
    "export function send() { return true; }\n");

  // State-store packages
  writeFileSync(join(root, "packages/db/src/index.ts"),
    "export function query(sql) { return []; }\n");
  writeFileSync(join(root, "packages/logger/src/index.ts"),
    "export function log(msg) { console.log(msg); }\n");
  writeFileSync(join(root, "packages/cache/src/index.ts"),
    "export function get(key) { return null; }\n");

  // Middleware
  writeFileSync(join(root, "apps/api/src/middleware/auth.ts"),
    "export function auth(req, next) { return next(); }\n");

  // Web page (should NOT be checked for delegation)
  writeFileSync(join(root, "apps/web/app/dashboard/page.tsx"),
    "export default function Page() { return null; }\n");

  // Web API route
  writeFileSync(join(root, "apps/web/app/api/zabbix/ping/route.ts"),
    "export function GET() { return Response.json({ ok: true }); }\n");

  // Run scan
  const scan = scanProject(root);
  scan._rootDir = root;
  const arch = mapArchitecture(scan);

  console.log("=== LAYERS ===");
  console.log("ingress:", arch.layers.ingress.length);
  console.log("logic-core:", arch.layers.logicCore.length);
  console.log("state-store:", arch.layers.stateStore.length);
  console.log("unclassified:", arch.layers.unclassified.length);

  console.log("\n=== INGRESS ROUTES ===");
  for (const e of arch.layers.ingress.filter(e => e.subtype === "route")) {
    console.log(`  ${e.path}`);
  }

  console.log("\n=== LOGIC CORE ===");
  for (const e of arch.layers.logicCore) {
    console.log(`  ${e.path} (${e.type})`);
  }

  console.log("\n=== STATE STORE ===");
  for (const e of arch.layers.stateStore) {
    console.log(`  ${e.path} (${e.type})`);
  }

  console.log("\n=== DEPENDENCY GRAPH ===");
  console.log("edges:", arch.dependencyGraph.length);
  for (const e of arch.dependencyGraph) {
    console.log(`  ${e.from} (${e.from_layer}) -> ${e.to} (${e.to_layer})`);
  }

  console.log("\n=== BOUNDARY 2: DELEGATION ===");
  const deleg = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
  if (deleg) {
    console.log("violations:", deleg.violations.length);
    for (const v of deleg.violations) {
      console.log(`  ${v.file || "N/A"}: ${v.reason}`);
    }
  }

  console.log("\n=== ARCHITECTURE MAP MD ===");
  const md = generateArchitectureMap(arch, scan);
  console.log("has Dependency Graph section:", md.includes("## Dependency Graph"));
  console.log("has Feature Flags section:", md.includes("## Feature Flags"));
  console.log("MD lines:", md.split("\n").length);

  // Check specific issues
  console.log("\n=== ISSUE CHECKS ===");

  // 1. Dependency Graph should have edges
  console.log("1. Dependency Graph has edges:", arch.dependencyGraph.length > 0 ? "PASS" : "FAIL");

  // 2. correlation.ts should NOT be in delegation violations
  const corrViolation = deleg?.violations.find(v => v.file && v.file.includes("correlation"));
  console.log("2. correlation.ts not flagged:", !corrViolation ? "PASS" : "FAIL");

  // 3. anomaly.ts should NOT be in delegation violations
  const anomViolation = deleg?.violations.find(v => v.file && v.file.includes("anomaly"));
  console.log("3. anomaly.ts not flagged:", !anomViolation ? "PASS" : "FAIL");

  // 4. assets.ts (no delegation) SHOULD be in violations
  const assetsViolation = deleg?.violations.find(v => v.file && v.file.includes("assets"));
  console.log("4. assets.ts flagged (no delegation):", assetsViolation ? "PASS" : "FAIL");

  // 5. page.tsx should NOT be in delegation violations
  const pageViolation = deleg?.violations.find(v => v.file && v.file.includes("page.tsx"));
  console.log("5. page.tsx not flagged (frontend):", !pageViolation ? "PASS" : "FAIL");

  // 6. MD should have Dependency Graph section
  console.log("6. MD has Dependency Graph:", md.includes("## Dependency Graph") ? "PASS" : "FAIL");

  // 7. @repo/db import should create ingress -> state-store edge
  const repoEdges = arch.dependencyGraph.filter(e =>
    e.from_layer === "ingress" && e.to_layer === "state-store");
  console.log("7. @repo/db creates ingress->state-store edges:", repoEdges.length > 0 ? "PASS" : "FAIL");
  if (repoEdges.length === 0) {
    console.log("   state-store paths:", arch.layers.stateStore.map(e => e.path));
    // Check if @repo/db would match
    for (const p of arch.layers.stateStore.map(e => e.path)) {
      console.log("   " + p + " includes /packages/db/:", p.includes("/packages/db/"));
    }
  }

} finally {
  if (existsSync(root)) rmSync(root, { recursive: true, force: true });
}
