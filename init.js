#!/usr/bin/env node
// init.js — Zero-Error Black Box bootstrap
// Clones into any project, auto-detects IDE, infers Constitution, installs hooks.

import { existsSync, writeFileSync, copyFileSync, mkdirSync, readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const cwd = process.cwd();

async function main() {
  console.log("Zero-Error: Inicializando black box...\n");

  // 1. Detectar IDE
  const { detectIDE, ALL_IDES } = await import("./lib/ide-detector.js");
  const ide = detectIDE(cwd);
  console.log(`  IDE detectada: ${ide}`);

  // 2. Detectar linguagem
  const { detectLanguages, LANGUAGE_TOOLS } = await import("./lib/language-detector.js");
  const languages = detectLanguages(cwd);
  console.log(`  Linguagens: ${languages.join(", ")}`);

  // 3. Scan do projeto
  const { scanProject, inferConstitution, renderConstitution } = await import("./lib/constitution-inference.js");
  console.log("\n  Escaneando projeto...");
  const scan = await scanProject(cwd, languages);
  console.log(`  Arquivos analisados: ${scan.files.length}`);
  console.log(`  Frameworks detectados: ${scan.frameworks.length ? scan.frameworks.join(", ") : "nenhum"}`);

  // 4. Inferir Constitution
  console.log("\n  Inferindo Constitution...");
  const constitution = inferConstitution(scan, languages);

  // 5. Escrever CONSTITUTION.md
  const constitutionPath = join(cwd, "CONSTITUTION.md");
  if (!existsSync(constitutionPath)) {
    writeFileSync(constitutionPath, renderConstitution(constitution));
    console.log("  CONSTITUTION.md gerado. Revise e ajuste conforme necessário.");
  } else {
    console.log("  CONSTITUTION.md já existe. Pulando.");
  }

  // 6. Escrever doctrine.md (se não existir no .zero-error)
  const doctrinePath = join(__dirname, "doctrine.md");
  if (!existsSync(doctrinePath)) {
    const doctrineContent = readFileSync(join(__dirname, "doctrine.md"), "utf-8").catch(() => "");
  }

  // 7. Gerar rules file da IDE detectada
  const { generateRulesFile } = await import("./lib/rules-generator.js");
  console.log(`\n  Gerando rules file para: ${ide}`);
  if (ide === "all") {
    for (const targetIde of ALL_IDES) {
      generateRulesFile(targetIde, doctrinePath, constitutionPath, cwd);
    }
    console.log("  Rules files gerados para todas as IDEs conhecidas.");
  } else {
    generateRulesFile(ide, doctrinePath, constitutionPath, cwd);
    console.log(`  Rules file gerado: ${ide}`);
  }

  // 8. Instalar git hooks
  const gitDir = join(cwd, ".git");
  if (existsSync(gitDir)) {
    const hooksDir = join(gitDir, "hooks");
    if (!existsSync(hooksDir)) mkdirSync(hooksDir, { recursive: true });

    const preCommitSrc = join(__dirname, "hooks", "pre-commit");
    const prePushSrc = join(__dirname, "hooks", "pre-push");

    if (existsSync(preCommitSrc)) {
      copyFileSync(preCommitSrc, join(hooksDir, "pre-commit"));
      makeExecutable(join(hooksDir, "pre-commit"));
      console.log("  Git hook pre-commit instalado.");
    }
    if (existsSync(prePushSrc)) {
      copyFileSync(prePushSrc, join(hooksDir, "pre-push"));
      makeExecutable(join(hooksDir, "pre-push"));
      console.log("  Git hook pre-push instalado.");
    }
  } else {
    console.log("  Sem .git/ — hooks não instalados (rode em um repo git).");
  }

  // 9. Adicionar CI/CD workflow
  const githubDir = join(cwd, ".github");
  if (existsSync(githubDir)) {
    const workflowsDir = join(githubDir, "workflows");
    if (!existsSync(workflowsDir)) mkdirSync(workflowsDir, { recursive: true });
    const workflowSrc = join(__dirname, "workflows", "zero-error.yml");
    if (existsSync(workflowSrc)) {
      copyFileSync(workflowSrc, join(workflowsDir, "zero-error.yml"));
      console.log("  GitHub Actions workflow adicionado.");
    }
  }

  // 10. Configurar validators
  console.log(`\n  Validators configurados para: ${languages.join(", ")}`);
  console.log(`  Tools: ${languages.map(l => LANGUAGE_TOOLS[l]?.typeCheck || "N/A").join(", ")}`);

  console.log("\nZero-Error: Pronto. Abra a IDE e a IA já opera sob a Doutrina.");
  console.log("Zero-Error: Revise CONSTITUTION.md antes de commitar.\n");
}

function makeExecutable(filePath) {
  try {
    if (process.platform !== "win32") {
      execSync(`chmod +x "${filePath}"`);
    }
  } catch {}
}

main().catch(err => {
  console.error("Zero-Error: Erro na inicialização:", err.message);
  process.exit(1);
});
