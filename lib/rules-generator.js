// lib/rules-generator.js — Generates rules files for each IDE

import { writeFileSync, mkdirSync, existsSync, symlinkSync, readFileSync } from "fs";
import { join, dirname } from "path";

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
      // Fallback: write CONSTITUTION.md in root (already there)
      break;
  }
}
