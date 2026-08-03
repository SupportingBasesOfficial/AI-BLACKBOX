// lib/incremental-updater.js — Incremental update on pre-commit
// Only processes changed files (git diff), updates relevant entries.
// Zero IA calls. Pure git + file system.

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, relative, dirname, basename } from "path";

export function getChangedFiles(cwd, staged = true) {
  const flag = staged ? "--cached" : "";
  try {
    const output = execSync(`git diff --name-only ${flag} HEAD`, {
      cwd: cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!output) return [];
    return output.split("\n").filter(f => f.length > 0);
  } catch {
    try {
      const output = execSync("git diff --name-only", {
        cwd: cwd,
        encoding: "utf-8",
        timeout: 5000,
      }).trim();
      if (!output) return [];
      return output.split("\n").filter(f => f.length > 0);
    } catch {
      return [];
    }
  }
}

export async function incrementalUpdate(cwd, zeroErrorDir) {
  const changedFiles = getChangedFiles(cwd, true);
  if (changedFiles.length === 0) {
    return { updated: false, reason: "No changed files", changedFiles: [] };
  }

  const updates = {
    stateContext: false,
    architectureMap: false,
    blackboxIndex: false,
    anchorsInjected: 0,
  };

  updates.stateContext = updateStateContext(zeroErrorDir, changedFiles);

  const codeFiles = changedFiles.filter(f => {
    const ext = f.split(".").pop().toLowerCase();
    return ["ts", "js", "tsx", "jsx", "py", "go", "rs", "java"].includes(ext);
  });

  if (codeFiles.length > 0) {
    try {
      const { scanProject } = await import("./context-scanner.js");
      const { mapArchitecture, generateArchitectureMap } = await import("./architecture-mapper.js");

      const scanResult = scanProject(cwd);
      scanResult._rootDir = cwd;
      const archMap = mapArchitecture(scanResult);

      const archMapContent = generateArchitectureMap(archMap, scanResult);
      writeFileSync(join(zeroErrorDir, "architecture-map.md"), archMapContent);
      updates.architectureMap = true;

      const blackboxIndex = generateBlackboxIndex(archMap, scanResult);
      writeFileSync(join(zeroErrorDir, "blackbox-index.json"), JSON.stringify(blackboxIndex, null, 2));
      updates.blackboxIndex = true;
    } catch {}
  }

  return {
    updated: true,
    changedFiles: changedFiles,
    updates: updates,
  };
}

function updateStateContext(zeroErrorDir, changedFiles) {
  const statePath = join(zeroErrorDir, "state-context.md");
  if (!existsSync(statePath)) return false;

  try {
    let content = readFileSync(statePath, "utf-8");

    const timestamp = new Date().toISOString();
    const changesSection = `## Ultimas Alteracoes\n- [${timestamp}] ${changedFiles.length} ficheiro(s): ${changedFiles.slice(0, 10).join(", ")}${changedFiles.length > 10 ? "..." : ""}\n`;

    const existingMatch = content.match(/## Ultimas Alteracoes\n([\s\S]*?)(?=## |$)/);
    if (existingMatch) {
      const existingLines = existingMatch[1].trim().split("\n").filter(l => l.trim().startsWith("-"));
      const newLines = [changesSection.trim().split("\n")[1], ...existingLines.slice(0, 9)];
      content = content.replace(
        /## Ultimas Alteracoes\n[\s\S]*?(?=## |$)/,
        `## Ultimas Alteracoes\n${newLines.join("\n")}\n\n`
      );
    } else {
      content += "\n" + changesSection;
    }

    writeFileSync(statePath, content);
    return true;
  } catch {
    return false;
  }
}

function generateBlackboxIndex(archMap, scanResult) {
  return {
    routes: {
      database: ".zero-error/architecture-map.md#state-store",
      api: ".zero-error/architecture-map.md#ingress",
      frontend: ".zero-error/architecture-map.md#ingress",
      business_logic: ".zero-error/architecture-map.md#logic-core",
    },
    rules: {
      error_handling: ".zero-error/code-standards.md#error-handling",
      security: ".zero-error/code-standards.md#security",
      naming: ".zero-error/code-standards.md#naming-conventions",
      anti_patterns: ".zero-error/code-standards.md#anti-patterns-proibidos",
      feature_flags: ".zero-error/shadow-context.md#feature-flags-ativas",
    },
    critical_paths: scanResult.criticalPaths.map(cp => cp.path),
    monorepo: scanResult.monorepo,
    packages: scanResult.monorepoPackages.map(p => p.name),
  };
}

// CLI entry point: node lib/incremental-updater.js [cwd] [zeroErrorDir]
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
if (process.argv[1] && fileURLToPath(`file://${process.argv[1].replace(/\\/g, "/")}`) === __filename) {
  const cliCwd = process.argv[2] || process.cwd();
  const cliZeroErrorDir = process.argv[3] || join(cliCwd, ".zero-error");
  incrementalUpdate(cliCwd, cliZeroErrorDir).then(result => {
    if (result.updated) {
      console.log(`Incremental update: ${result.changedFiles.length} files`);
    }
  }).catch(() => {});
}
