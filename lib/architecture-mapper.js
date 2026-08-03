// lib/architecture-mapper.js — Maps scanned files into Ingress/Logic Core/State Store ontology.
//
// Classification is delegated to lib/classification.js, which uses a
// token-based scoring system instead of substring regex. This file is
// responsible for collecting files from the scan result, calling the
// classifier, and rendering the architecture map.

import { basename, dirname, join, extname } from "path";
import { readFileSync, existsSync } from "fs";
import { classifyPath } from "./classification.js";

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
    if (classification.layer === "ingress") {
      entry.subtype = classification.subtype || "route";
      entry.confidence = classification.confidence;
      // Use subtype as the display type for ingress entries so the
      // architecture map shows "middleware", "component", "route" etc.
      // instead of the raw scanner type ("source", "route").
      entry.type = entry.subtype;
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

  return {
    layers,
    dependencies,
    dataFlow,
    boundaries,
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
    violations: detectMissingDelegation(layers.ingress, layers.logicCore),
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

function detectMissingDelegation(ingressFiles, logicCoreFiles) {
  const violations = [];
  if (ingressFiles.length > 0 && logicCoreFiles.length === 0) {
    violations.push({
      reason: "Ingress layer exists but no Logic Core detected — controllers may contain business logic",
    });
  }
  return violations;
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

  lines.push("## Boundaries");
  lines.push("");
  for (const boundary of archMap.boundaries) {
    lines.push(`- **${boundary.rule}**`);
    if (boundary.violations.length > 0) {
      for (const v of boundary.violations) {
        lines.push(`  - WARNING: ${v.reason || v.file + ": " + v.reason}`);
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
    for (const cp of scanResult.criticalPaths) {
      lines.push(`- \`${cp.path}\` (keyword: ${cp.keyword})`);
    }
  }
  lines.push("");

  return lines.join("\n");
}
