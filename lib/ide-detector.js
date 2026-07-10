// lib/ide-detector.js — Auto-detects which IDE is running

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { execSync } from "child_process";

export function detectIDE(cwd = process.cwd()) {
  // 1. Variáveis de ambiente
  if (process.env.CURSOR_DEBUG) return "cursor";
  if (process.env.WINDSURF_DEBUG) return "windsurf";
  if (process.env.VSCODE_CLI) {
    const parent = getParentProcessName();
    if (parent.includes("Cursor")) return "cursor";
    if (parent.includes("Windsurf")) return "windsurf";
    if (parent.includes("Code")) return "vscode";
  }
  if (process.env.IDEA_INITIAL_DIRECTORY || process.env.INTELLIJ_ENVIRONMENT_READER) return "jetbrains";
  if (process.env.NVIM || process.env.VIMRUNTIME) return "neovim";

  // 2. Arquivos de workspace
  if (existsSync(join(cwd, ".cursor"))) return "cursor";
  if (existsSync(join(cwd, ".windsurf"))) return "windsurf";
  if (existsSync(join(cwd, ".vscode"))) return "vscode";
  if (existsSync(join(cwd, ".idea"))) return "jetbrains";
  if (existsSync(join(cwd, ".cline"))) return "cline";

  // 3. Processo pai
  const parent = getParentProcessName();
  if (parent.includes("cursor")) return "cursor";
  if (parent.includes("windsurf")) return "windsurf";
  if (parent.includes("aider")) return "aider";
  if (parent.includes("nvim")) return "neovim";
  if (parent.includes("idea") || parent.includes("intellij")) return "jetbrains";

  // 4. Fallback: gera para todas as IDEs conhecidas
  return "all";
}

function getParentProcessName() {
  try {
    const pid = process.ppid;
    if (process.platform === "win32") {
      const name = execSync(`wmic process where processid=${pid} get name`, { encoding: "utf-8" });
      return name.toLowerCase();
    } else {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf-8");
      const name = stat.split(" ")[1].replace(/[()]/g, "");
      return name.toLowerCase();
    }
  } catch {
    return "";
  }
}

export const IDE_RULES_MAP = {
  cursor: ".cursorrules",
  windsurf: ".windsurfrules",
  cline: ".clinerules",
  vscode: ".github/copilot-instructions.md",
  jetbrains: ".ai/instructions.md",
  neovim: ".nvim/zero-error.lua",
  aider: ".aider.conf.yml",
};

export const ALL_IDES = ["cursor", "windsurf", "cline", "vscode", "jetbrains", "neovim", "aider"];
