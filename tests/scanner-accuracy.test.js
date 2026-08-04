// tests/scanner-accuracy.test.js — Regression tests for real-project
// classification issues reported during validation (~85% match verdict).
// Covers: lib/components false positives, test files as routes, missing
// Next.js App Router routes, middleware vs route distinction, and runtime
// env var false positives in tech-debt.
import { describe, it, before, after } from "node:test";
import { strict as assert } from "node:assert";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { scanProject } from "../lib/context-scanner.js";
import { mapArchitecture, generateArchitectureMap } from "../lib/architecture-mapper.js";
import { scanTechDebt, analyzeFileComplexity } from "../lib/tech-debt-scanner.js";
import { classifyPath, isTestFile, isRuntimeEnvVar, tokenizePath } from "../lib/classification.js";

let root;

before(() => {
  root = mkdtempSync(join(tmpdir(), "zero-error-acc-"));

  // lib/api-client.ts — utility exporting a function. Must NOT be a component.
  mkdirSync(join(root, "lib"), { recursive: true });
  writeFileSync(
    join(root, "lib", "api-client.ts"),
    "export function apiClient() { return fetch('/api'); }\nexport const x = 1;\n"
  );

  // lib/use-push-notifications.ts — hook-like util in lib/. Must NOT be a component.
  writeFileSync(
    join(root, "lib", "use-push-notifications.ts"),
    "export function usePushNotifications() { return { subscribe() {} }; }\n"
  );

  // components/logout-button.tsx — real React component. SHOULD be a component.
  mkdirSync(join(root, "components"), { recursive: true });
  writeFileSync(
    join(root, "components", "logout-button.tsx"),
    "export function LogoutButton() { return <button>Logout</button>; }\n"
  );

  // middleware/audit.ts — middleware, not a route.
  mkdirSync(join(root, "middleware"), { recursive: true });
  writeFileSync(
    join(root, "middleware", "audit.ts"),
    "export function audit(req, res, next) { next(); }\n"
  );

  // app/api/users/[id]/route.ts — Next.js App Router handler. SHOULD be a route.
  mkdirSync(join(root, "app", "api", "users", "[id]"), { recursive: true });
  writeFileSync(
    join(root, "app", "api", "users", "[id]", "route.ts"),
    "export async function GET(req) { return Response.json({}); }\nexport async function DELETE(req) { return Response.json({}); }\n"
  );

  // routes/chatops.ts — Express-style route. SHOULD be a route.
  mkdirSync(join(root, "routes"), { recursive: true });
  writeFileSync(
    join(root, "routes", "chatops.ts"),
    "import express from 'express';\nconst router = express.Router();\nrouter.get('/chatops', (req, res) => res.send('ok'));\nexport default router;\n"
  );

  // tests/validate.test.ts — test file containing a route pattern. Must NOT be a route.
  mkdirSync(join(root, "tests"), { recursive: true });
  writeFileSync(
    join(root, "tests", "validate.test.ts"),
    "import { app } from '../app';\ntest('x', () => { app.get('/health', (req,res) => res.send('ok')); });\n"
  );

  // src/index.ts referencing runtime env vars (npm_package_version, CI).
  mkdirSync(join(root, "src"), { recursive: true });
  writeFileSync(
    join(root, "src", "index.ts"),
    "const v = process.env.npm_package_version;\nconst isCI = process.env.CI;\nconst real = process.env.DATABASE_URL;\n"
  );

  // .env.example missing DATABASE_URL (so DATABASE_URL is a legit orphan),
  // and NOT declaring npm_package_version / CI (those are runtime, must be ignored).
  writeFileSync(join(root, ".env.example"), "NODE_ENV=production\n");
});

after(() => {
  if (root && existsSync(root)) rmSync(root, { recursive: true, force: true });
});

describe("context-scanner: component false positives", () => {
  it("does not classify lib/*.ts utility exports as components", () => {
    const scan = scanProject(root);
    const componentFiles = scan.components.map(c => c.file);
    assert.ok(componentFiles.includes("components/logout-button.tsx"), "real component detected");
    assert.ok(!componentFiles.includes("lib/api-client.ts"), "lib/api-client.ts must NOT be a component");
    assert.ok(!componentFiles.includes("lib/use-push-notifications.ts"), "lib/use-push-notifications.ts must NOT be a component");
  });
});

describe("context-scanner: test files are not routes", () => {
  it("skips tests/validate.test.ts even though it contains app.get(...)", () => {
    const scan = scanProject(root);
    const routeFiles = scan.routes.map(r => r.file);
    assert.ok(!routeFiles.includes("tests/validate.test.ts"), "test file must not be a route");
    assert.ok(routeFiles.includes("routes/chatops.ts"), "real express route detected");
  });
});

describe("context-scanner: Next.js App Router detection", () => {
  it("detects app/api/users/[id]/route.ts as a nextjs_app route with derived path", () => {
    const scan = scanProject(root);
    const route = scan.routes.find(r => r.file === "app/api/users/[id]/route.ts");
    assert.ok(route, "Next.js App Router route must be detected");
    const methods = route.endpoints.map(e => e.method).sort();
    assert.deepEqual(methods, ["DELETE", "GET"]);
    assert.equal(route.endpoints[0].framework, "nextjs_app");
    const path = route.endpoints[0].path;
    assert.ok(path === "/api/users/:id", `derived path should be /api/users/:id, got ${path}`);
  });
});

describe("architecture-mapper: ingress classification", () => {
  it("keeps lib/ out of ingress, puts middleware in ingress, routes in ingress", () => {
    const scan = scanProject(root);
    const arch = mapArchitecture(scan);
    const paths = (layer) => arch.layers[layer].map(e => e.path);

    assert.ok(!paths("ingress").includes("lib/api-client.ts"), "lib/api-client.ts must NOT be ingress");
    assert.ok(!paths("ingress").includes("lib/use-push-notifications.ts"), "lib hook must NOT be ingress");
    assert.ok(!paths("ingress").includes("tests/validate.test.ts"), "test file must NOT be ingress");
    assert.ok(paths("ingress").includes("middleware/audit.ts"), "middleware should be ingress");
    assert.ok(paths("ingress").includes("app/api/users/[id]/route.ts"), "Next.js route should be ingress");
    assert.ok(paths("ingress").includes("routes/chatops.ts"), "express route should be ingress");
    assert.ok(paths("ingress").includes("components/logout-button.tsx"), "component should be ingress (presentation)");
  });

  it("tags middleware with subtype middleware and routes with subtype route", () => {
    const scan = scanProject(root);
    const arch = mapArchitecture(scan);
    const find = (p) => arch.layers.ingress.find(e => e.path === p);
    assert.equal(find("middleware/audit.ts").subtype, "middleware");
    assert.equal(find("app/api/users/[id]/route.ts").subtype, "route");
    assert.equal(find("routes/chatops.ts").subtype, "route");
    assert.equal(find("components/logout-button.tsx").subtype, "component");
  });

  it("renders architecture map with grouped ingress subtypes", () => {
    const scan = scanProject(root);
    const arch = mapArchitecture(scan);
    const md = generateArchitectureMap(arch, scan);
    assert.ok(md.includes("### Routes & Handlers"), "routes group present");
    assert.ok(md.includes("### Middleware"), "middleware group present");
    assert.ok(md.includes("### Components & Views"), "components group present");
    // lib file must not appear anywhere in the map ingress section
    const ingressSection = md.split("## Logic Core")[0];
    assert.ok(!ingressSection.includes("lib/api-client.ts"), "lib file must not appear in ingress");
  });
});

describe("tech-debt-scanner: runtime env var false positives", () => {
  it("does not flag npm_package_version or CI as orphan env vars", () => {
    const scan = scanProject(root);
    const debt = scanTechDebt(root, scan);
    const orphanNames = debt.findings
      .filter(f => f.type === "orphan_env_var")
      .map(f => f.env_var);
    assert.ok(!orphanNames.includes("npm_package_version"), "npm_package_version is runtime, not orphan");
    assert.ok(!orphanNames.includes("CI"), "CI is runtime, not orphan");
    // DATABASE_URL is genuinely referenced and not in .env.example -> legit orphan.
    assert.ok(orphanNames.includes("DATABASE_URL"), "DATABASE_URL should be flagged as orphan");
  });
});

// ---------------------------------------------------------------------------
// Unit tests for the token-based scoring classifier (lib/classification.js).
// These test the ROOT FIX directly — no filesystem, no scanner, just the
// classifier logic.
// ---------------------------------------------------------------------------

describe("classification: tokenizePath", () => {
  it("splits path into whole-word tokens", () => {
    // Extension tokens (ts, js) are included but harmless — no signal token
    // matches them, so they don't affect classification.
    assert.deepEqual(tokenizePath("lib/api-client.ts"), ["lib", "api", "client", "ts"]);
    assert.deepEqual(tokenizePath("app/api/users/[id]/route.ts"), ["app", "api", "users", "id", "route", "ts"]);
    assert.deepEqual(tokenizePath("middleware/audit.ts"), ["middleware", "audit", "ts"]);
  });
});

describe("classification: isTestFile", () => {
  it("detects test files by directory and extension", () => {
    assert.ok(isTestFile("tests/validate.test.ts"));
    assert.ok(isTestFile("src/__tests__/foo.spec.js"));
    assert.ok(isTestFile("lib/utils.test.ts"));
    assert.ok(isTestFile("spec/integration.bench.js"));
    assert.ok(!isTestFile("lib/api-client.ts"));
    assert.ok(!isTestFile("routes/chatops.ts"));
  });
});

describe("classification: isRuntimeEnvVar", () => {
  it("detects runtime/CI/npm env vars", () => {
    assert.ok(isRuntimeEnvVar("npm_package_version"));
    assert.ok(isRuntimeEnvVar("CI"));
    assert.ok(isRuntimeEnvVar("GITHUB_REPOSITORY"));
    assert.ok(isRuntimeEnvVar("RUNNER_OS"));
    assert.ok(isRuntimeEnvVar("npm_config_user_agent"));
    assert.ok(!isRuntimeEnvVar("DATABASE_URL"));
    assert.ok(!isRuntimeEnvVar("JWT_SECRET"));
    assert.ok(!isRuntimeEnvVar("GOOGLE_OAUTH_CLIENT_ID"));
  });
});

describe("classification: classifyPath — root cause cases", () => {
  // The original scanner used /api/i, /route/i, /view/i, /handler/i as
  // substring regex on filenames. These tests verify that the token-based
  // scorer does NOT reproduce those false positives.

  it("does NOT classify lib/api-client.ts as ingress (was: /api/i substring match)", () => {
    const r = classifyPath("lib/api-client.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("does NOT classify lib/itsm-connector.ts as ingress", () => {
    const r = classifyPath("lib/itsm-connector.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("does NOT classify lib/use-push-notifications.ts as ingress", () => {
    const r = classifyPath("lib/use-push-notifications.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("does NOT classify lib/notification-delivery.ts as ingress", () => {
    const r = classifyPath("lib/notification-delivery.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("classifies middleware/audit.ts as ingress/middleware", () => {
    const r = classifyPath("middleware/audit.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "middleware");
  });

  it("classifies middleware/cors.ts as ingress/middleware", () => {
    const r = classifyPath("middleware/cors.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "middleware");
  });

  it("classifies middleware/require-permission.ts as ingress/middleware", () => {
    const r = classifyPath("middleware/require-permission.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "middleware");
  });

  it("classifies components/logout-button.tsx as ingress/component", () => {
    const r = classifyPath("components/logout-button.tsx", "component");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "component");
  });

  it("classifies components/device-detail-client.tsx as ingress/component", () => {
    const r = classifyPath("components/device-detail-client.tsx", "component");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "component");
  });

  it("classifies app/api/keys/route.ts as ingress/route (Next.js App Router)", () => {
    const r = classifyPath("app/api/keys/route.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("classifies app/api/traces/route.ts as ingress/route", () => {
    const r = classifyPath("app/api/traces/route.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("classifies app/api/ws/route.ts as ingress/route", () => {
    const r = classifyPath("app/api/ws/route.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("classifies routes/chatops.ts as ingress/route", () => {
    const r = classifyPath("routes/chatops.ts", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("classifies controllers/user_controller.ts as ingress/route", () => {
    const r = classifyPath("controllers/user_controller.ts", "source");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("classifies services/user.service.ts as logic-core", () => {
    const r = classifyPath("services/user.service.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies models/user.model.ts as state-store", () => {
    const r = classifyPath("models/user.model.ts", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies tests/validate.test.ts as unclassified (test file)", () => {
    const r = classifyPath("tests/validate.test.ts", "route");
    assert.equal(r.layer, "unclassified");
  });

  it("classifies __tests__/route.spec.js as unclassified (test file)", () => {
    const r = classifyPath("__tests__/route.spec.js", "route");
    assert.equal(r.layer, "unclassified");
  });

  it("classifies package.json as unclassified (config file)", () => {
    const r = classifyPath("package.json", "source");
    assert.equal(r.layer, "unclassified");
  });

  it("classifies .env.example as unclassified (config file)", () => {
    const r = classifyPath(".env.example", "source");
    assert.equal(r.layer, "unclassified");
  });

  it("does NOT classify lib/error-handler.ts as ingress (handler is ambiguous)", () => {
    const r = classifyPath("lib/error-handler.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("does NOT classify utils/review-helper.ts as ingress (view substring in review)", () => {
    const r = classifyPath("utils/review-helper.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("does NOT classify lib/resource-manager.ts as ingress (resource substring)", () => {
    const r = classifyPath("lib/resource-manager.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });

  it("a real router in lib/ CAN be ingress if scanner detected route content (strong signal overcomes penalty)", () => {
    // scanner type "route" = +5, lib/ penalty = -3, net = +2 > 0 → ingress
    const r = classifyPath("lib/router-setup.ts", "route");
    assert.equal(r.layer, "ingress");
  });

  it("returns unclassified for ambiguous files with no strong signal", () => {
    const r = classifyPath("src/utils.ts", "source");
    assert.equal(r.layer, "unclassified");
  });

  it("returns confidence > 0 for classified files", () => {
    const r = classifyPath("routes/chatops.ts", "route");
    assert.ok(r.confidence > 0, `confidence should be positive, got ${r.confidence}`);
  });
});

// ---------------------------------------------------------------------------
// Round 2 fixes — based on real-project validation feedback (~60% accuracy).
// ---------------------------------------------------------------------------

describe("classification: scripts and docs excluded from architecture", () => {
  it("excludes .ps1 script files", () => {
    assert.equal(classifyPath("test-zabbix-curl.ps1", "source").layer, "unclassified");
    assert.equal(classifyPath("scripts/deploy.ps1", "source").layer, "unclassified");
  });

  it("excludes .sh script files", () => {
    assert.equal(classifyPath("scripts/deploy.sh", "source").layer, "unclassified");
  });

  it("excludes ALL .md files (not just readme/license)", () => {
    assert.equal(classifyPath("ARCHITECTURE.md", "source").layer, "unclassified");
    assert.equal(classifyPath("TECHNICAL-GUIDE.md", "source").layer, "unclassified");
    assert.equal(classifyPath("docs/SCHEMA.md", "source").layer, "unclassified");
  });

  it("excludes temp files (tmp-*)", () => {
    assert.equal(classifyPath("tmp-e2e-test.mjs", "source").layer, "unclassified");
    assert.equal(classifyPath("tmp-endpoints.txt", "source").layer, "unclassified");
  });

  it("excludes test script files (test-*.mjs, test-*.ps1)", () => {
    assert.equal(classifyPath("test-new-routes.mjs", "source").layer, "unclassified");
    assert.equal(classifyPath("test-zabbix-methods.mjs", "source").layer, "unclassified");
    assert.equal(classifyPath("test-new-routes.ps1", "source").layer, "unclassified");
  });
});

describe("classification: business logic in lib/ detected as logic-core", () => {
  it("classifies lib/alerting-engine.ts as logic-core", () => {
    const r = classifyPath("lib/alerting-engine.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/correlation-engine.ts as logic-core", () => {
    const r = classifyPath("lib/correlation-engine.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/anomaly-detector.ts as logic-core", () => {
    const r = classifyPath("lib/anomaly-detector.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/failure-predictor.ts as logic-core", () => {
    const r = classifyPath("lib/failure-predictor.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/health-score.ts as logic-core", () => {
    const r = classifyPath("lib/health-score.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/itsm-connector.ts as logic-core", () => {
    const r = classifyPath("lib/itsm-connector.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/notification-delivery.ts as logic-core", () => {
    const r = classifyPath("lib/notification-delivery.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/report-generator.ts as logic-core", () => {
    const r = classifyPath("lib/report-generator.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/task-scheduler.ts as logic-core", () => {
    const r = classifyPath("lib/task-scheduler.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/device-sync.ts as logic-core", () => {
    const r = classifyPath("lib/device-sync.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/metrics-collector.ts as logic-core", () => {
    const r = classifyPath("lib/metrics-collector.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/web-push.ts as logic-core (delivery signal)", () => {
    // "push" is not a token, but "web" is not a signal either.
    // This file may stay unclassified — that's OK, not everything in lib/
    // can be classified. The important ones (engine, detector, etc.) work.
    const r = classifyPath("lib/web-push.ts", "source");
    // web-push doesn't have a strong logic-core token, so it may be unclassified
    // This is acceptable — we don't want to over-classify
    assert.ok(r.layer === "logic-core" || r.layer === "unclassified",
      `web-push should be logic-core or unclassified, got ${r.layer}`);
  });

  it("classifies lib/downsample.ts as logic-core", () => {
    const r = classifyPath("lib/downsample.ts", "source");
    assert.equal(r.layer, "logic-core");
  });

  it("classifies lib/lifecycle.ts as logic-core", () => {
    const r = classifyPath("lib/lifecycle.ts", "source");
    assert.equal(r.layer, "logic-core");
  });
});

describe("classification: runtime env vars expanded", () => {
  it("detects NEXT_RUNTIME as runtime env var", () => {
    assert.ok(isRuntimeEnvVar("NEXT_RUNTIME"));
  });

  it("detects SKIP_ENV_VALIDATION as runtime env var", () => {
    assert.ok(isRuntimeEnvVar("SKIP_ENV_VALIDATION"));
  });

  it("detects FEATURE_NEW_DASHBOARD as runtime env var", () => {
    assert.ok(isRuntimeEnvVar("FEATURE_NEW_DASHBOARD"));
  });

  it("detects ENABLE_REACT_COMPILER as runtime env var", () => {
    assert.ok(isRuntimeEnvVar("ENABLE_REACT_COMPILER"));
  });

  it("does NOT detect DATABASE_URL as runtime env var", () => {
    assert.ok(!isRuntimeEnvVar("DATABASE_URL"));
  });

  it("does NOT detect JWT_PRIVATE_KEY as runtime env var", () => {
    assert.ok(!isRuntimeEnvVar("JWT_PRIVATE_KEY"));
  });
});

// ---------------------------------------------------------------------------
// Round 3 fixes — based on ~85% accuracy validation feedback.
// ---------------------------------------------------------------------------

describe("classification: barrel files (index.ts) not classified as routes", () => {
  it("does NOT classify packages/api/src/index.ts as route even with route type", () => {
    const r = classifyPath("packages/api/src/index.ts", "route");
    assert.notEqual(r.layer, "ingress");
    assert.notEqual(r.subtype, "route");
  });

  it("does NOT classify packages/db/src/index.ts as route even with route type", () => {
    const r = classifyPath("packages/db/src/index.ts", "route");
    assert.notEqual(r.layer, "ingress");
    assert.notEqual(r.subtype, "route");
  });

  it("DOES classify apps/api/src/index.ts as route when scanner detected route content (real API entry point)", () => {
    // This is the main API entry point — it creates the Hono/Express app
    // and mounts routes. It should be classified as ingress/route.
    const r = classifyPath("apps/api/src/index.ts", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("does NOT classify apps/api/src/index.ts as route when scanner type is source (barrel file)", () => {
    // Without route content, it's a barrel file, not a route handler
    const r = classifyPath("apps/api/src/index.ts", "source");
    assert.notEqual(r.layer, "ingress");
  });
});

describe("classification: components in components/ dir not overridden by route type", () => {
  it("classifies components/logout-button.tsx as component even with false route type", () => {
    const r = classifyPath("components/logout-button.tsx", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "component");
  });

  it("classifies components/device-detail-client.tsx as component even with false route type", () => {
    const r = classifyPath("components/device-detail-client.tsx", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "component");
  });
});

describe("classification: check-* scripts excluded", () => {
  it("excludes check-zabbix-config.js", () => {
    assert.equal(classifyPath("check-zabbix-config.js", "source").layer, "unclassified");
    assert.equal(classifyPath("check-zabbix-config.js", "route").layer, "unclassified");
  });
});

describe("classification: apply/register scripts excluded", () => {
  it("excludes apply-migrations.mjs", () => {
    assert.equal(classifyPath("apply-migrations.mjs", "source").layer, "unclassified");
  });

  it("excludes register-migration.mjs", () => {
    assert.equal(classifyPath("register-migration.mjs", "source").layer, "unclassified");
  });
});

describe("classification: sentry config not logic-core", () => {
  it("does NOT classify sentry.client.config.ts as logic-core", () => {
    const r = classifyPath("sentry.client.config.ts", "source");
    assert.notEqual(r.layer, "logic-core");
  });

  it("does NOT classify next.config.ts as logic-core", () => {
    const r = classifyPath("next.config.ts", "source");
    assert.notEqual(r.layer, "logic-core");
  });
});

describe("classification: web-push.ts as logic-core", () => {
  it("classifies lib/web-push.ts as logic-core", () => {
    const r = classifyPath("lib/web-push.ts", "source");
    assert.equal(r.layer, "logic-core");
  });
});

describe("classification: SQL migration timestamp files", () => {
  it("classifies 20260725190000_firewall_rules.sql as state-store", () => {
    const r = classifyPath("migrations/20260725190000_firewall_rules.sql", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies 20260725310000_webhook_management.sql as state-store", () => {
    const r = classifyPath("migrations/20260725310000_webhook_management.sql", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies timestamp SQL in drizzle/ as state-store", () => {
    const r = classifyPath("drizzle/20260725190000_firewall_rules.sql", "source");
    assert.equal(r.layer, "state-store");
  });
});

describe("classification: runtime env vars expanded (round 3)", () => {
  it("detects ANALYZE as runtime env var", () => {
    assert.ok(isRuntimeEnvVar("ANALYZE"));
  });

  it("detects BUILD_STANDALONE as runtime env var", () => {
    assert.ok(isRuntimeEnvVar("BUILD_STANDALONE"));
  });
});

// ---------------------------------------------------------------------------
// Round 4 fixes — based on ~92% accuracy validation feedback.
// ---------------------------------------------------------------------------

describe("classification: React hooks excluded from logic-core", () => {
  it("does NOT classify lib/use-push-notifications.ts as logic-core", () => {
    const r = classifyPath("lib/use-push-notifications.ts", "source");
    assert.notEqual(r.layer, "logic-core");
  });

  it("does NOT classify lib/use-auth.ts as logic-core", () => {
    const r = classifyPath("lib/use-auth.ts", "source");
    assert.notEqual(r.layer, "logic-core");
  });

  it("DOES classify lib/web-push.ts as logic-core (not a hook)", () => {
    const r = classifyPath("lib/web-push.ts", "source");
    assert.equal(r.layer, "logic-core");
  });
});

describe("classification: app entry point vs barrel file", () => {
  it("classifies apps/api/src/index.ts with route type as ingress/route", () => {
    const r = classifyPath("apps/api/src/index.ts", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "route");
  });

  it("does NOT classify packages/api/src/index.ts with route type as ingress (barrel)", () => {
    const r = classifyPath("packages/api/src/index.ts", "route");
    assert.notEqual(r.layer, "ingress");
  });

  it("does NOT classify packages/db/src/index.ts with route type as ingress (barrel)", () => {
    const r = classifyPath("packages/db/src/index.ts", "route");
    assert.notEqual(r.layer, "ingress");
  });
});

// ---------------------------------------------------------------------------
// Round 5 fixes — infrastructure packages + pino unused dep.
// ---------------------------------------------------------------------------

describe("classification: infrastructure packages in state-store", () => {
  it("classifies packages/logger/src/index.ts as state-store", () => {
    const r = classifyPath("packages/logger/src/index.ts", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies packages/telemetry/src/index.ts as state-store", () => {
    const r = classifyPath("packages/telemetry/src/index.ts", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies packages/secrets/src/index.ts as state-store", () => {
    const r = classifyPath("packages/secrets/src/index.ts", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies packages/db/src/index.ts as state-store", () => {
    const r = classifyPath("packages/db/src/index.ts", "source");
    assert.equal(r.layer, "state-store");
  });

  it("classifies packages/cache/src/index.ts as state-store", () => {
    const r = classifyPath("packages/cache/src/index.ts", "source");
    assert.equal(r.layer, "state-store");
  });
});

// ---------------------------------------------------------------------------
// Round 6 fixes — delegation analysis + connector directory-awareness.
// ---------------------------------------------------------------------------

describe("classification: connector token is directory-aware", () => {
  it("classifies lib/itsm-connector.ts as logic-core/integration (external system integration)", () => {
    const r = classifyPath("lib/itsm-connector.ts", "source");
    assert.equal(r.layer, "logic-core");
    assert.equal(r.subtype, "integration");
  });

  it("classifies lib/external-connector.ts as logic-core/integration", () => {
    const r = classifyPath("lib/external-connector.ts", "source");
    assert.equal(r.layer, "logic-core");
    assert.equal(r.subtype, "integration");
  });

  it("classifies services/data-connector.ts as logic-core/integration (in services/)", () => {
    const r = classifyPath("services/data-connector.ts", "source");
    assert.equal(r.layer, "logic-core");
    assert.equal(r.subtype, "integration");
  });

  it("classifies data/db-connector.ts as logic-core/data-access (in data/)", () => {
    const r = classifyPath("data/db-connector.ts", "source");
    assert.equal(r.layer, "logic-core");
    assert.equal(r.subtype, "data-access");
  });

  it("classifies packages/db/src/connector.ts as state-store (infra pkg overrides connector)", () => {
    // packages/db/ is an infrastructure package — the infra-pkg signal (weight 4)
    // correctly classifies it as state-store, not logic-core, even with "connector" token
    const r = classifyPath("packages/db/src/connector.ts", "source");
    assert.equal(r.layer, "state-store");
  });
});

describe("architecture-mapper: delegation boundary analysis", () => {
  let delegRoot;

  before(() => {
    delegRoot = mkdtempSync(join(tmpdir(), "zero-error-deleg-"));

    // Route that delegates to logic-core (imports from lib/)
    mkdirSync(join(delegRoot, "routes"), { recursive: true });
    mkdirSync(join(delegRoot, "lib"), { recursive: true });
    writeFileSync(
      join(delegRoot, "routes", "good-route.ts"),
      "import { processOrder } from '../lib/order-processor';\nexport function GET() { return processOrder(); }\n"
    );
    writeFileSync(
      join(delegRoot, "lib", "order-processor.ts"),
      "export function processOrder() { return { ok: true }; }\n"
    );

    // Route that does NOT delegate (inline logic, no lib/ import)
    writeFileSync(
      join(delegRoot, "routes", "bad-route.ts"),
      "export function GET() {\n  const result = doEverythingInline();\n  return result;\n}\nfunction doEverythingInline() { return { ok: false }; }\n"
    );
  });

  after(() => {
    if (delegRoot && existsSync(delegRoot)) rmSync(delegRoot, { recursive: true, force: true });
  });

  it("detects routes that don't delegate to Logic Core as violations", () => {
    const scan = scanProject(delegRoot);
    scan._rootDir = delegRoot;
    const arch = mapArchitecture(scan);
    const delegBoundary = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
    assert.ok(delegBoundary, "delegation boundary must exist");

    const violationFiles = delegBoundary.violations.map(v => v.file);
    assert.ok(violationFiles.includes("routes/bad-route.ts"),
      "bad-route.ts (no lib/ import) should be flagged as not delegating");
    assert.ok(!violationFiles.includes("routes/good-route.ts"),
      "good-route.ts (imports from lib/) should NOT be flagged");
  });
});

// ---------------------------------------------------------------------------
// Round 7 fixes — middleware.ts, index.tsx barrel, test files in critical paths.
// ---------------------------------------------------------------------------

describe("classification: Next.js root middleware.ts", () => {
  it("classifies middleware.ts as ingress/middleware even with route type", () => {
    const r = classifyPath("middleware.ts", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "middleware");
  });

  it("classifies src/middleware.ts as ingress/middleware even with route type", () => {
    const r = classifyPath("src/middleware.ts", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "middleware");
  });

  it("classifies apps/web/middleware.ts as ingress/middleware even with route type", () => {
    const r = classifyPath("apps/web/middleware.ts", "route");
    assert.equal(r.layer, "ingress");
    assert.equal(r.subtype, "middleware");
  });
});

describe("classification: package index.tsx not a component", () => {
  it("does NOT classify packages/ui/src/index.tsx as component", () => {
    const r = classifyPath("packages/ui/src/index.tsx", "component");
    assert.notEqual(r.subtype, "component");
  });

  it("does NOT classify packages/ui/src/index.ts as component", () => {
    const r = classifyPath("packages/ui/src/index.ts", "component");
    assert.notEqual(r.subtype, "component");
  });
});

// ---------------------------------------------------------------------------
// Round 8 features — circular deps, complexity, dependency graph, feature flags.
// ---------------------------------------------------------------------------

describe("feature 8: circular dependency detection", () => {
  let cycleRoot;

  before(() => {
    cycleRoot = mkdtempSync(join(tmpdir(), "zero-error-cycle-"));
    mkdirSync(join(cycleRoot, "lib"), { recursive: true });

    // A → B → C → A (circular)
    writeFileSync(join(cycleRoot, "lib", "a.ts"),
      "import { b } from './b';\nexport function a() { return b(); }\n");
    writeFileSync(join(cycleRoot, "lib", "b.ts"),
      "import { c } from './c';\nexport function b() { return c(); }\n");
    writeFileSync(join(cycleRoot, "lib", "c.ts"),
      "import { a } from './a';\nexport function c() { return a(); }\n");

    // D → E (no cycle, control)
    writeFileSync(join(cycleRoot, "lib", "d.ts"),
      "import { e } from './e';\nexport function d() { return e(); }\n");
    writeFileSync(join(cycleRoot, "lib", "e.ts"),
      "export function e() { return 42; }\n");
  });

  after(() => {
    if (cycleRoot && existsSync(cycleRoot)) rmSync(cycleRoot, { recursive: true, force: true });
  });

  it("detects circular dependency A → B → C → A", () => {
    const result = scanTechDebt(cycleRoot, { _rootDir: cycleRoot, allScannedFiles: [], monorepo: false, envVars: [] });
    const circularFindings = result.findings.filter(f => f.type === "circular_dependency");
    assert.ok(circularFindings.length > 0, "should detect at least one circular dependency");
    const cycleMsg = circularFindings.map(f => f.message).join(" ");
    assert.ok(cycleMsg.includes("a") && cycleMsg.includes("b") && cycleMsg.includes("c"),
      "cycle should involve a, b, and c");
  });
});

describe("feature 9: file complexity analysis", () => {
  let complexityRoot;

  before(() => {
    complexityRoot = mkdtempSync(join(tmpdir(), "zero-error-complex-"));
    mkdirSync(join(complexityRoot, "lib"), { recursive: true });

    // Simple file (low complexity)
    writeFileSync(join(complexityRoot, "lib", "simple.ts"),
      "export function add(a, b) {\n  return a + b;\n}\n");

    // Complex file (many branches)
    writeFileSync(join(complexityRoot, "lib", "complex.ts"),
      `export function process(data) {
  if (data.type === 'a') {
    for (const item of data.items) {
      if (item.active) {
        switch (item.status) {
          case 'ok': break;
          case 'err': try { handle(item); } catch (e) { log(e); } break;
          default: if (item.retry) { while (item.count > 0) { item.count--; } }
        }
      }
    }
  } else if (data.type === 'b') {
    return data.value || data.fallback;
  }
  return true;
}
`);
  });

  after(() => {
    if (complexityRoot && existsSync(complexityRoot)) rmSync(complexityRoot, { recursive: true, force: true });
  });

  it("analyzes simple file with low complexity", () => {
    const result = analyzeFileComplexity(join(complexityRoot, "lib", "simple.ts"));
    assert.ok(result);
    assert.ok(result.loc > 0);
    assert.equal(result.complexity_label, "low");
    assert.ok(result.cyclomatic_complexity <= 5);
  });

  it("analyzes complex file with high complexity", () => {
    const result = analyzeFileComplexity(join(complexityRoot, "lib", "complex.ts"));
    assert.ok(result);
    assert.ok(result.cyclomatic_complexity > 5, `complexity should be > 5, got ${result.cyclomatic_complexity}`);
    assert.ok(result.complexity_label === "medium" || result.complexity_label === "high" || result.complexity_label === "very-high");
  });

  it("returns null for non-existent file", () => {
    const result = analyzeFileComplexity(join(complexityRoot, "nonexistent.ts"));
    assert.equal(result, null);
  });
});

describe("feature 11: dependency graph between layers", () => {
  let graphRoot;

  before(() => {
    graphRoot = mkdtempSync(join(tmpdir(), "zero-error-graph-"));
    mkdirSync(join(graphRoot, "routes"), { recursive: true });
    mkdirSync(join(graphRoot, "lib"), { recursive: true });
    mkdirSync(join(graphRoot, "db"), { recursive: true });

    // Route imports from lib (ingress → logic-core)
    writeFileSync(join(graphRoot, "routes", "users.ts"),
      "import { getUser } from '../lib/user-service';\nexport function GET() { return getUser(); }\n");
    // Logic core imports from db (logic-core → state-store)
    writeFileSync(join(graphRoot, "lib", "user-service.ts"),
      "import { query } from '../db/client';\nexport function getUser() { return query('SELECT 1'); }\n");
    writeFileSync(join(graphRoot, "db", "client.ts"),
      "export function query(sql) { return []; }\n");
  });

  after(() => {
    if (graphRoot && existsSync(graphRoot)) rmSync(graphRoot, { recursive: true, force: true });
  });

  it("builds real dependency graph with cross-layer edges", () => {
    const scan = scanProject(graphRoot);
    scan._rootDir = graphRoot;
    const arch = mapArchitecture(scan);
    assert.ok(arch.dependencyGraph, "dependency graph should exist");
    assert.ok(arch.dependencyGraph.length > 0, "should have at least one edge");

    // Should have ingress → logic-core edge
    const ingressToLogic = arch.dependencyGraph.filter(e =>
      e.from_layer === "ingress" && e.to_layer === "logic-core");
    assert.ok(ingressToLogic.length > 0, "should have ingress → logic-core edge");

    // Should have logic-core → state-store edge
    const logicToState = arch.dependencyGraph.filter(e =>
      e.from_layer === "logic-core" && e.to_layer === "state-store");
    assert.ok(logicToState.length > 0, "should have logic-core → state-store edge");
  });

  it("renders dependency graph section in architecture map", () => {
    const scan = scanProject(graphRoot);
    scan._rootDir = graphRoot;
    const arch = mapArchitecture(scan);
    const md = generateArchitectureMap(arch, scan);
    assert.ok(md.includes("## Dependency Graph"), "map should have Dependency Graph section");
    assert.ok(md.includes("Ingress") && md.includes("Logic Core"),
      "map should show layer names in graph");
  });
});

// ---------------------------------------------------------------------------
// Round 9 fixes — feature flag false positive, @/ path alias, @repo/ matching.
// ---------------------------------------------------------------------------

describe("feature flag detector: excludes TypeScript type definitions", () => {
  let flagRoot;

  before(() => {
    flagRoot = mkdtempSync(join(tmpdir(), "zero-error-flag-"));
    mkdirSync(join(flagRoot, "lib"), { recursive: true });

    // TypeScript interface that should NOT be detected as feature flags
    writeFileSync(join(flagRoot, "lib", "types.ts"),
      `export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  flag_type: string;
  is_active: boolean;
  created_at: Date;
}

export type FlagConfig = {
  features: {
    id: string;
    key: string;
  };
};
`);

    // Real feature flag usage that SHOULD be detected
    writeFileSync(join(flagRoot, "lib", "flags.ts"),
      `if (process.env.FEATURE_NEW_DASHBOARD === 'true') {
  enableNewDashboard();
}
`);
  });

  after(() => {
    if (flagRoot && existsSync(flagRoot)) rmSync(flagRoot, { recursive: true, force: true });
  });

  it("does NOT detect TypeScript type fields as feature flags", async () => {
    const { detectFeatureFlags } = await import("../lib/feature-flag-detector.js");
    const result = detectFeatureFlags(flagRoot);
    const flagNames = result.flags.map(f => f.name);
    // Should NOT contain schema field names like "id", "key", "name"
    assert.ok(!flagNames.includes("id"), "should not detect 'id' as a flag");
    assert.ok(!flagNames.includes("key"), "should not detect 'key' as a flag");
    assert.ok(!flagNames.includes("name"), "should not detect 'name' as a flag");
    assert.ok(!flagNames.includes("flag_type"), "should not detect 'flag_type' as a flag");
  });

  it("DOES detect real feature flags from env vars", async () => {
    const { detectFeatureFlags } = await import("../lib/feature-flag-detector.js");
    const result = detectFeatureFlags(flagRoot);
    const flagNames = result.flags.map(f => f.name);
    assert.ok(flagNames.some(n => n.includes("NEW_DASHBOARD")),
      "should detect FEATURE_NEW_DASHBOARD");
  });
});

describe("delegation checker: @/ path alias support", () => {
  let aliasRoot;

  before(() => {
    aliasRoot = mkdtempSync(join(tmpdir(), "zero-error-alias-"));
    mkdirSync(join(aliasRoot, "apps", "api", "src", "routes"), { recursive: true });
    mkdirSync(join(aliasRoot, "apps", "api", "src", "lib"), { recursive: true });

    // Route uses @/ path alias to import from lib/
    writeFileSync(join(aliasRoot, "apps", "api", "src", "routes", "correlation.ts"),
      "import { correlate } from '@/lib/correlation-engine';\nexport function GET() { return correlate(); }\n"
    );
    writeFileSync(join(aliasRoot, "apps", "api", "src", "lib", "correlation-engine.ts"),
      "export function correlate() { return []; }\n"
    );
  });

  after(() => {
    if (aliasRoot && existsSync(aliasRoot)) rmSync(aliasRoot, { recursive: true, force: true });
  });

  it("recognizes @/ path alias as delegation to Logic Core", () => {
    const scan = scanProject(aliasRoot);
    scan._rootDir = aliasRoot;
    const arch = mapArchitecture(scan);
    const delegBoundary = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
    assert.ok(delegBoundary);
    const violationFiles = delegBoundary.violations.map(v => v.file);
    assert.ok(!violationFiles.some(f => f.includes("correlation.ts")),
      "correlation.ts uses @/lib/correlation-engine — should NOT be flagged as not delegating");
  });
});

describe("dependency graph: @repo/ only matches packages/", () => {
  let pkgRoot;

  before(() => {
    pkgRoot = mkdtempSync(join(tmpdir(), "zero-error-pkgmatch-"));
    mkdirSync(join(pkgRoot, "apps", "api", "src", "lib"), { recursive: true });
    mkdirSync(join(pkgRoot, "apps", "web", "app", "api", "zabbix", "ping"), { recursive: true });
    mkdirSync(join(pkgRoot, "packages", "logger", "src"), { recursive: true });

    // Logic core file imports @repo/logger — should match packages/logger, NOT
    // any file that happens to have "logger" in its path
    writeFileSync(join(pkgRoot, "apps", "api", "src", "lib", "engine.ts"),
      "import { log } from '@repo/logger';\nexport function run() { log('hello'); }\n"
    );
    // Route file that has "zabbix" in path — should NOT be matched by @repo/zabbix
    writeFileSync(join(pkgRoot, "apps", "web", "app", "api", "zabbix", "ping", "route.ts"),
      "export function GET() { return Response.json({ ok: true }); }\n"
    );
    // Actual logger package
    writeFileSync(join(pkgRoot, "packages", "logger", "src", "index.ts"),
      "export function log(msg) { console.log(msg); }\n"
    );
  });

  after(() => {
    if (pkgRoot && existsSync(pkgRoot)) rmSync(pkgRoot, { recursive: true, force: true });
  });

  it("@repo/ imports only match files in packages/, not routes with same name", () => {
    const scan = scanProject(pkgRoot);
    scan._rootDir = pkgRoot;
    const arch = mapArchitecture(scan);

    // Check that no edge goes from logic-core to ingress
    const logicToIngress = arch.dependencyGraph.filter(e =>
      e.from_layer === "logic-core" && e.to_layer === "ingress");
    assert.equal(logicToIngress.length, 0,
      "logic-core should NOT have edges to ingress — @repo/ must only match packages/");
  });
});

// ---------------------------------------------------------------------------
// Round 10 fixes — normalizePath with .., Boundary 2 API-only, nested type stripping.
// ---------------------------------------------------------------------------

describe("delegation checker: relative imports with .. resolve correctly", () => {
  let dotdotRoot;

  before(() => {
    dotdotRoot = mkdtempSync(join(tmpdir(), "zero-error-dotdot-"));
    mkdirSync(join(dotdotRoot, "apps", "api", "src", "routes"), { recursive: true });
    mkdirSync(join(dotdotRoot, "apps", "api", "src", "lib"), { recursive: true });

    // Route imports with ../../lib/ pattern (common in nested route dirs)
    writeFileSync(join(dotdotRoot, "apps", "api", "src", "routes", "correlation.ts"),
      "import { correlate } from '../lib/correlation-engine';\nexport function GET() { return correlate(); }\n"
    );
    writeFileSync(join(dotdotRoot, "apps", "api", "src", "lib", "correlation-engine.ts"),
      "export function correlate() { return []; }\n"
    );
  });

  after(() => {
    if (dotdotRoot && existsSync(dotdotRoot)) rmSync(dotdotRoot, { recursive: true, force: true });
  });

  it("resolves ../lib/correlation-engine import and does NOT flag as missing delegation", () => {
    const scan = scanProject(dotdotRoot);
    scan._rootDir = dotdotRoot;
    const arch = mapArchitecture(scan);
    const delegBoundary = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
    assert.ok(delegBoundary);
    const violationFiles = delegBoundary.violations.map(v => v.file);
    assert.ok(!violationFiles.some(f => f.includes("correlation.ts")),
      "correlation.ts imports ../lib/correlation-engine — should NOT be flagged");
  });
});

describe("delegation checker: excludes Next.js pages (frontend)", () => {
  let pagesRoot;

  before(() => {
    pagesRoot = mkdtempSync(join(tmpdir(), "zero-error-pages-"));
    mkdirSync(join(pagesRoot, "apps", "web", "app", "dashboard"), { recursive: true });
    mkdirSync(join(pagesRoot, "apps", "web", "app", "api", "users"), { recursive: true });
    mkdirSync(join(pagesRoot, "apps", "api", "src", "lib"), { recursive: true });

    // Next.js page (frontend) — should NOT be checked for delegation
    writeFileSync(join(pagesRoot, "apps", "web", "app", "dashboard", "page.tsx"),
      "export default function Page() { return <div>Dashboard</div>; }\n"
    );
    // API route that doesn't delegate — SHOULD be flagged
    writeFileSync(join(pagesRoot, "apps", "web", "app", "api", "users", "route.ts"),
      "export function GET() { return Response.json([]); }\n"
    );
  });

  after(() => {
    if (pagesRoot && existsSync(pagesRoot)) rmSync(pagesRoot, { recursive: true, force: true });
  });

  it("does NOT flag Next.js pages for missing delegation", () => {
    const scan = scanProject(pagesRoot);
    scan._rootDir = pagesRoot;
    const arch = mapArchitecture(scan);
    const delegBoundary = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
    assert.ok(delegBoundary);
    const violationFiles = delegBoundary.violations.map(v => v.file).filter(Boolean);
    // page.tsx should NOT be in violations
    assert.ok(!violationFiles.some(f => f.includes("page.tsx")),
      "Next.js pages should NOT be checked for delegation to Logic Core");
  });
});

describe("feature flag detector: strips nested type definitions", () => {
  let nestedTypeRoot;

  before(() => {
    nestedTypeRoot = mkdtempSync(join(tmpdir(), "zero-error-nestedtype-"));
    mkdirSync(join(nestedTypeRoot, "lib"), { recursive: true });

    // Type with nested braces — should NOT be detected as flags
    writeFileSync(join(nestedTypeRoot, "lib", "schema.ts"),
      `export interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  flag_type: string;
  is_active: boolean;
  config: {
    nested: string;
    features: {
      id: string;
      key: string;
    };
  };
}

export type FlagConfig = {
  features: {
    id: string;
    key: string;
    name: string;
  };
};
`);
  });

  after(() => {
    if (nestedTypeRoot && existsSync(nestedTypeRoot)) rmSync(nestedTypeRoot, { recursive: true, force: true });
  });

  it("does NOT detect nested type definition fields as feature flags", async () => {
    const { detectFeatureFlags } = await import("../lib/feature-flag-detector.js");
    const result = detectFeatureFlags(nestedTypeRoot);
    const flagNames = result.flags.map(f => f.name);
    // Should NOT contain any schema field names
    for (const bad of ["id", "key", "name", "flag_type", "is_active", "nested", "config"]) {
      assert.ok(!flagNames.includes(bad), `should not detect '${bad}' as a flag`);
    }
    // Should have zero flags from this type-only file
    assert.equal(result.totalFlags, 0, "type-only file should produce zero flags");
  });
});

// ---------------------------------------------------------------------------
// Round 11 fix — @repo/ matching with paths that don't have leading /
// ---------------------------------------------------------------------------

describe("dependency graph: @repo/ matches packages/ without leading slash", () => {
  let repoMatchRoot;

  before(() => {
    repoMatchRoot = mkdtempSync(join(tmpdir(), "zero-error-repomatch-"));
    mkdirSync(join(repoMatchRoot, "apps/api/src/routes"), { recursive: true });
    mkdirSync(join(repoMatchRoot, "apps/api/src/lib"), { recursive: true });
    mkdirSync(join(repoMatchRoot, "packages/db/src"), { recursive: true });
    mkdirSync(join(repoMatchRoot, "packages/logger/src"), { recursive: true });

    writeFileSync(join(repoMatchRoot, "package.json"), JSON.stringify({
      name: "test-monorepo",
      workspaces: ["apps/*", "packages/*"],
    }));

    // Route imports @repo/db — should create ingress -> state-store edge
    writeFileSync(join(repoMatchRoot, "apps/api/src/routes/users.ts"),
      "import { query } from '@repo/db';\nexport function GET() { return query('SELECT 1'); }\n"
    );
    // Logic-core imports @repo/logger — should create logic-core -> state-store edge
    writeFileSync(join(repoMatchRoot, "apps/api/src/lib/user-service.ts"),
      "import { log } from '@repo/logger';\nexport function getUser() { log('getUser'); return []; }\n"
    );
    writeFileSync(join(repoMatchRoot, "packages/db/src/index.ts"),
      "export function query(sql) { return []; }\n"
    );
    writeFileSync(join(repoMatchRoot, "packages/logger/src/index.ts"),
      "export function log(msg) { console.log(msg); }\n"
    );
  });

  after(() => {
    if (repoMatchRoot && existsSync(repoMatchRoot)) rmSync(repoMatchRoot, { recursive: true, force: true });
  });

  it("@repo/db creates ingress -> state-store edge", () => {
    const scan = scanProject(repoMatchRoot);
    scan._rootDir = repoMatchRoot;
    const arch = mapArchitecture(scan);
    const ingressToState = arch.dependencyGraph.filter(e =>
      e.from_layer === "ingress" && e.to_layer === "state-store");
    assert.ok(ingressToState.length > 0,
      "@repo/db should create ingress -> state-store edge");
  });

  it("@repo/logger creates logic-core -> state-store edge", () => {
    const scan = scanProject(repoMatchRoot);
    scan._rootDir = repoMatchRoot;
    const arch = mapArchitecture(scan);
    const logicToState = arch.dependencyGraph.filter(e =>
      e.from_layer === "logic-core" && e.to_layer === "state-store");
    assert.ok(logicToState.length > 0,
      "@repo/logger should create logic-core -> state-store edge");
  });

  it("MD includes Dependency Graph section with cross-layer edges", () => {
    const scan = scanProject(repoMatchRoot);
    scan._rootDir = repoMatchRoot;
    const arch = mapArchitecture(scan);
    const md = generateArchitectureMap(arch, scan);
    assert.ok(md.includes("## Dependency Graph"), "MD should have Dependency Graph section");
    assert.ok(md.includes("State Store"), "MD should show State Store in graph");
  });
});

// ---------------------------------------------------------------------------
// Round 12 fix — dynamic import() support in delegation checker and dependency graph
// ---------------------------------------------------------------------------

describe("delegation checker: dynamic import() support", () => {
  let dynImportRoot;

  before(() => {
    dynImportRoot = mkdtempSync(join(tmpdir(), "zero-error-dynimport-"));
    mkdirSync(join(dynImportRoot, "apps/api/src/routes"), { recursive: true });
    mkdirSync(join(dynImportRoot, "apps/api/src/lib"), { recursive: true });

    writeFileSync(join(dynImportRoot, "package.json"), JSON.stringify({
      name: "test", workspaces: ["apps/*"],
    }));

    // Route uses dynamic import() — common pattern for lazy loading
    writeFileSync(join(dynImportRoot, "apps/api/src/routes/correlation.ts"),
      "const { correlate } = await import('../lib/correlation-engine');\nexport async function GET() { return correlate(); }\n"
    );
    writeFileSync(join(dynImportRoot, "apps/api/src/lib/correlation-engine.ts"),
      "export function correlate() { return []; }\n"
    );
  });

  after(() => {
    if (dynImportRoot && existsSync(dynImportRoot)) rmSync(dynImportRoot, { recursive: true, force: true });
  });

  it("recognizes dynamic import() as delegation to Logic Core", () => {
    const scan = scanProject(dynImportRoot);
    scan._rootDir = dynImportRoot;
    const arch = mapArchitecture(scan);
    const delegBoundary = arch.boundaries.find(b => b.rule.includes("delegate to Logic Core"));
    assert.ok(delegBoundary);
    const violationFiles = delegBoundary.violations.map(v => v.file).filter(Boolean);
    assert.ok(!violationFiles.some(f => f.includes("correlation.ts")),
      "correlation.ts uses dynamic import() — should NOT be flagged as missing delegation");
  });

  it("dynamic import() creates edge in dependency graph", () => {
    const scan = scanProject(dynImportRoot);
    scan._rootDir = dynImportRoot;
    const arch = mapArchitecture(scan);
    const corrEdge = arch.dependencyGraph.find(e =>
      e.from.includes("correlation.ts") && e.to.includes("correlation-engine"));
    assert.ok(corrEdge, "dynamic import() should create an edge in the dependency graph");
  });
});
