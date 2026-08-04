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
import { scanTechDebt } from "../lib/tech-debt-scanner.js";
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

  it("does NOT classify apps/api/src/index.ts as route even with route type", () => {
    const r = classifyPath("apps/api/src/index.ts", "route");
    assert.notEqual(r.layer, "ingress");
    assert.notEqual(r.subtype, "route");
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
