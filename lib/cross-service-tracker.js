// lib/cross-service-tracker.js — Maps contracts between services (REST/GraphQL/gRPC)
// Zero network calls. Reads only static contract files from the repo.
// SOC2/ISO 27001 compliant: read-only, no network, no external execution.

import { readFileSync, existsSync, readdirSync } from "fs";
import { join, extname, relative, sep } from "path";

const CONTRACT_FILE_PATTERNS = [
  { pattern: /openapi\.(json|yaml|yml)$/i, type: "openapi", parser: parseOpenApi },
  { pattern: /swagger\.(json|yaml|yml)$/i, type: "openapi", parser: parseOpenApi },
  { pattern: /\.proto$/i, type: "grpc", parser: parseProto },
  { pattern: /schema\.(graphql|gql)$/i, type: "graphql", parser: parseGraphQL },
  { pattern: /.*\.graphql$/i, type: "graphql", parser: parseGraphQL },
];

const HTTP_CLIENT_PATTERNS = [
  { regex: /fetch\s*\(\s*['"`]([^'"`]+)['"`]/g, type: "fetch", library: "native" },
  { regex: /axios\.(get|post|put|patch|delete)\s*\(\s*['"`]([^'"`]+)/g, type: "axios", library: "axios" },
  { regex: /axios\s*\(\s*\{[^}]*url:\s*['"`]([^'"`]+)/g, type: "axios", library: "axios" },
  { regex: /@HttpClient\s*\)/g, type: "angular", library: "angular" },
  { regex: /this\.http\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g, type: "angular", library: "angular" },
  { regex: /requests\.(get|post|put|delete)\s*\(\s*['"`]([^'"`]+)/g, type: "python-requests", library: "requests" },
  { regex: /http\.(Get|Post|Put|Delete)\s*\(\s*['"`]([^'"`]+)/g, type: "go-nethttp", library: "net/http" },
  { regex: /RestTemplate.*?\.(getForObject|postForObject|exchange)\s*\(\s*['"`]([^'"`]+)/g, type: "spring", library: "spring" },
  { regex: /WebClient.*?\.(get|post)\s*\(\s*\)\s*\.uri\s*\(\s*['"`]([^'"`]+)/g, type: "spring-webflux", library: "spring-webflux" },
  { regex: /grpc\.NewClient\s*\(\s*['"`]([^'"`]+)/g, type: "grpc-go", library: "grpc-go" },
  { regex: /ManagedChannelBuilder\.forAddress\s*\(\s*['"`]([^'"`]+)/g, type: "grpc-java", library: "grpc-java" },
];

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", "build", "dist",
  ".next", ".nuxt", "__pycache__", "target", "bin",
  ".zero-error", ".gradle",
]);

export function trackCrossServiceContracts(rootDir) {
  const contracts = findContractFiles(rootDir, rootDir, 0, 10);
  const consumers = findServiceConsumers(rootDir, rootDir, 0, 10);
  const graph = buildDependencyGraph(contracts, consumers);
  const risks = detectContractRisks(graph);

  return {
    contracts,
    consumers,
    graph,
    risks,
  };
}

function findContractFiles(rootDir, currentDir, depth, maxDepth) {
  if (depth > maxDepth) return [];

  let results = [];
  let entries = [];

  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;

    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      results = results.concat(findContractFiles(rootDir, fullPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      const matched = matchContractFile(relPath);
      if (matched) {
        const content = safeRead(fullPath);
        if (content) {
          const parsed = matched.parser(content, relPath);
          results.push({
            file: relPath,
            type: matched.type,
            ...parsed,
          });
        }
      }
    }
  }

  return results;
}

function matchContractFile(filePath) {
  for (const { pattern, type, parser } of CONTRACT_FILE_PATTERNS) {
    if (pattern.test(filePath)) {
      return { type, parser };
    }
  }
  return null;
}

function findServiceConsumers(rootDir, currentDir, depth, maxDepth) {
  if (depth > maxDepth) return [];

  let results = [];
  let entries = [];

  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;

    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      results = results.concat(findServiceConsumers(rootDir, fullPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if ([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java", ".rs"].includes(ext)) {
        const content = safeRead(fullPath);
        if (content) {
          const calls = extractServiceCalls(content);
          if (calls.length > 0) {
            results.push({
              file: relPath,
              calls: calls,
            });
          }
        }
      }
    }
  }

  return results;
}

function extractServiceCalls(content) {
  const calls = [];

  for (const { regex, type, library } of HTTP_CLIENT_PATTERNS) {
    let m;
    const re = new RegExp(regex.source, regex.flags);
    while ((m = re.exec(content)) !== null) {
      const url = m[1] || m[2] || "";
      const method = m[0].match(/(get|post|put|patch|delete)/i);
      calls.push({
        type: type,
        library: library,
        url: url,
        method: method ? method[1].toUpperCase() : "UNKNOWN",
      });
    }
  }

  return calls;
}

function buildDependencyGraph(contracts, consumers) {
  const nodes = new Set();
  const edges = [];

  for (const contract of contracts) {
    const serviceName = extractServiceName(contract);
    nodes.add(serviceName);
  }

  for (const consumer of consumers) {
    nodes.add(consumer.file);
    for (const call of consumer.calls) {
      const targetService = extractTargetFromUrl(call.url);
      if (targetService) {
        nodes.add(targetService);
        edges.push({
          from: consumer.file,
          to: targetService,
          type: call.type,
          method: call.method,
          url: call.url,
        });
      }
    }
  }

  return {
    nodes: Array.from(nodes).sort(),
    edges: deduplicateEdges(edges),
  };
}

function extractServiceName(contract) {
  if (contract.type === "openapi" && contract.info?.title) {
    return contract.info.title;
  }
  if (contract.type === "grpc" && contract.package) {
    return `grpc:${contract.package}`;
  }
  if (contract.type === "graphql" && contract.types?.length > 0) {
    return `graphql:${contract.file}`;
  }
  return contract.file;
}

function extractTargetFromUrl(url) {
  if (!url || url.length === 0) return null;
  if (url.startsWith("http://") || url.startsWith("https://")) {
    try {
      const u = new URL(url);
      return u.hostname;
    } catch {
      return url.split("/")[2] || url;
    }
  }
  if (url.startsWith("/")) {
    return `internal:${url.split("/")[1] || "root"}`;
  }
  return null;
}

function detectContractRisks(graph) {
  const risks = [];

  const targetCounts = {};
  for (const edge of graph.edges) {
    targetCounts[edge.to] = (targetCounts[edge.to] || 0) + 1;
  }

  for (const [target, count] of Object.entries(targetCounts)) {
    if (count >= 3) {
      risks.push({
        severity: "warning",
        target: target,
        reason: `${count} consumers depend on this service. Contract changes require coordinated deployment.`,
      });
    }
  }

  const contractServices = new Set();
  for (const node of graph.nodes) {
    if (node.startsWith("grpc:") || node.startsWith("graphql:") || node.includes("openapi")) {
      contractServices.add(node);
    }
  }

  for (const edge of graph.edges) {
    const isContractTarget = contractServices.has(edge.to) ||
      graph.nodes.some(n => n.includes(edge.to));
    if (!isContractTarget && !edge.to.startsWith("internal:")) {
      risks.push({
        severity: "info",
        target: edge.to,
        consumer: edge.from,
        reason: `Consumer calls service "${edge.to}" but no contract file found in repo. Contract may be external or missing.`,
      });
    }
  }

  return risks;
}

function deduplicateEdges(edges) {
  const seen = new Set();
  return edges.filter(e => {
    const key = `${e.from}->${e.to}:${e.method}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

function parseOpenApi(content, filePath) {
  try {
    const spec = JSON.parse(content);
    return {
      info: { title: spec.info?.title || "unknown", version: spec.info?.version || "1.0" },
      paths: Object.keys(spec.paths || {}),
      operations: extractOpenApiOperations(spec),
    };
  } catch {
    const paths = [];
    const matches = content.matchAll(/^\s*(\/[\w\/\-{}]+):\s*$/gm);
    for (const m of matches) {
      paths.push(m[1]);
    }
    return {
      info: { title: "unknown", version: "1.0" },
      paths: paths,
      operations: [],
    };
  }
}

function extractOpenApiOperations(spec) {
  const ops = [];
  if (!spec.paths) return ops;
  for (const [path, methods] of Object.entries(spec.paths)) {
    for (const [method, def] of Object.entries(methods)) {
      if (["get", "post", "put", "patch", "delete"].includes(method.toLowerCase())) {
        ops.push({
          method: method.toUpperCase(),
          path: path,
          operationId: def.operationId || null,
        });
      }
    }
  }
  return ops;
}

function parseProto(content, filePath) {
  const services = [];
  const messages = [];

  const pkgMatch = content.match(/package\s+(\w+(?:\.\w+)*)/);
  const packageName = pkgMatch ? pkgMatch[1] : "unknown";

  const serviceMatches = content.matchAll(/service\s+(\w+)\s*\{([^}]*)\}/g);
  for (const m of serviceMatches) {
    const methods = [];
    const methodMatches = m[2].matchAll(/rpc\s+(\w+)\s*\(([^)]+)\)\s*returns\s*\(([^)]+)\)/g);
    for (const mm of methodMatches) {
      methods.push({
        name: mm[1],
        input: mm[2].trim(),
        output: mm[3].trim(),
      });
    }
    services.push({ name: m[1], methods });
  }

  const messageMatches = content.matchAll(/message\s+(\w+)\s*\{([^}]*)\}/g);
  for (const m of messageMatches) {
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
    messages.push({ name: m[1], fields });
  }

  return {
    package: packageName,
    services: services,
    messages: messages,
  };
}

function parseGraphQL(content, filePath) {
  const types = [];
  const queries = [];
  const mutations = [];

  const typeMatches = content.matchAll(/type\s+(\w+)\s*\{([^}]*)\}/g);
  for (const m of typeMatches) {
    const fields = [];
    const fieldLines = m[2].split("\n");
    for (const line of fieldLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const fieldMatch = trimmed.match(/^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+)/);
      if (fieldMatch) {
        fields.push({ name: fieldMatch[1], type: fieldMatch[2].trim() });
      }
    }
    types.push({ name: m[1], fields });
  }

  const queryMatches = content.matchAll(/type\s+Query\s*\{([^}]*)\}/g);
  for (const m of queryMatches) {
    const qLines = m[1].split("\n");
    for (const line of qLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const qMatch = trimmed.match(/^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+)/);
      if (qMatch) {
        queries.push({ name: qMatch[1], type: qMatch[2].trim() });
      }
    }
  }

  const mutationMatches = content.matchAll(/type\s+Mutation\s*\{([^}]*)\}/g);
  for (const m of mutationMatches) {
    const mLines = m[1].split("\n");
    for (const line of mLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const mMatch = trimmed.match(/^(\w+)\s*(?:\([^)]*\))?\s*:\s*(.+)/);
      if (mMatch) {
        mutations.push({ name: mMatch[1], type: mMatch[2].trim() });
      }
    }
  }

  return {
    types: types,
    queries: queries,
    mutations: mutations,
  };
}
