// @ai-context: .zero-error/architecture-map.md#logic-core
// @ai-restriction: .zero-error/code-standards.md#error-handling
// lib/architecture-mapper.js — Maps scanned files into Ingress/Logic Core/State Store ontology.
//
// Classification is delegated to lib/classification.js, which uses a
// token-based scoring system instead of substring regex. This file is
// responsible for collecting files from the scan result, calling the
// classifier, and rendering the architecture map.

import { basename, dirname, join } from "path";
import { readFileSync } from "fs";
import { classifyPath } from "./classification.js";
import { analyzeFileComplexity } from "./tech-debt-scanner.js";

export function mapArchitecture(scanResult) {
  const layers = {
    ingress: [],
    logicCore: [],
    stateStore: [],
    unclassified: [],
  };

  const allFiles = collectAllFiles(scanResult);

  for (const file of allFiles) {
    const classification = classifyPath(file.path, file.type);
    const entry = {
      path: file.path,
      layer: classification.layer,
      type: file.type || "unknown",
      name: file.name || basename(file.path),
    };
    // For ALL layers, use the classification subtype as the display type
    // instead of the raw scanner type. This prevents files classified as
    // logic-core or state-store from showing "(route)" just because the
    // content scanner detected route patterns in them.
    if (classification.subtype) {
      entry.type = classification.subtype;
    } else if (classification.layer !== "ingress") {
      // For non-ingress layers without a subtype, use the layer name as type
      // instead of the raw scanner type (e.g. "source", "route", "sql_migration")
      entry.type = classification.layer === "logic-core" ? "logic" :
                   classification.layer === "state-store" ? "state" :
                   file.type || "unknown";
    }
    if (classification.layer === "ingress") {
      entry.subtype = classification.subtype || "route";
      entry.confidence = classification.confidence;
    }

    if (classification.layer === "ingress") {
      layers.ingress.push(entry);
    } else if (classification.layer === "logic-core") {
      layers.logicCore.push(entry);
    } else if (classification.layer === "state-store") {
      layers.stateStore.push(entry);
    } else {
      layers.unclassified.push(entry);
    }
  }

  const dependencies = mapDependencies(layers);
  const dataFlow = mapDataFlow(layers);
  const boundaries = mapBoundaries(layers, scanResult);
  const dependencyGraph = mapDependencyGraph(layers, scanResult);

  return {
    layers,
    dependencies,
    dataFlow,
    boundaries,
    dependencyGraph,
    stats: {
      ingress: layers.ingress.length,
      logicCore: layers.logicCore.length,
      stateStore: layers.stateStore.length,
      unclassified: layers.unclassified.length,
      total: allFiles.length,
    },
  };
}

function collectAllFiles(scanResult) {
  const files = [];
  const seenPaths = new Set();

  function addFile(path, type, name) {
    if (!seenPaths.has(path)) {
      seenPaths.add(path);
      files.push({ path, type, name });
    }
  }

  for (const schema of scanResult.schemas) {
    addFile(schema.file, schema.type, schema.name);
  }

  for (const route of scanResult.routes) {
    addFile(route.file, "route", route.file);
  }

  for (const comp of scanResult.components) {
    addFile(comp.file, "component", comp.file);
  }

  for (const model of scanResult.models) {
    addFile(model.file, "orm_model", model.file);
  }

  if (scanResult.allScannedFiles) {
    for (const filePath of scanResult.allScannedFiles) {
      addFile(filePath, "source", filePath);
    }
  }

  return files;
}

function mapDependencies(layers) {
  const deps = [];

  for (const ingress of layers.ingress) {
    for (const logic of layers.logicCore) {
      const ingressDir = dirname(ingress.path);
      const logicDir = dirname(logic.path);
      if (ingressDir !== logicDir && shareCommonParent(ingress.path, logic.path, 2)) {
        deps.push({ from: ingress.path, to: logic.path, type: "ingress-to-logic" });
      }
    }
  }

  for (const logic of layers.logicCore) {
    for (const store of layers.stateStore) {
      const logicDir = dirname(logic.path);
      const storeDir = dirname(store.path);
      if (logicDir !== storeDir && shareCommonParent(logic.path, store.path, 2)) {
        deps.push({ from: logic.path, to: store.path, type: "logic-to-state" });
      }
    }
  }

  return deduplicateDeps(deps);
}

function shareCommonParent(pathA, pathB, minDepth) {
  const partsA = pathA.split("/");
  const partsB = pathB.split("/");
  let common = 0;
  for (let i = 0; i < Math.min(partsA.length, partsB.length); i++) {
    if (partsA[i] === partsB[i]) common++;
    else break;
  }
  return common >= minDepth;
}

function deduplicateDeps(deps) {
  const seen = new Set();
  return deps.filter(d => {
    const key = `${d.from}->${d.to}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function mapDataFlow(layers) {
  const flows = [];

  if (layers.ingress.length > 0) {
    flows.push({ from: "Client", to: "Ingress", description: "HTTP/GraphQL/gRPC request" });
  }
  if (layers.ingress.length > 0 && layers.logicCore.length > 0) {
    flows.push({ from: "Ingress", to: "Logic Core", description: "Delegates to service/use case" });
  }
  if (layers.logicCore.length > 0 && layers.stateStore.length > 0) {
    flows.push({ from: "Logic Core", to: "State Store", description: "Reads/writes via repository/model" });
  }
  if (layers.stateStore.length > 0) {
    flows.push({ from: "State Store", to: "Database/Cache/Queue", description: "Persists state" });
  }

  return flows;
}

// ---------------------------------------------------------------------------
// Real dependency graph — analyzes which files in each layer import from
// files in other layers. Produces a concrete graph, not just generic flow.
// ---------------------------------------------------------------------------

function mapDependencyGraph(layers, scanResult) {
  if (!scanResult || !scanResult._rootDir) return [];

  // Build lookup: path → layer
  const pathToLayer = new Map();
  for (const e of layers.ingress) pathToLayer.set(e.path, "ingress");
  for (const e of layers.logicCore) pathToLayer.set(e.path, "logic-core");
  for (const e of layers.stateStore) pathToLayer.set(e.path, "state-store");

  // Build lookup: base name → path (for resolving imports by filename)
  const baseNameToPath = new Map();
  const allLayerFiles = [...layers.ingress, ...layers.logicCore, ...layers.stateStore];
  for (const e of allLayerFiles) {
    const base = e.path.split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
    if (!baseNameToPath.has(base)) baseNameToPath.set(base, e.path);
  }

  const allFilePaths = new Set(scanResult.allScannedFiles || []);

  const IMPORT_RE = /(?:import\s+(?:[\w\s{},*]+\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;
  const edges = [];
  const seenEdges = new Set();

  function resolveImport(imp, fromPath) {
    if (!imp.startsWith(".")) {
      // @repo/* or @app/* — try to match by package name
      if (imp.startsWith("@repo/") || imp.startsWith("@app/") || imp.startsWith("@lib/")) {
        const pkgName = imp.split("/")[1];
        // Only match files in packages/{pkgName}/ — NOT files that just happen
        // to have the package name as a directory segment elsewhere (e.g.
        // @repo/logger should match packages/logger/src/index.ts, not
        // apps/web/app/api/logger/route.ts)
        // Note: paths may or may not have a leading /, so we check both
        // "packages/{pkgName}/" and "/packages/{pkgName}/"
        const pkgPrefix = `packages/${pkgName}/`;
        for (const [path, layer] of pathToLayer) {
          if (path.startsWith(pkgPrefix) || path.includes(`/${pkgPrefix}`)) {
            return { path, layer };
          }
        }
      }
      // @/ path alias — resolve against src/ directory of the current file
      if (imp.startsWith("@/")) {
        const aliasPath = imp.substring(2);
        const fromParts = fromPath.split("/");
        const srcIdx = fromParts.indexOf("src");
        if (srcIdx >= 0) {
          const baseDir = fromParts.slice(0, srcIdx + 1).join("/");
          const parts = (baseDir + "/" + aliasPath).split("/");
          const resolved = [];
          for (const p of parts) {
            if (p === "" || p === ".") continue;
            if (p === "..") resolved.pop();
            else resolved.push(p);
          }
          const basePath = resolved.join("/");
          for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) {
            if (pathToLayer.has(basePath + ext)) {
              return { path: basePath + ext, layer: pathToLayer.get(basePath + ext) };
            }
          }
          for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
            if (pathToLayer.has(basePath + "/index" + ext)) {
              return { path: basePath + "/index" + ext, layer: pathToLayer.get(basePath + "/index" + ext) };
            }
          }
        }
      }
      return null;
    }

    // Resolve relative import
    const fromDir = fromPath.includes("/") ? fromPath.substring(0, fromPath.lastIndexOf("/")) : "";
    const parts = (fromDir + "/" + imp).split("/");
    const resolved = [];
    for (const p of parts) {
      if (p === "" || p === ".") continue;
      if (p === "..") resolved.pop();
      else resolved.push(p);
    }
    const basePath = resolved.join("/");

    for (const ext of ["", ".ts", ".tsx", ".js", ".jsx"]) {
      const candidate = basePath + ext;
      if (pathToLayer.has(candidate)) {
        return { path: candidate, layer: pathToLayer.get(candidate) };
      }
    }
    for (const ext of [".ts", ".tsx", ".js", ".jsx"]) {
      const candidate = basePath + "/index" + ext;
      if (pathToLayer.has(candidate)) {
        return { path: candidate, layer: pathToLayer.get(candidate) };
      }
    }
    return null;
  }

  for (const entry of allLayerFiles) {
    const fromLayer = pathToLayer.get(entry.path);
    const fullPath = join(scanResult._rootDir, entry.path);
    let content = null;
    try { content = readFileSync(fullPath, "utf-8"); } catch { continue; }
    if (!content) continue;

    IMPORT_RE.lastIndex = 0;
    let match;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      const resolved = resolveImport(match[1], entry.path);
      if (!resolved) continue;
      if (resolved.layer === fromLayer) continue; // Skip same-layer imports

      const edgeKey = `${entry.path}→${resolved.path}`;
      if (seenEdges.has(edgeKey)) continue;
      seenEdges.add(edgeKey);

      edges.push({
        from: entry.path,
        from_layer: fromLayer,
        to: resolved.path,
        to_layer: resolved.layer,
      });
    }
  }

  return edges;
}

function mapBoundaries(layers, scanResult) {
  const boundaries = [];

  // Build a set of state-store file paths for quick lookup
  const stateStorePaths = new Set(layers.stateStore.map(e => e.path));
  const stateStoreBases = new Set(layers.stateStore.map(e => {
    const parts = e.path.split("/");
    return parts[parts.length - 1].replace(/\.(ts|js|tsx|jsx)$/, "");
  }));

  boundaries.push({
    rule: "Controllers never access DB directly",
    violations: detectDirectDbAccess(layers.ingress, stateStorePaths, stateStoreBases, scanResult),
  });

  boundaries.push({
    rule: "Ingress must delegate to Logic Core",
    violations: detectMissingDelegation(layers.ingress, layers.logicCore, scanResult),
  });

  return boundaries;
}

// Detect if ingress files directly import from state-store files or use
// database clients directly (e.g. prisma, db, query, sql, drizzle) without
// going through a logic-core layer. This reads the actual file content and
// checks imports — not just path overlap like the previous implementation.
function detectDirectDbAccess(ingressFiles, stateStorePaths, stateStoreBases, scanResult) {
  const violations = [];
  if (!scanResult || !scanResult.allScannedFiles) return violations;

  // Patterns that indicate direct DB access in ingress files
  const DB_ACCESS_PATTERNS = [
    /\bprisma\./, /\bprismaClient\./, /\bPrismaClient\b/,
    /\bdrizzle\(/, /\beq\(/, /\bsql\b`/, /\bquery\s*\(/,
    /\bdb\.(query|execute|insert|update|delete|select|raw)\b/i,
    /\bpool\.(query|execute)\b/i,
    /\bclient\.(query|execute)\b/i,
    /\bmongoose\./, /\bModel\.find/, /\bModel\.create/,
    /\brepository\.(find|save|create|update|delete)/i,
    /@repo\/db/, /@repo\/database/, /@repo\/orm/,
    /from\s+["'].*\/db["']/, /from\s+["'].*\/database["']/,
    /from\s+["'].*\/prisma["']/, /from\s+["'].*\/schema["']/,
  ];

  for (const ingress of ingressFiles) {
    // Skip middleware and components — they don't typically access DB
    if (ingress.subtype === "middleware" || ingress.subtype === "component") continue;

    const fullPath = join(scanResult._rootDir || ".", ingress.path);
    let content = null;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      // Try to find the file in allScannedFiles
      continue;
    }
    if (!content) continue;

    for (const pattern of DB_ACCESS_PATTERNS) {
      if (pattern.test(content)) {
        violations.push({
          file: ingress.path,
          reason: `Ingress file directly accesses database (pattern: ${pattern.source})`,
        });
        break;
      }
    }
  }

  return violations;
}

// Detect if ingress (route) files delegate to logic-core files by checking
// their imports. A route that doesn't import from any logic-core file likely
// contains inline business logic instead of delegating — that's a violation.
//
// This reads each route file, extracts import paths, and checks if any import
// resolves to a logic-core file. We match by:
// 1. Direct path match (relative import resolves to a logic-core file)
// 2. Base name match (importing a file whose name matches a logic-core file)
// 3. Package import match (importing @repo/* that corresponds to a logic-core pkg)
function detectMissingDelegation(ingressFiles, logicCoreFiles, scanResult) {
  const violations = [];
  if (ingressFiles.length > 0 && logicCoreFiles.length === 0) {
    violations.push({
      reason: "Ingress layer exists but no Logic Core detected — controllers may contain business logic",
    });
    return violations;
  }
  if (!scanResult || !scanResult._rootDir) return violations;

  // Build lookup sets from logic-core files
  const logicCorePaths = new Set(logicCoreFiles.map(f => f.path));
  const logicCoreBases = new Set(logicCoreFiles.map(f => {
    const parts = f.path.split("/");
    return parts[parts.length - 1].replace(/\.(ts|js|tsx|jsx)$/, "");
  }));
  // Also check for @repo/* package imports that might map to logic-core
  // e.g. if lib/alerting-engine.ts is in logic-core, and a route imports
  // from a package that re-exports it, we still consider it delegated.
  const logicCoreDirNames = new Set(logicCoreFiles.map(f => {
    const parts = f.path.split("/");
    // Get the directory containing the file (e.g. "lib" from "lib/foo.ts")
    if (parts.length >= 2) return parts[parts.length - 2];
    return null;
  }).filter(Boolean));

  // Import extraction patterns
  // Captures: import ... from "...", import "...", require("..."),
  // and dynamic import("...") / await import("...")
  const IMPORT_RE = /(?:import\s+(?:[\w\s{},*]+\s+from\s+)?|require\s*\(\s*|import\s*\(\s*)["']([^"']+)["']/g;

  for (const ingress of ingressFiles) {
    // Skip middleware and components — they don't need to delegate to logic-core
    if (ingress.subtype === "middleware" || ingress.subtype === "component") continue;
    if (ingress.subtype !== "route") continue;
    // Only check API routes for delegation — Next.js pages (app/**/page.tsx,
    // app/**/layout.tsx) are frontend and don't need to import from API lib/
    if (ingress.path.includes("/app/") && !ingress.path.includes("/api/")) continue;

    const fullPath = join(scanResult._rootDir, ingress.path);
    let content = null;
    try {
      content = readFileSync(fullPath, "utf-8");
    } catch {
      continue;
    }
    if (!content) continue;

    // Extract all import paths from the file
    const imports = [];
    let match;
    IMPORT_RE.lastIndex = 0;
    while ((match = IMPORT_RE.exec(content)) !== null) {
      imports.push(match[1]);
    }

    // Check if any import resolves to a logic-core file
    let delegates = false;
    for (const imp of imports) {
      // Skip third-party imports (not relative, not @repo/*, not @app/*, not @/)
      if (!imp.startsWith(".") && !imp.startsWith("@repo/") && !imp.startsWith("@app/") &&
          !imp.startsWith("@lib/") && !imp.startsWith("@shared/") && !imp.startsWith("@/")) continue;

      // Try to resolve relative imports against the ingress file's directory
      let resolvedPath = imp;
      if (imp.startsWith(".")) {
        const ingressDir = ingress.path.substring(0, ingress.path.lastIndexOf("/"));
        resolvedPath = normalizePath(ingressDir + "/" + imp);
      } else if (imp.startsWith("@/")) {
        // Path alias @/ typically maps to src/ — try resolving against
        // common source roots. We try multiple base paths.
        const aliasPath = imp.substring(2); // strip @/
        // Try: apps/*/src/, packages/*/src/, src/
        const ingressParts = ingress.path.split("/");
        // Find the src/ directory in the ingress path
        const srcIdx = ingressParts.indexOf("src");
        if (srcIdx >= 0) {
          const baseDir = ingressParts.slice(0, srcIdx + 1).join("/");
          resolvedPath = normalizePath(baseDir + "/" + aliasPath);
        } else {
          // No src/ in path — try root
          resolvedPath = normalizePath(aliasPath);
        }
      }

      // Check direct path match (with or without extension)
      for (const ext of ["", ".ts", ".js", ".tsx", ".jsx", "/index.ts", "/index.js"]) {
        if (logicCorePaths.has(resolvedPath + ext)) {
          delegates = true;
          break;
        }
      }
      if (delegates) break;

      // Check base name match — if the import's last segment matches a
      // logic-core file's base name, consider it delegated.
      // This catches cases where the resolved path doesn't match exactly
      // but the file name does (e.g. different base directory).
      const importBase = imp.split("/").pop().replace(/\.(ts|js|tsx|jsx)$/, "");
      if (importBase && importBase.length > 2 && logicCoreBases.has(importBase)) {
        delegates = true;
        break;
      }

      // Check @repo/* imports — if the package name matches a logic-core
      // directory, the route is likely importing business logic through
      // the package barrel file
      if (imp.startsWith("@repo/") || imp.startsWith("@app/") || imp.startsWith("@lib/")) {
        const pkgName = imp.split("/")[1];
        if (logicCoreDirNames.has(pkgName)) {
          delegates = true;
          break;
        }
      }
    }

    if (!delegates) {
      // Classify severity based on file complexity — a simple CRUD route
      // that doesn't delegate is acceptable, but a complex route with inline
      // logic is a real tech debt issue.
      const complexity = analyzeFileComplexity(fullPath);
      let severity = "warning";
      let reason = "Route does not import from any Logic Core file — business logic may be inline";
      if (complexity) {
        if (complexity.cyclomatic_complexity <= 5 && complexity.loc <= 50) {
          severity = "info";
          reason = `Simple route (LOC: ${complexity.loc}, complexity: ${complexity.cyclomatic_complexity}) — no delegation needed`;
        } else if (complexity.cyclomatic_complexity > 20 || complexity.loc > 200) {
          severity = "critical";
          reason = `Complex route (LOC: ${complexity.loc}, complexity: ${complexity.cyclomatic_complexity}) with inline logic — should delegate to Logic Core`;
        } else {
          reason = `Route (LOC: ${complexity.loc}, complexity: ${complexity.cyclomatic_complexity}) does not import from any Logic Core file`;
        }
      }
      violations.push({ file: ingress.path, reason, severity });
    }
  }

  return violations;
}

function normalizePath(p) {
  // Normalize separators and resolve . / .. segments
  const normalized = p.replace(/\\/g, "/").replace(/\/+/g, "/");
  const parts = normalized.split("/");
  const resolved = [];
  for (const part of parts) {
    if (part === "" || part === ".") continue;
    if (part === "..") resolved.pop();
    else resolved.push(part);
  }
  return resolved.join("/");
}

// ---------------------------------------------------------------------------
// Architecture map rendering
// ---------------------------------------------------------------------------

const INGRESS_GROUP_ORDER = ["route", "middleware", "graphql", "grpc", "component", "other"];
const INGRESS_GROUP_LABELS = {
  route: "Routes & Handlers",
  middleware: "Middleware",
  graphql: "GraphQL Resolvers",
  grpc: "gRPC Services",
  component: "Components & Views",
  other: "Other Entry Points",
};

function groupIngressBySubtype(ingressEntries) {
  const groups = {};
  for (const key of INGRESS_GROUP_ORDER) groups[key] = [];
  for (const entry of ingressEntries) {
    const sub = entry.subtype || "other";
    if (groups[sub]) {
      groups[sub].push(entry);
    } else {
      groups.other.push(entry);
    }
  }
  return groups;
}

function layerLabel(layer) {
  const labels = {
    "ingress": "Ingress",
    "logic-core": "Logic Core",
    "state-store": "State Store",
    "unclassified": "Unclassified",
  };
  return labels[layer] || layer;
}

export function generateArchitectureMap(archMap, scanResult) {
  const lines = [];

  lines.push("# Architecture Map");
  lines.push("");
  lines.push("> Auto-generated by AI Black Box v2. Do not edit manually.");
  lines.push("> Update with: `node init.js --update`");
  lines.push("");

  if (scanResult.monorepo) {
    lines.push("## Monorepo Structure");
    lines.push("");
    for (const pkg of scanResult.monorepoPackages) {
      lines.push(`- **${pkg.name}**: \`${pkg.path}\``);
    }
    lines.push("");
  }

  lines.push("## Ingress (Entry Points)");
  lines.push("");
  if (archMap.layers.ingress.length === 0) {
    lines.push("- No ingress files detected");
  } else {
    const groups = groupIngressBySubtype(archMap.layers.ingress);
    for (const key of INGRESS_GROUP_ORDER) {
      const entries = groups[key];
      if (!entries || entries.length === 0) continue;
      lines.push(`### ${INGRESS_GROUP_LABELS[key]}`);
      lines.push("");
      for (const entry of entries) {
        lines.push(`- \`${entry.path}\` (${entry.type})`);
      }
      lines.push("");
    }
  }
  lines.push("");

  lines.push("## Logic Core (Business Logic)");
  lines.push("");
  if (archMap.layers.logicCore.length === 0) {
    lines.push("- No logic core files detected");
  } else {
    for (const entry of archMap.layers.logicCore) {
      lines.push(`- \`${entry.path}\` (${entry.type})`);
    }
  }
  lines.push("");

  lines.push("## State Store (Data Layer)");
  lines.push("");
  if (archMap.layers.stateStore.length === 0) {
    lines.push("- No state store files detected");
  } else {
    for (const entry of archMap.layers.stateStore) {
      lines.push(`- \`${entry.path}\` (${entry.type})`);
    }
  }
  lines.push("");

  lines.push("## Data Flow");
  lines.push("");
  for (const flow of archMap.dataFlow) {
    lines.push(`- **${flow.from}** → **${flow.to}**: ${flow.description}`);
  }
  lines.push("");

  // --- Dependency Graph (real cross-layer imports) ---
  lines.push("## Dependency Graph (Cross-Layer Imports)");
  lines.push("");
  lines.push("> Actual import relationships between architectural layers.");
  lines.push("> Each edge represents a real `import` statement resolved to a file in another layer.");
  lines.push("");

  if (archMap.dependencyGraph && archMap.dependencyGraph.length > 0) {
    // Group by from_layer → to_layer
    const layerPairs = {};
    for (const edge of archMap.dependencyGraph) {
      const key = `${edge.from_layer}→${edge.to_layer}`;
      if (!layerPairs[key]) layerPairs[key] = [];
      layerPairs[key].push(edge);
    }

    // Define expected flow direction and violations
    // Expected: Ingress → Logic Core, Ingress → State Store, Logic Core → State Store
    // Violations: Logic Core → Ingress, State Store → Ingress, State Store → Logic Core
    const VIOLATION_DIRECTIONS = new Set([
      "logic-core→ingress",
      "state-store→ingress",
      "state-store→logic-core",
    ]);

    for (const [pair, edges] of Object.entries(layerPairs).sort()) {
      const [fromLayer, toLayer] = pair.split("→");
      const fromLabel = layerLabel(fromLayer);
      const toLabel = layerLabel(toLayer);
      const isViolation = VIOLATION_DIRECTIONS.has(pair);
      const violationTag = isViolation ? " ⚠️ ARCHITECTURAL VIOLATION" : "";
      lines.push(`### ${fromLabel} → ${toLabel} (${edges.length} imports)${violationTag}`);
      lines.push("");
      // Show top 30 edges per pair to avoid flooding
      for (const edge of edges.slice(0, 30)) {
        lines.push(`- \`${edge.from}\` → \`${edge.to}\``);
      }
      if (edges.length > 30) {
        lines.push(`- ... and ${edges.length - 30} more`);
      }
      lines.push("");
    }

    // Explicitly note when violation directions have zero edges (clean)
    for (const vDir of VIOLATION_DIRECTIONS) {
      if (!layerPairs[vDir]) {
        const [fromLayer, toLayer] = vDir.split("→");
        const fromLabel = layerLabel(fromLayer);
        const toLabel = layerLabel(toLayer);
        lines.push(`### ${fromLabel} → ${toLabel} (0 imports)`);
        lines.push("");
        lines.push("- OK: No architectural violations detected in this direction.");
        lines.push("");
      }
    }
  } else {
    lines.push("- No cross-layer imports detected.");
    lines.push("");
  }

  // --- File Complexity Analysis ---
  if (scanResult._rootDir) {
    lines.push("## File Complexity Analysis");
    lines.push("");
    lines.push("> LOC = non-blank, non-comment lines. Complexity = estimated cyclomatic complexity (branching keywords).");
    lines.push("");

    // Analyze all classified files (ingress + logic-core + state-store)
    const allEntries = [
      ...archMap.layers.ingress,
      ...archMap.layers.logicCore,
      ...archMap.layers.stateStore,
    ];

    const complexityData = [];
    for (const entry of allEntries) {
      const fullPath = join(scanResult._rootDir, entry.path);
      const complexity = analyzeFileComplexity(fullPath);
      if (complexity) {
        complexityData.push({ path: entry.path, layer: entry.layer, ...complexity });
      }
    }

    // Sort by complexity descending — show top 20 most complex files
    complexityData.sort((a, b) => b.cyclomatic_complexity - a.cyclomatic_complexity);

    if (complexityData.length === 0) {
      lines.push("- No complexity data available");
    } else {
      lines.push("| File | Layer | LOC | Complexity | Level |");
      lines.push("|------|-------|-----|------------|-------|");
      for (const item of complexityData.slice(0, 20)) {
        lines.push(`| \`${item.path}\` | ${item.layer} | ${item.loc} | ${item.cyclomatic_complexity} | ${item.complexity_label} |`);
      }
      if (complexityData.length > 20) {
        lines.push("");
        lines.push(`> Showing top 20 of ${complexityData.length} files. Full data in blackbox-index.json.`);
      }
    }
    lines.push("");
  }

  lines.push("## Boundaries");
  lines.push("");
  for (const boundary of archMap.boundaries) {
    lines.push(`- **${boundary.rule}**`);
    if (boundary.violations.length > 0) {
      // Sort violations by severity (critical first, then warning, then info)
      const severityOrder = { critical: 0, warning: 1, info: 2 };
      const sorted = [...boundary.violations].sort((a, b) =>
        (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1));

      for (const v of sorted) {
        // Always include file path when available — makes warnings actionable
        const icon = v.severity === "critical" ? "CRITICAL" :
                     v.severity === "info" ? "INFO" : "WARNING";
        if (v.file) {
          lines.push(`  - ${icon}: \`${v.file}\` — ${v.reason}`);
        } else {
          lines.push(`  - ${icon}: ${v.reason}`);
        }
      }
    } else {
      lines.push("  - OK: No violations detected");
    }
  }
  lines.push("");

  lines.push("## Critical Paths");
  lines.push("");
  if (scanResult.criticalPaths.length === 0) {
    lines.push("- No critical paths detected");
  } else {
    // Group by business flow for semantic clarity
    const byFlow = {};
    for (const cp of scanResult.criticalPaths) {
      const flow = cp.flow || cp.keyword || "other";
      if (!byFlow[flow]) byFlow[flow] = [];
      byFlow[flow].push(cp);
    }

    // Sort flows by count descending
    const sortedFlows = Object.entries(byFlow).sort((a, b) => b[1].length - a[1].length);

    for (const [flow, paths] of sortedFlows) {
      lines.push(`### ${flow} (${paths.length} paths)`);
      lines.push("");
      for (const cp of paths) {
        lines.push(`- \`${cp.path}\` (keyword: ${cp.keyword})`);
      }
      lines.push("");
    }
  }

  // --- Feature Flags ---
  if (scanResult.featureFlags && scanResult.featureFlags.length > 0) {
    lines.push("## Feature Flags");
    lines.push("");
    lines.push("> Detected feature flags in the codebase. These control runtime behavior.");
    lines.push("");
    if (scanResult.featureFlagProviders && scanResult.featureFlagProviders.length > 0) {
      lines.push(`**Providers**: ${scanResult.featureFlagProviders.join(", ")}`);
      lines.push("");
    }
    lines.push("| Flag | Provider | Files |");
    lines.push("|------|----------|-------|");
    for (const flag of scanResult.featureFlags) {
      const files = flag.files ? flag.files.slice(0, 3).map(f => `\`${f}\``).join(", ") : "";
      const moreFiles = flag.files && flag.files.length > 3 ? ` (+${flag.files.length - 3})` : "";
      lines.push(`| \`${flag.name}\` | ${flag.provider} | ${files}${moreFiles} |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
