// validators/impact-analysis.js — Analyzes blast radius of changes

import { readFileSync, existsSync, readdirSync, statSync } from "fs";
import { extname, basename, dirname, join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "impact-analysis";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const cwd = config.cwd || process.cwd();
  const threshold = config.impactThreshold || 10;

  // Get changed files from git
  const changedFiles = getChangedFiles(cwd);
  if (changedFiles.length === 0) {
    return new ValidatorResult({
      passed: true,
      duration_ms: Date.now() - startTime
    });
  }

  // Build dependency graph
  const graph = buildDependencyGraph(cwd, changedFiles);

  // Calculate blast radius for each changed file
  for (const file of changedFiles) {
    const dependents = graph.getDependents(file);
    if (dependents.length > threshold) {
      errors.push(new ValidatorError({
        file, line: 0, rule: "high-blast-radius",
        message: `Mudança em ${file} afeta ${dependents.length} arquivos (threshold: ${threshold})`,
        ai_hint: `A mudança em ${file} afeta ${dependents.length} arquivos. Considere dividir a mudança em partes menores ou revisar se a alteração é necessária. Arquivos afetados: ${dependents.slice(0, 5).join(", ")}${dependents.length > 5 ? "..." : ""}`,
        severity: "warning"
      }));
    }
  }

  // Check for broken imports
  for (const file of changedFiles) {
    if (!existsSync(join(cwd, file))) continue;
    const brokenImports = checkBrokenImports(cwd, file, graph);
    for (const broken of brokenImports) {
      errors.push(new ValidatorError({
        file: broken.importer, line: 0, rule: "broken-import",
        message: `Import quebrado: ${broken.importer} importa ${broken.target} que foi removido/modificado`,
        ai_hint: `${broken.importer} importa de ${broken.target} que não existe mais. Atualize o import ou restaure o arquivo removido.`,
        severity: "error"
      }));
    }
  }

  // Cross-service impact analysis (Gap 1)
  const crossServiceErrors = await checkCrossServiceImpact(cwd, changedFiles);
  errors.push(...crossServiceErrors);

  return new ValidatorResult({
    passed: errors.filter(e => e.severity === "error").length === 0,
    errors,
    duration_ms: Date.now() - startTime
  });
}

function getChangedFiles(cwd) {
  try {
    const output = execSync("git diff --cached --name-only --diff-filter=ACMR", {
      cwd, encoding: "utf-8", timeout: 5000
    }).toString();
    return output.trim().split("\n").filter(f => f && !f.startsWith(".zero-error/"));
  } catch {
    return [];
  }
}

function buildDependencyGraph(cwd, changedFiles) {
  const imports = new Map();

  // Scan all source files for imports
  const sourceFiles = findSourceFiles(cwd);
  for (const file of sourceFiles) {
    const content = readFileSync(file, "utf-8");
    const importedFiles = extractImports(file, content);
    imports.set(file, importedFiles);
  }

  return {
    getDependents(targetFile) {
      const dependents = [];
      const targetBase = basename(targetFile, extname(targetFile));
      for (const [file, deps] of imports) {
        if (deps.some(d => d.includes(targetBase) || d.includes(targetFile))) {
          dependents.push(file);
        }
      }
      return dependents;
    },
    getDependencies(file) {
      return imports.get(file) || [];
    }
  };
}

function findSourceFiles(cwd, maxDepth = 3) {
  const files = [];
  const SKIP = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "target", ".zero-error"];
  const EXTS = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".cs"];

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    const entries = readdirSync(dir);
    for (const entry of entries) {
      if (SKIP.includes(entry)) continue;
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        scan(full, depth + 1);
      } else if (EXTS.includes(extname(entry))) {
        files.push(full);
      }
    }
  }

  scan(cwd, 0);
  return files;
}

function extractImports(file, content) {
  const imports = [];
  const ext = extname(file);

  if (ext === ".ts" || ext === ".tsx" || ext === ".js" || ext === ".jsx") {
    // ES imports: import ... from '...'
    const esPattern = /import\s+(?:[\w{},\s*]+\s+from\s+)?['"]([^'"]+)['"]/g;
    for (const match of content.matchAll(esPattern)) {
      imports.push(match[1]);
    }
    // CommonJS: require('...')
    const cjsPattern = /require\s*\(\s*['"]([^'"]+)['"]\s*\)/g;
    for (const match of content.matchAll(cjsPattern)) {
      imports.push(match[1]);
    }
  } else if (ext === ".py") {
    const pyPattern = /(?:from\s+(\S+)\s+import|import\s+(\S+))/g;
    for (const match of content.matchAll(pyPattern)) {
      imports.push(match[1] || match[2]);
    }
  } else if (ext === ".rs") {
    const rustPattern = /use\s+([\w:]+)/g;
    for (const match of content.matchAll(rustPattern)) {
      imports.push(match[1]);
    }
  } else if (ext === ".go") {
    const goPattern = /import\s+"([^"]+)"/g;
    for (const match of content.matchAll(goPattern)) {
      imports.push(match[1]);
    }
  }

  return imports;
}

function checkBrokenImports(cwd, file, graph) {
  const broken = [];
  const deps = graph.getDependencies(join(cwd, file));

  for (const dep of deps) {
    if (dep.startsWith(".") || dep.startsWith("/")) {
      // Relative import — check if file exists
      const resolved = resolveImport(join(cwd, dirname(file)), dep);
      if (resolved && !existsSync(resolved)) {
        broken.push({ importer: file, target: dep });
      }
    }
  }

  return broken;
}

function resolveImport(baseDir, importPath) {
  const EXTS = [".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", "/index.ts", "/index.js"];
  const full = join(baseDir, importPath);
  if (existsSync(full)) return full;
  for (const ext of EXTS) {
    if (existsSync(full + ext)) return full + ext;
  }
  return null;
}

async function checkCrossServiceImpact(cwd, changedFiles) {
  const errors = [];

  try {
    const { trackCrossServiceContracts } = await import("../lib/cross-service-tracker.js");
    const result = trackCrossServiceContracts(cwd);

    for (const risk of result.risks) {
      if (risk.severity === "warning") {
        errors.push(new ValidatorError({
          file: risk.target,
          line: 0,
          rule: "cross-service-high-coupling",
          message: risk.reason,
          ai_hint: "Coordinate contract changes with all consumer services. Consider versioning the API.",
          severity: "warning",
        }));
      }
    }

    for (const file of changedFiles) {
      const isContractFile = file.includes("openapi") || file.includes("swagger") ||
        file.endsWith(".proto") || file.endsWith(".graphql") || file.endsWith(".gql");

      if (isContractFile) {
        const consumers = result.consumers.filter(c =>
          result.graph.edges.some(e => e.from === c.file)
        );
        if (consumers.length > 0) {
          errors.push(new ValidatorError({
            file: file,
            line: 0,
            rule: "cross-service-contract-changed",
            message: `Contract file "${file}" was modified. ${consumers.length} consumer(s) may be affected.`,
            ai_hint: `Consumers: ${consumers.slice(0, 5).map(c => c.file).join(", ")}. Verify all consumers are updated.`,
            severity: "warning",
          }));
        }
      }
    }
  } catch {}

  return errors;
}
