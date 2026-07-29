// lib/prompt-salt.js — Micro-anchor of re-alignment injected at end of each AI response
// Combats the "Broken Telephone Effect" where IDEs truncate old messages and
// the system rules evaporate from the LLM's attention cycle.
// Zero IA calls. Pure template generation.

import { createHash } from "crypto";

const CRITICAL_RULE_HASHES = [
  { id: "preemption", description: "Preemption Command overrides host IDE prompts" },
  { id: "perf-budget", description: "N+1 queries and unbounded loops are blocked" },
  { id: "critical-paths", description: "Critical paths require mandatory test coverage" },
  { id: "rollback", description: "Every change must include a rollback plan" },
  { id: "feature-flags", description: "New features must use existing feature flags" },
];

export function generatePromptSalt(systemRulesContent, sourceOfTruthContent, perfBudgetRules) {
  const rules = selectCriticalRules(systemRulesContent, sourceOfTruthContent, perfBudgetRules);
  const hashes = rules.map(r => ({
    id: r.id,
    hash: hashRule(r.content),
  }));

  const saltLine = formatSaltLine(hashes);

  return {
    salt: saltLine,
    hashes: hashes,
    rules: rules.map(r => ({ id: r.id, description: r.description })),
  };
}

function selectCriticalRules(systemRules, sourceOfTruth, perfBudget) {
  const rules = [];

  const preemptionMatch = systemRules.match(/Este repositório opera sob[^\n]*/);
  rules.push({
    id: "preemption",
    description: CRITICAL_RULE_HASHES[0].description,
    content: preemptionMatch ? preemptionMatch[0] : "Preemption Command active",
  });

  rules.push({
    id: "perf-budget",
    description: CRITICAL_RULE_HASHES[1].description,
    content: perfBudget || "Performance budget: no N+1, no unbounded loops, no SELECT *",
  });

  const criticalPathsMatch = sourceOfTruth.match(/"critical_paths"\s*:\s*\[([^\]]*)\]/);
  rules.push({
    id: "critical-paths",
    description: CRITICAL_RULE_HASHES[2].description,
    content: criticalPathsMatch ? `critical_paths: [${criticalPathsMatch[1]}]` : "critical_paths: []",
  });

  rules.push({
    id: "rollback",
    description: CRITICAL_RULE_HASHES[3].description,
    content: "Payload section 4: PLANO DE ROLLBACK IMEDIATO is mandatory",
  });

  rules.push({
    id: "feature-flags",
    description: CRITICAL_RULE_HASHES[4].description,
    content: "New features must use existing feature flags from shadow-context.md",
  });

  return rules;
}

function hashRule(content) {
  return createHash("sha256").update(content).digest("hex").substring(0, 8);
}

function formatSaltLine(hashes) {
  const ruleParts = hashes.map(h => `${h.id}=${h.hash}`).join(",");
  return `<!-- @ai-salt: rules=${ruleParts} | v=2 -->`;
}

export function getSaltInstruction() {
  return [
    "## Prompt Salt (Re-Alinhamento de Atenção)",
    "",
    "Cada resposta gerada pela IA DEVE terminar com a seguinte linha oculta:",
    "```",
    "<!-- @ai-salt: rules=preemption=<hash>,perf-budget=<hash>,critical-paths=<hash>,rollback=<hash>,feature-flags=<hash> | v=2 -->",
    "```",
    "",
    "Esta linha re-injeta os hashes das 5 regras mais críticas no ciclo de atenção da mensagem seguinte.",
    "O validator `context-drift-check.js` verifica a presença desta linha via RegEx.",
    "Se faltar → WARNING: a regra pode ter sido esquecida pela IA devido à compressão do histórico.",
    "",
  ].join("\n");
}

export function validateSaltPresence(responseText) {
  const saltRegex = /<!--\s*@ai-salt:\s*rules=([^|]+)\s*\|\s*v=2\s*-->/;
  const match = responseText.match(saltRegex);

  if (!match) {
    return {
      present: false,
      warning: "Prompt Salt ausente no final da resposta. A IA pode ter perdido o alinhamento com as regras críticas.",
    };
  }

  const ruleParts = match[1].split(",");
  const ruleIds = ruleParts.map(p => p.split("=")[0].trim());

  const expectedIds = CRITICAL_RULE_HASHES.map(r => r.id);
  const missing = expectedIds.filter(id => !ruleIds.includes(id));

  if (missing.length > 0) {
    return {
      present: true,
      warning: `Prompt Salt presente mas faltam regras: ${missing.join(", ")}`,
    };
  }

  return {
    present: true,
    warning: null,
  };
}
