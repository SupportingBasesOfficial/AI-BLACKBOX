// lib/rules-generator.js — Generates rules files for each IDE (v2 with Preemption Command)
// v2: content already includes Preemption Command as first line (from system-rules.md via context-budget.js)

import { writeFileSync, mkdirSync, existsSync, readFileSync } from "fs";
import { join } from "path";

export function generateRulesFileV2(ide, rulesContent, cwd = process.cwd()) {
  switch (ide) {
    case "cursor":
      writeFileSync(join(cwd, ".cursorrules"), rulesContent);
      break;
    case "windsurf":
      writeFileSync(join(cwd, ".windsurfrules"), rulesContent);
      break;
    case "cline":
      writeFileSync(join(cwd, ".clinerules"), rulesContent);
      break;
    case "vscode":
      const githubDir = join(cwd, ".github");
      if (!existsSync(githubDir)) mkdirSync(githubDir, { recursive: true });
      writeFileSync(join(githubDir, "copilot-instructions.md"), rulesContent);
      break;
    case "jetbrains":
      const aiDir = join(cwd, ".ai");
      if (!existsSync(aiDir)) mkdirSync(aiDir, { recursive: true });
      writeFileSync(join(aiDir, "instructions.md"), rulesContent);
      break;
    case "neovim":
      const nvimDir = join(cwd, ".nvim");
      if (!existsSync(nvimDir)) mkdirSync(nvimDir, { recursive: true });
      const luaContent = `-- AI Black Box v2 — Neovim config (avante.nvim)\n-- Preemption Command + system-rules injected as system prompt\nlocal rules = [===[\n${rulesContent}\n]===]\nreturn { rules = rules }`;
      writeFileSync(join(nvimDir, "zero-error.lua"), luaContent);
      break;
    case "aider":
      const aiderConf = `# AI Black Box v2 — Aider config\nmodel: gpt-4\nauto_commits: false\nread:\n  - .zero-error/system-rules.md\n  - .zero-error/tech-stack.json\n  - .zero-error/architecture-map.md`;
      writeFileSync(join(cwd, ".aider.conf.yml"), aiderConf);
      writeFileSync(join(cwd, "CONVENTIONS.md"), rulesContent);
      break;
    default:
      writeFileSync(join(cwd, ".ai-blackbox-rules.md"), rulesContent);
      break;
  }
}

export function generateRulesFile(ide, doctrinePath, constitutionPath, cwd = process.cwd()) {
  const doctrineContent = readFileSync(doctrinePath, "utf-8");
  const constitutionContent = existsSync(constitutionPath)
    ? readFileSync(constitutionPath, "utf-8")
    : "";

  const combined = `${doctrineContent}\n\n---\n\n${constitutionContent}`;

  switch (ide) {
    case "cursor":
      writeFileSync(join(cwd, ".cursorrules"), combined);
      break;
    case "windsurf":
      writeFileSync(join(cwd, ".windsurfrules"), combined);
      break;
    case "cline":
      writeFileSync(join(cwd, ".clinerules"), combined);
      break;
    case "vscode":
      const githubDir = join(cwd, ".github");
      if (!existsSync(githubDir)) mkdirSync(githubDir, { recursive: true });
      writeFileSync(join(githubDir, "copilot-instructions.md"), combined);
      break;
    case "jetbrains":
      const aiDir = join(cwd, ".ai");
      if (!existsSync(aiDir)) mkdirSync(aiDir, { recursive: true });
      writeFileSync(join(aiDir, "instructions.md"), combined);
      break;
    case "neovim":
      const nvimDir = join(cwd, ".nvim");
      if (!existsSync(nvimDir)) mkdirSync(nvimDir, { recursive: true });
      const luaContent = `-- Zero-Error Black Box — Neovim config (avante.nvim)\n-- Doctrine and Constitution injected as system prompt\nlocal doctrine = [===[\n${doctrineContent}\n]===]\nlocal constitution = [===[\n${constitutionContent}\n]===]\nreturn { doctrine = doctrine, constitution = constitution }`;
      writeFileSync(join(nvimDir, "zero-error.lua"), luaContent);
      break;
    case "aider":
      const aiderConf = `# Zero-Error Black Box — Aider config\nmodel: gpt-4\nauto_commits: false\nread:\n  - CONSTITUTION.md\n  - .zero-error/doctrine.md`;
      writeFileSync(join(cwd, ".aider.conf.yml"), aiderConf);
      writeFileSync(join(cwd, "CONVENTIONS.md"), combined);
      break;
    default:
      break;
  }
}
