// lib/constitution-inference.js — Infers Constitution from existing code

import { readdirSync, readFileSync, statSync, existsSync } from "fs";
import { join, extname } from "path";

export function inferConstitution(scan, languages) {
  const invariants = [];
  const standards = [];
  const prohibitions = [];

  // === Nível 1: Heurística determinística ===

  // TypeScript: verificar uso de any
  if (languages.includes("typescript")) {
    const hasAny = scan.files.some(f => f.content.includes(": any") || f.content.includes("as any"));
    if (!hasAny) {
      invariants.push("Proibido `any` em TypeScript. Use `unknown` + type guard.");
    }
    prohibitions.push("Workarounds (sempre resolver a causa raiz)");
    prohibitions.push("`any` em TypeScript (usar `unknown` + type guard)");
  }

  // Verificar console.log em produção
  const hasConsoleLogInSrc = scan.files.some(f =>
    f.path.includes("src/") &&
    !f.path.includes(".test.") &&
    !f.path.includes(".spec.") &&
    f.content.includes("console.log")
  );
  if (!hasConsoleLogInSrc) {
    invariants.push("Proibido `console.log` em produção (usar logger estruturado)");
  }

  // Verificar TODO/FIXME
  const hasTODO = scan.files.some(f =>
    f.content.match(/\b(TODO|FIXME|HACK)\b/)
  );
  if (!hasTODO) {
    invariants.push("Proibido TODO/FIXME/HACK no código");
  }

  // Funções com tipo de retorno explícito
  if (languages.includes("typescript")) {
    const allHaveReturnTypes = scan.files
      .filter(f => f.path.endsWith(".ts"))
      .every(f => !f.content.match(/function\s+\w+\s*\([^)]*\)\s*\{/));
    if (allHaveReturnTypes && scan.files.some(f => f.path.endsWith(".ts"))) {
      invariants.push("Toda função tem tipo de retorno explícito");
    }
  }

  // === Padrões ===
  standards.push(`Linguagem: ${languages.join(", ")}`);

  // Detectar framework
  if (scan.frameworks.length > 0) {
    standards.push(`Framework: ${scan.frameworks.join(", ")}`);
  }

  // === Proibições padrão (sempre incluídas) ===
  prohibitions.push("Try/catch vazio ou que silencia erro");
  prohibitions.push("Cast forçado (`as any`, `as unknown as X`)");
  prohibitions.push("Lógica duplicada");
  prohibitions.push("Abstrações usadas apenas uma vez");
  prohibitions.push("Imports não-usados");
  prohibitions.push("Funções > 50 linhas");

  return {
    invariants,
    standards,
    prohibitions,
    direction: {
      objective: "[definido pelo usuário]",
      priority: "[definida pelo usuário]",
      ready: "100% do critério de aceitação",
    },
    meta: {
      version: 1,
      last_updated: new Date().toISOString().split("T")[0],
      updated_by: "zero-error/init",
      changelog: [`v1: Constitution inicial gerada pelo black box`],
    },
    validation: {
      requireTests: true,
      preCommitTimeout: 30,
      prePushTimeout: 120,
      ciTimeout: 600,
      mutationThreshold: 80,
      coverageThreshold: 80,
    },
  };
}

export function renderConstitution(constitution) {
  let md = "# CONSTITUTION\n\n";

  md += "## Meta\n";
  md += `- version: ${constitution.meta.version}\n`;
  md += `- last_updated: ${constitution.meta.last_updated}\n`;
  md += `- updated_by: ${constitution.meta.updated_by}\n`;
  md += `- changelog:\n`;
  for (const entry of constitution.meta.changelog) {
    md += `  - ${entry}\n`;
  }

  md += "\n## Invariantes\n";
  for (const inv of constitution.invariants) {
    md += `- ${inv}\n`;
  }

  md += "\n## Direção\n";
  md += `- Objetivo: ${constitution.direction.objective}\n`;
  md += `- Prioridade: ${constitution.direction.priority}\n`;
  md += `- Pronto = ${constitution.direction.ready}\n`;

  md += "\n## Padrões\n";
  for (const std of constitution.standards) {
    md += `- ${std}\n`;
  }

  md += "\n## Proibições\n";
  for (const pro of constitution.prohibitions) {
    md += `- ${pro}\n`;
  }

  md += "\n## Doutrina do 100%\n";
  md += "- 100% é o critério de aceitação mínimo\n";
  md += "- Workarounds são proibidos\n";
  md += "- Estudo pré-execução é obrigatório\n";
  md += "- Fluxo: ENTENDER → ESTUDAR → PLANEJAR → EXECUTAR → VERIFICAR\n";

  md += "\n## Configuração de Validação\n";
  md += `- requireTests: ${constitution.validation.requireTests}\n`;
  md += `- preCommitTimeout: ${constitution.validation.preCommitTimeout}\n`;
  md += `- prePushTimeout: ${constitution.validation.prePushTimeout}\n`;
  md += `- ciTimeout: ${constitution.validation.ciTimeout}\n`;
  md += `- mutationThreshold: ${constitution.validation.mutationThreshold}\n`;
  md += `- coverageThreshold: ${constitution.validation.coverageThreshold}\n`;

  return md;
}

export async function scanProject(cwd, languages) {
  const files = [];
  const frameworks = [];
  const patterns = [];
  const antiPatterns = [];

  // Scan files (max depth 3, skip node_modules/.git/dist)
  scanDir(cwd, cwd, files, 3);

  // Detect frameworks
  if (existsSync(join(cwd, "package.json"))) {
    try {
      const pkg = JSON.parse(readFileSync(join(cwd, "package.json"), "utf-8"));
      const deps = { ...pkg.dependencies, ...pkg.devDependencies };
      if (deps["react"]) frameworks.push("React");
      if (deps["next"]) frameworks.push("Next.js");
      if (deps["vue"]) frameworks.push("Vue");
      if (deps["express"]) frameworks.push("Express");
      if (deps["hono"]) frameworks.push("Hono");
      if (deps["fastify"]) frameworks.push("Fastify");
      if (deps["nestjs"]) frameworks.push("NestJS");
    } catch {}
  }
  if (existsSync(join(cwd, "requirements.txt"))) {
    const reqs = readFileSync(join(cwd, "requirements.txt"), "utf-8");
    if (reqs.includes("fastapi")) frameworks.push("FastAPI");
    if (reqs.includes("django")) frameworks.push("Django");
    if (reqs.includes("flask")) frameworks.push("Flask");
  }

  return { files, frameworks, patterns, antiPatterns };
}

function scanDir(root, dir, files, maxDepth, currentDepth = 0) {
  if (currentDepth > maxDepth) return;
  const SKIP = ["node_modules", ".git", "dist", "build", ".next", "__pycache__", "target", ".zero-error"];

  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (SKIP.includes(entry)) continue;
    const fullPath = join(dir, entry);
    let stat;
    try {
      stat = statSync(fullPath);
    } catch {
      continue;
    }

    if (stat.isDirectory()) {
      scanDir(root, fullPath, files, maxDepth, currentDepth + 1);
    } else if (stat.isFile()) {
      const ext = extname(entry);
      if ([".ts", ".tsx", ".js", ".jsx", ".py", ".rs", ".go", ".java", ".cs"].includes(ext)) {
        try {
          const content = readFileSync(fullPath, "utf-8");
          files.push({ path: fullPath.replace(root + "\\", "").replace(root + "/", ""), content });
        } catch {}
      }
    }
  }
}
