// validators/doctrine-check.js — The core Doctrine Checker validator

import { readFileSync, existsSync } from "fs";
import { extname, join } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "doctrine-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];

  for (const file of files) {
    let content;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    // === REGRA 1: Detecção de Workaround ===

    // 1a. Comentários suspeitos
    const workaroundPatterns = [
      /\b(TODO|FIXME|HACK|WORKAROUND|XXX|temporary|for now|hotfix)\b/gi
    ];
    for (const pattern of workaroundPatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        const line = getLineNumber(content, match.index);
        errors.push(new ValidatorError({
          file, line, rule: "workaround-comment",
          message: `Comentário suspeito: "${match[0]}"`,
          ai_hint: `Remova o comentário "${match[0]}" na linha ${line} de ${file}. Resolva a causa raiz em vez de deixar um TODO.`,
          severity: "error"
        }));
      }
    }

    // 1b. Try/catch vazio ou que silencia erro
    const tryCatchRegex = /try\s*[{(:]/g;
    const tryMatches = [...content.matchAll(tryCatchRegex)];
    for (const match of tryMatches) {
      const tryLine = getLineNumber(content, match.index);
      const catchBlock = findCatchBlock(content, match.index);
      if (catchBlock && catchBlock.isEmpty) {
        errors.push(new ValidatorError({
          file, line: tryLine, rule: "silent-catch",
          message: "Try/catch silencia erro em vez de tratá-lo",
          ai_hint: `O catch na linha ${tryLine} de ${file} está vazio ou apenas loga. Trate o erro explicitamente ou propague com throw.`,
          severity: "error"
        }));
      }
    }

    // 1c. Cast forçado (TypeScript)
    const castPatterns = [/as\s+any\b/gi, /as\s+unknown\s+as\b/gi];
    for (const pattern of castPatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        const line = getLineNumber(content, match.index);
        errors.push(new ValidatorError({
          file, line, rule: "forced-cast",
          message: `Cast forçado: "${match[0]}"`,
          ai_hint: `O cast "${match[0]}" na linha ${line} de ${file} contorna o type system. Use type guard ou narrowing em vez de cast forçado.`,
          severity: "error"
        }));
      }
    }

    // 1d. Lógica duplicada (detecta funções com nome similar)
    const functionPattern = /(?:function|def|fn|func)\s+(\w+)\s*[\(\{]/g;
    const funcMatches = [...content.matchAll(functionPattern)];
    const funcNames = funcMatches.map(m => m[1]);
    const duplicates = funcNames.filter((name, i) => funcNames.indexOf(name) !== i);
    for (const dup of [...new Set(duplicates)]) {
      const match = funcMatches.find(m => m[1] === dup);
      const line = getLineNumber(content, match.index);
      errors.push(new ValidatorError({
        file, line, rule: "duplicate-logic",
        message: `Função duplicada: "${dup}"`,
        ai_hint: `A função "${dup}" na linha ${line} de ${file} aparece mais de uma vez. Extraia a lógica comum para uma função compartilhada.`,
        severity: "warning"
      }));
    }

    // === REGRA 2: Caminho Mais Direto ===
    // Detecta abstrações de uso único (simplificado: verifica interfaces novas)
    const interfacePattern = /interface\s+(\w+)/g;
    const interfaceMatches = [...content.matchAll(interfacePattern)];
    for (const match of interfaceMatches) {
      const name = match[1];
      const line = getLineNumber(content, match.index);
      const usageCount = countOccurrences(content, name) - 1; // -1 for the declaration
      if (usageCount <= 1) {
        errors.push(new ValidatorError({
          file, line, rule: "single-use-abstraction",
          message: `Interface "${name}" usada apenas ${usageCount} vez`,
          ai_hint: `A interface "${name}" na linha ${line} de ${file} é usada apenas ${usageCount} vez. Inline a lógica em vez de criar abstração desnecessária.`,
          severity: "warning"
        }));
      }
    }

    // === REGRA 3: Certeza vs. Tentativa ===
    const tentativePatterns = [
      /\b(vamos tentar|pode ser que|talvez|veremos se|espero que|should work|hope this works|might work)\b/gi
    ];
    for (const pattern of tentativePatterns) {
      const matches = [...content.matchAll(pattern)];
      for (const match of matches) {
        const line = getLineNumber(content, match.index);
        errors.push(new ValidatorError({
          file, line, rule: "tentative-language",
          message: `Linguagem de tentativa: "${match[0]}"`,
          ai_hint: `O código em ${file} linha ${line} contém "${match[0]}". Remova a incerteza. Estude até ter certeza e execute de forma direta.`,
          severity: "error"
        }));
      }
    }

    // === REGRA 4: Critério de 100% ===
    // Verifica se há testes para o arquivo (se requireTests estiver ativo)
    if (config.requireTests !== false) {
      const ext = extname(file);
      const testExtensions = {
        ".ts": [".test.ts", ".spec.ts"],
        ".tsx": [".test.tsx", ".spec.tsx"],
        ".js": [".test.js", ".spec.js"],
        ".jsx": [".test.jsx", ".spec.jsx"],
        ".py": ["_test.py", "test_"],
        ".rs": ["_test.rs", "#[test]"],
        ".go": ["_test.go"],
      };
      const testExts = testExtensions[ext];
      if (testExts) {
        const hasTest = testExts.some(testExt => {
          if (testExt.startsWith("_") || testExt.startsWith("test_")) {
            return content.includes(testExt) || existsSync(file.replace(ext, testExt + ext));
          }
          return existsSync(file.replace(ext, testExt));
        });
        if (!hasTest && !file.includes(".test.") && !file.includes(".spec.") && !file.includes("_test.")) {
          errors.push(new ValidatorError({
            file, line: 0, rule: "no-test-for-file",
            message: `Arquivo sem teste correspondente`,
            ai_hint: `Nenhum teste encontrado para ${file}. Escreva testes antes de commitar.`,
            severity: "warning"
          }));
        }
      }
    }
  }

  const errorCount = errors.filter(e => e.severity === "error").length;

  const v2Errors = checkV2Rules(files, config);
  errors.push(...v2Errors);

  const finalErrorCount = errors.filter(e => e.severity === "error").length;
  return new ValidatorResult({
    passed: finalErrorCount === 0,
    errors,
    warnings: errors.filter(e => e.severity === "warning"),
    duration_ms: Date.now() - startTime
  });
}

function checkV2Rules(files, config) {
  const errors = [];
  const zeroErrorDir = config.zeroErrorDir || join(process.cwd(), ".zero-error");

  const systemRulesPath = join(zeroErrorDir, "system-rules.md");
  if (existsSync(systemRulesPath)) {
    const content = readFileSync(systemRulesPath, "utf-8");
    if (!content.startsWith("Este reposit")) {
      errors.push(new ValidatorError({
        file: "system-rules.md",
        line: 1,
        rule: "preemption-command-missing",
        message: "Preemption Command not found as first line of system-rules.md",
        ai_hint: "Run: node init.js --force to regenerate system-rules.md with Preemption Command",
        severity: "error",
      }));
    }
  }

  for (const file of files) {
    const ext = extname(file).toLowerCase();
    if (![".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java", ".rs"].includes(ext)) continue;

    let content;
    try {
      content = readFileSync(file, "utf-8");
    } catch {
      continue;
    }

    if (!file.includes(".test.") && !file.includes(".spec.") && !file.includes("_test.")) {
      const hasCodeBlocks = /function\s+\w+|=>\s*{|class\s+\w+/.test(content);
      if (hasCodeBlocks) {
        const hasCheckpoints = /\[CHECK:\s*[^\]]+\]/.test(content);
        const hasAnchor = /@(ai-context|ai-restriction):/.test(content);
        if (hasCodeBlocks && !hasCheckpoints && !hasAnchor) {
          errors.push(new ValidatorError({
            file: file,
            line: 0,
            rule: "checkpoint-missing-v2",
            message: "Code changes without // [CHECK: rule] markers",
            ai_hint: "Add // [CHECK: perf-budget], // [CHECK: error-handling], etc. at each logical block",
            severity: "warning",
          }));
        }
      }
    }
  }

  return errors;
}

function getLineNumber(content, index) {
  return content.substring(0, index).split("\n").length;
}

function findCatchBlock(content, tryIndex) {
  // Simplified: find the catch after try
  const afterTry = content.substring(tryIndex);
  const catchMatch = afterTry.match(/catch\s*\([^)]*\)\s*\{([^}]*)\}/);
  if (!catchMatch) {
    // Try without catch (Python style)
    const pythonCatch = afterTry.match(/except\s*:?\s*\n([\s\S]*?)(?=\n\s*\S|\nexcept|\nfinally|$)/);
    if (pythonCatch) {
      const body = pythonCatch[1].trim();
      return { isEmpty: body === "" || body.startsWith("pass") || body.startsWith("#") };
    }
    return null;
  }
  const body = catchMatch[1].trim();
  return {
    isEmpty: body === "" ||
             body.match(/^console\.(log|warn|error)\([^)]*\)\s*;?\s*$/) ||
             body.match(/^\/\/.*$/)
  };
}

function countOccurrences(content, name) {
  const regex = new RegExp(`\\b${name}\\b`, "g");
  return (content.match(regex) || []).length;
}
