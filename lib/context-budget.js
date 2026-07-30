// lib/context-budget.js — Token Pruning engine to keep rules file < 8KB
// Zero IA calls. Pure RegEx + byte measurement.
// 3 levels: always inject → dynamic by git diff → compress if > 8KB

import { readFileSync, existsSync } from "fs";
import { join } from "path";

const BUDGET_LIMIT_BYTES = 8000;
const BUDGET_WARN_BYTES = 6000;

export function buildRulesFile(zeroErrorDir, gitDiffModule = null) {
  const level1 = buildLevel1(zeroErrorDir);
  let total = level1.content;

  const level2 = buildLevel2(zeroErrorDir, gitDiffModule);
  total += "\n\n" + level2.content;

  let totalBytes = Buffer.byteLength(total, "utf-8");

  let level3Applied = false;
  if (totalBytes > BUDGET_LIMIT_BYTES) {
    const compressed = applyLevel3(total);
    total = compressed.content;
    totalBytes = Buffer.byteLength(total, "utf-8");
    level3Applied = true;
  }

  if (totalBytes > BUDGET_LIMIT_BYTES) {
    const stripped = stripCodeStandards(total, zeroErrorDir);
    total = stripped.content;
    totalBytes = Buffer.byteLength(total, "utf-8");
  }

  if (totalBytes > BUDGET_LIMIT_BYTES) {
    const cutPoint = total.lastIndexOf("\n", BUDGET_LIMIT_BYTES - 200);
    total = total.substring(0, cutPoint > 0 ? cutPoint : BUDGET_LIMIT_BYTES - 200) +
      "\n\n... (truncated to fit budget)";
    totalBytes = Buffer.byteLength(total, "utf-8");
  }

  return {
    content: total,
    bytes: totalBytes,
    withinBudget: totalBytes <= BUDGET_LIMIT_BYTES,
    level3Applied: level3Applied,
    sections: {
      systemRules: level1.hasSystemRules,
      sourceOfTruth: level1.hasSourceOfTruth,
      blackboxIndex: level1.hasBlackboxIndex,
      techDebt: level1.hasTechDebt,
      architectureMap: level2.hasArchitectureMap,
      module: level2.module,
    },
  };
}

function buildLevel1(zeroErrorDir) {
  const parts = [];
  let hasSystemRules = false;
  let hasSourceOfTruth = false;
  let hasBlackboxIndex = false;
  let hasTechDebt = false;

  const systemRulesPath = join(zeroErrorDir, "system-rules.md");
  if (existsSync(systemRulesPath)) {
    const content = readFileSync(systemRulesPath, "utf-8");
    parts.push(content);
    hasSystemRules = true;
  }

  const sourceOfTruthPath = join(zeroErrorDir, "source-of-truth.json");
  if (existsSync(sourceOfTruthPath)) {
    const content = readFileSync(sourceOfTruthPath, "utf-8");
    parts.push("\n## Source of Truth\n```json\n" + content + "\n```");
    hasSourceOfTruth = true;
  }

  const blackboxIndexPath = join(zeroErrorDir, "blackbox-index.json");
  if (existsSync(blackboxIndexPath)) {
    const content = readFileSync(blackboxIndexPath, "utf-8");
    parts.push("\n## Semantic Index\n```json\n" + content + "\n```");
    hasBlackboxIndex = true;
  }

  const techDebtPath = join(zeroErrorDir, "tech-debt-report.json");
  if (existsSync(techDebtPath)) {
    try {
      const debtContent = readFileSync(techDebtPath, "utf-8");
      const debt = JSON.parse(debtContent);
      if (debt.summary && debt.summary.total_findings > 0) {
        const debtLines = [];
        debtLines.push("\n## Tech Debt Audit");
        debtLines.push(`Total: ${debt.summary.total_findings} findings (${debt.summary.critical} critical, ${debt.summary.warnings} warnings, ${debt.summary.info} info)`);
        const criticals = debt.findings.filter(f => f.severity === "critical");
        if (criticals.length > 0) {
          debtLines.push("\n### CRITICAL — Must fix before commit");
          for (const c of criticals.slice(0, 5)) {
            debtLines.push(`- [${c.type}] ${c.package || c.env_var}: ${c.message}`);
          }
        }
        const warnings = debt.findings.filter(f => f.severity === "warning");
        if (warnings.length > 0) {
          debtLines.push("\n### Warnings");
          for (const w of warnings.slice(0, 5)) {
            debtLines.push(`- [${w.type}] ${w.package || w.env_var}: ${w.message}`);
          }
        }
        parts.push(debtLines.join("\n"));
        hasTechDebt = true;
      }
    } catch {}
  }

  return {
    content: parts.join("\n\n"),
    hasSystemRules,
    hasSourceOfTruth,
    hasBlackboxIndex,
    hasTechDebt,
  };
}

function buildLevel2(zeroErrorDir, gitDiffModule) {
  const archMapPath = join(zeroErrorDir, "architecture-map.md");
  let hasArchitectureMap = false;
  let module = null;

  if (!existsSync(archMapPath)) {
    return { content: "", hasArchitectureMap: false, module: null };
  }

  const content = readFileSync(archMapPath, "utf-8");
  hasArchitectureMap = true;

  if (gitDiffModule) {
    module = gitDiffModule;
    const section = extractModuleSection(content, gitDiffModule);
    if (section) {
      return {
        content: "## Architecture Map (filtered: " + gitDiffModule + ")\n" + section,
        hasArchitectureMap,
        module,
      };
    }
  }

  const compressed = compressArchitectureMap(content);
  return {
    content: "## Architecture Map (compressed)\n" + compressed,
    hasArchitectureMap,
    module,
  };
}

function extractModuleSection(content, moduleName) {
  const headerPattern = new RegExp(`^(#{1,3}\\s+.*${escapeRegex(moduleName)}.*)$`, "im");
  const match = content.match(headerPattern);
  if (!match) return null;

  const startIdx = match.index;
  const lines = content.substring(startIdx).split("\n");
  const sectionLines = [];
  const headerLevel = match[1].match(/^#+/)[0].length;

  sectionLines.push(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const headerMatch = lines[i].match(/^(#{1,3})\s+/);
    if (headerMatch && headerMatch[1].length <= headerLevel) {
      break;
    }
    sectionLines.push(lines[i]);
  }

  return sectionLines.join("\n");
}

function compressArchitectureMap(content) {
  let compressed = content;

  compressed = compressed.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split("\n");
    if (lines.length > 5) {
      return lines.slice(0, 3).join("\n") + "\n... (truncated)\n```";
    }
    return match;
  });

  compressed = compressed.replace(/\n{3,}/g, "\n\n");

  compressed = compressed.replace(/^> .*$/gm, "");

  return compressed.trim();
}

function applyLevel3(content) {
  let compressed = content;

  compressed = compressed.replace(/```[\s\S]*?```/g, (match) => {
    const lines = match.split("\n");
    if (lines.length > 3) {
      const lang = lines[0].match(/```(\w+)/);
      return "```" + (lang ? lang[1] : "") + "\n" + lines.slice(1, 2).join("\n") + "\n... (truncated for budget)\n```";
    }
    return match;
  });

  compressed = compressed.replace(/^[^#\n-*`].{80,}$/gm, (match) => {
    const words = match.split(/\s+/);
    if (words.length > 10) {
      return words.slice(0, 8).join(" ") + "...";
    }
    return match;
  });

  compressed = compressed.replace(/\n{3,}/g, "\n\n");

  compressed = compressed.replace(/^#{4,}.*$/gm, "");

  compressed = compressJsonBlocks(compressed);

  return {
    content: compressed.trim(),
  };
}

function compressJsonBlocks(content) {
  return content.replace(/```json\n([\s\S]*?)\n```/g, (match, jsonStr) => {
    try {
      const obj = JSON.parse(jsonStr);
      if (obj.lexical_glossary) {
        const glossary = obj.lexical_glossary;
        if (Array.isArray(glossary)) {
          obj.lexical_glossary = glossary.slice(0, 20);
          obj.lexical_glossary_truncated = true;
          obj.lexical_glossary_total = glossary.length;
        } else if (typeof glossary === "object") {
          const keys = Object.keys(glossary);
          const truncated = {};
          for (const k of keys.slice(0, 20)) {
            truncated[k] = glossary[k];
          }
          obj.lexical_glossary = truncated;
          obj.lexical_glossary_truncated = true;
          obj.lexical_glossary_total = keys.length;
        }
      }
      if (obj.critical_paths && Array.isArray(obj.critical_paths)) {
        obj.critical_paths = obj.critical_paths.slice(0, 15);
        obj.critical_paths_truncated = true;
      }
      if (obj.packages && Array.isArray(obj.packages)) {
        obj.packages = obj.packages.slice(0, 10);
      }
      if (obj.routes && Array.isArray(obj.routes)) {
        obj.routes = obj.routes.slice(0, 10);
      }
      if (obj.schemas && Array.isArray(obj.schemas)) {
        obj.schemas = obj.schemas.slice(0, 10);
      }
      if (obj.models && Array.isArray(obj.models)) {
        obj.models = obj.models.slice(0, 10);
      }
      if (obj.layers && typeof obj.layers === "object") {
        for (const layer of Object.keys(obj.layers)) {
          if (Array.isArray(obj.layers[layer]) && obj.layers[layer].length > 10) {
            obj.layers[layer] = obj.layers[layer].slice(0, 10);
            obj.layers[layer + "_truncated"] = true;
          }
        }
      }
      const compressed = JSON.stringify(obj, null, 0);
      if (compressed.length < jsonStr.length) {
        return "```json\n" + compressed + "\n```";
      }
    } catch {}
    return match;
  });
}

function stripCodeStandards(content, zeroErrorDir) {
  const codeStandardsPath = join(zeroErrorDir, "code-standards.md");
  if (!existsSync(codeStandardsPath)) {
    return { content };
  }

  const codeStandards = readFileSync(codeStandardsPath, "utf-8");
  const antiPatterns = extractAntiPatterns(codeStandards);

  let compressed = content;

  compressed = compressed.replace(/## Code Standards[\s\S]*?(?=## |$)/g, "");

  if (antiPatterns.length > 0) {
    compressed += "\n\n## Anti-Patterns (compressed)\n";
    for (const ap of antiPatterns) {
      compressed += `- ${ap}\n`;
    }
  }

  return {
    content: compressed.trim(),
  };
}

function extractAntiPatterns(content) {
  const patterns = [];
  const sectionMatch = content.match(/## Anti-?Patterns?\s*\n([\s\S]*?)(?=## |$)/i);
  if (!sectionMatch) return patterns;

  const lines = sectionMatch[1].split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("- ") || trimmed.startsWith("* ")) {
      const text = trimmed.replace(/^[-*]\s+/, "").split(":")[0].trim();
      if (text.length > 0) {
        patterns.push(text);
      }
    }
  }

  return patterns;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function getBudgetReport(rulesFileResult) {
  return {
    bytes: rulesFileResult.bytes,
    limit: BUDGET_LIMIT_BYTES,
    withinBudget: rulesFileResult.withinBudget,
    percentage: Math.round((rulesFileResult.bytes / BUDGET_LIMIT_BYTES) * 100),
    level3Applied: rulesFileResult.level3Applied,
    sections: rulesFileResult.sections,
  };
}
