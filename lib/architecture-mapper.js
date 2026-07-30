// lib/architecture-mapper.js — Maps scanned files into Ingress/Logic Core/State Store ontology
// Zero IA calls. Pure classification heuristics.

import { extname, basename, dirname, sep } from "path";

const INGRESS_PATTERNS = [
  /controller/i, /route/i, /router/i, /resolver/i,
  /endpoint/i, /api/i, /lambda/i, /gateway/i, /middleware/i,
  /interceptor/i, /filter/i, /servlet/i, /resource/i,
  /viewset/i, /view/i, /handler/i, /endpoint/i,
  /grpc/i, /graphql/i, /resolver/i,
];

const LOGIC_CORE_PATTERNS = [
  /service/i, /usecase/i, /use_case/i, /use-cases/i, /domain/i, /business/i,
  /logic/i, /application/i, /interactor/i, /command/i, /query/i,
  /handler/i, /processor/i, /manager/i, /orchestrator/i,
  /repository/i, /dao/i, /mapper/i, /adapter/i, /factory/i,
  /builder/i, /strategy/i, /calculator/i,
  /worker/i, /job/i, /task/i, /listener/i,
  /interactor/i, /action/i, /command/i,
];

const LOGIC_CORE_DIR_PATTERNS = [
  /use-cases/i, /use_cases/i, /services/i, /service/i,
  /domain/i, /business/i, /logic/i, /application/i,
  /interactor/i, /commands/i, /queries/i,
  /repositories/i, /repository/i, /adapters/i,
  /factories/i, /strategies/i,
  /workers/i, /jobs/i, /tasks/i, /listeners/i,
  /processors/i, /managers/i, /orchestrators/i,
  /actions/i, /handlers/i, /interactors/i,
  /business/i, /core/i, /rules/i, /policies/i,
];

const STATE_STORE_PATTERNS = [
  /model/i, /entity/i, /schema/i, /migration/i, /table/i,
  /database/i, /db/i, /cache/i, /redis/i, /queue/i,
  /kafka/i, /rabbitmq/i, /s3/i, /storage/i, /bucket/i,
  /dynamo/i, /mongo/i, /supabase/i, /prisma/i, /schema/i,
  /repository/i, /dao/i, /orm/i, /sqlalchemy/i, /gorm/i,
  /typeorm/i, /mongoose/i, /sequelize/i, /entity/i,
  /table/i, /record/i, /document/i, /collection/i,
];

const INGRESS_EXTS = new Set([".controller.ts", ".controller.js", ".route.ts", ".route.js"]);
const INGRESS_FILENAMES = [
  "router", "routes", "controller", "resolver",
  "lambda", "gateway", "endpoint", "middleware", "interceptor",
];

const STATE_STORE_FILENAMES = [
  "schema", "migration", "model", "entity", "table",
  "database", "db", "cache", "queue", "storage",
];

export function mapArchitecture(scanResult) {
  const layers = {
    ingress: [],
    logicCore: [],
    stateStore: [],
    unclassified: [],
  };

  const allFiles = collectAllFiles(scanResult);

  for (const file of allFiles) {
    const layer = classifyFile(file, scanResult);
    const entry = {
      path: file.path,
      layer: layer,
      type: file.type || "unknown",
      name: file.name || basename(file.path),
    };

    if (layer === "ingress") {
      layers.ingress.push(entry);
    } else if (layer === "logic-core") {
      layers.logicCore.push(entry);
    } else if (layer === "state-store") {
      layers.stateStore.push(entry);
    } else {
      layers.unclassified.push(entry);
    }
  }

  const dependencies = mapDependencies(layers);
  const dataFlow = mapDataFlow(layers);
  const boundaries = mapBoundaries(layers);

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

function deduplicateByPath(files) {
  const seen = new Set();
  const result = [];
  for (const f of files) {
    if (!seen.has(f.path)) {
      seen.add(f.path);
      result.push(f);
    }
  }
  return result;
}

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

function classifyFile(file, scanResult) {
  const pathLower = file.path.toLowerCase();
  const fileName = basename(file.path, extname(file.path)).toLowerCase();
  const fullName = basename(file.path).toLowerCase();
  const ext = extname(file.path).toLowerCase();
  const dirName = dirname(file.path).toLowerCase().split(sep).pop() || "";
  const dirPath = dirname(file.path).toLowerCase();

  if (pathLower.startsWith(".zero-error/") || pathLower.includes("/.zero-error/")) {
    return "unclassified";
  }

  if (CONFIG_FILENAMES.has(fullName)) return "unclassified";
  if (CONFIG_EXTS.has(ext) && file.type === "source") return "unclassified";
  if (fullName === "readme.md" || fullName === "license" || fullName === "license.md") return "unclassified";

  if (file.type === "route" || file.type === "openapi_path") return "ingress";
  if (file.type === "component") return "ingress";
  if (file.type === "proto_message") return "ingress";
  if (file.type === "prisma_model" || file.type === "sql_table" || file.type === "orm_model") return "state-store";

  for (const pattern of LOGIC_CORE_DIR_PATTERNS) {
    if (pattern.test(dirName)) return "logic-core";
  }

  for (const pattern of LOGIC_CORE_PATTERNS) {
    if (pattern.test(fileName)) return "logic-core";
  }

  for (const pattern of INGRESS_PATTERNS) {
    if (pattern.test(fileName) || pattern.test(dirName)) return "ingress";
  }

  for (const name of INGRESS_FILENAMES) {
    if (fileName === name || fileName.startsWith(name + ".")) return "ingress";
  }

  for (const pattern of STATE_STORE_PATTERNS) {
    if (pattern.test(fileName) || pattern.test(dirName)) return "state-store";
  }

  for (const name of STATE_STORE_FILENAMES) {
    if (fileName === name || fileName.startsWith(name + ".")) return "state-store";
  }

  return "unclassified";
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

function mapBoundaries(layers) {
  const boundaries = [];

  boundaries.push({
    rule: "Controllers never access DB directly",
    violations: detectBoundaryViolations(layers.ingress, layers.stateStore),
  });

  boundaries.push({
    rule: "Ingress must delegate to Logic Core",
    violations: detectMissingDelegation(layers.ingress, layers.logicCore),
  });

  return boundaries;
}

function detectBoundaryViolations(ingressFiles, stateStoreFiles) {
  const violations = [];
  for (const ingress of ingressFiles) {
    for (const store of stateStoreFiles) {
      if (ingress.path === store.path) {
        violations.push({
          file: ingress.path,
          reason: "Ingress file also classified as State Store — possible layer violation",
        });
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
    for (const entry of archMap.layers.ingress) {
      lines.push(`- \`${entry.path}\` (${entry.type})`);
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
