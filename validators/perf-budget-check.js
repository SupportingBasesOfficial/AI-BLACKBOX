// validators/perf-budget-check.js — Detects AI anti-patterns that destroy enterprise DBs
// 5 filters: N+1 async, unpaginated queries, SELECT *, nested loops O(n^2), await in loop
// Zero IA calls. Pure RegEx + pseudo-AST.

import { readFileSync } from "fs";
import { join, extname } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "perf-budget-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const cwd = config.cwd || process.cwd();
  const changedFiles = getChangedFiles(cwd);

  for (const file of changedFiles) {
    const ext = extname(file).toLowerCase();
    if (![".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java"].includes(ext)) continue;

    const content = safeRead(join(cwd, file));
    if (!content) continue;

    const lines = content.split("\n");

    checkFilter1AsyncMap(file, lines, errors);
    checkFilter2UnpaginatedQuery(file, lines, errors, ext);
    checkFilter3SelectStar(file, lines, errors);
    checkFilter4NestedLoops(file, lines, errors);
    checkFilter5AwaitInLoop(file, lines, errors);
  }

  return new ValidatorResult({
    passed: errors.length === 0,
    errors,
    warnings,
    duration_ms: Date.now() - startTime,
  });
}

function getChangedFiles(cwd) {
  try {
    const output = execSync("git diff --name-only --cached HEAD", {
      cwd, encoding: "utf-8", timeout: 5000,
    }).trim();
    return output ? output.split("\n").filter(f => f.length > 0) : [];
  } catch {
    return [];
  }
}

function checkFilter1AsyncMap(file, lines, errors) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const asyncMapMatch = line.match(/\.(map|forEach)\s*\(\s*async\s*\(/);
    if (!asyncMapMatch) continue;

    const contextStart = Math.max(0, i - 5);
    const contextEnd = Math.min(lines.length, i + 10);
    const context = lines.slice(contextStart, contextEnd).join("\n");

    const hasPromiseAll = /Promise\.all\s*\(/.test(context);
    const hasPLimit = /p-limit|pLimit|concurrency/i.test(context);

    if (!hasPromiseAll && !hasPLimit) {
      errors.push(new ValidatorError({
        file: file,
        line: i + 1,
        rule: "perf-n1-async-map",
        message: `.${asyncMapMatch[1]}(async () => without Promise.all — N+1 query risk`,
        ai_hint: "Replace with: await Promise.all(items.map(async (item) => ...)) or use p-limit for concurrency control",
        severity: "error",
      }));
    }
  }
}

function checkFilter2UnpaginatedQuery(file, lines, errors, ext) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    const ormPatterns = [
      /findMany\s*\(/,
      /findAll\s*\(/,
      /\.query\s*\(/,
      /\.all\s*\(\s*\)/,
      /objects\.filter\s*\(/,
      /objects\.all\s*\(\s*\)/,
    ];

    for (const pattern of ormPatterns) {
      if (!pattern.test(line)) continue;

      const contextStart = Math.max(0, i);
      const contextEnd = Math.min(lines.length, i + 3);
      const context = lines.slice(contextStart, contextEnd).join("\n");

      const hasPagination = /\b(take|limit|offset|top|page|pageSize|first|skip)\b/i.test(context);

      if (!hasPagination) {
        errors.push(new ValidatorError({
          file: file,
          line: i + 1,
          rule: "perf-unpaginated-query",
          message: `DB query without pagination — may load entire table`,
          ai_hint: "Add .take(N), .limit(N), or pagination to constrain results",
          severity: "error",
        }));
        break;
      }
    }

    if (ext === ".py" || ext === ".go" || ext === ".java") {
      const sqlPattern = /SELECT\s+.*\s+FROM\s+\w+/i;
      if (sqlPattern.test(line)) {
        const context = lines.slice(i, Math.min(lines.length, i + 5)).join("\n");
        if (!/\b(LIMIT|TOP|OFFSET|FETCH)\b/i.test(context)) {
          errors.push(new ValidatorError({
            file: file,
            line: i + 1,
            rule: "perf-unpaginated-sql",
            message: `SQL SELECT without LIMIT — may load entire table`,
            ai_hint: "Add LIMIT N or pagination to the query",
            severity: "error",
          }));
        }
      }
    }
  }
}

function checkFilter3SelectStar(file, lines, errors) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const selectStarMatch = line.match(/SELECT\s+\*\s+FROM/i);
    if (selectStarMatch) {
      errors.push(new ValidatorError({
        file: file,
        line: i + 1,
        rule: "perf-select-star",
        message: `SELECT * FROM — fetches all columns, inefficient for large tables`,
        ai_hint: "Specify only needed columns: SELECT col1, col2 FROM table",
        severity: "error",
      }));
    }
  }
}

function checkFilter4NestedLoops(file, lines, errors) {
  let loopDepth = 0;
  let loopStartLine = 0;
  let loopType = "";

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const loopOpeners = [
      { regex: /\.forEach\s*\(/, type: "forEach" },
      { regex: /\.map\s*\(/, type: "map" },
      { regex: /\bfor\s*\(/, type: "for" },
      { regex: /\bfor\s+\w+\s+of\s+/, type: "for-of" },
      { regex: /\bfor\s+\w+\s+in\s+/, type: "for-in" },
      { regex: /\bwhile\s*\(/, type: "while" },
    ];

    let openedThisLine = false;
    for (const { regex, type } of loopOpeners) {
      if (regex.test(trimmed)) {
        if (loopDepth === 0) {
          loopDepth = 1;
          loopStartLine = i + 1;
          loopType = type;
          openedThisLine = true;
        } else if (loopDepth >= 1) {
          errors.push(new ValidatorError({
            file: file,
            line: i + 1,
            rule: "perf-nested-loop",
            message: `Nested loop: ${type} inside ${loopType} (O(n^2) risk)`,
            ai_hint: "Consider using a Map/Set for O(1) lookups instead of nested iteration",
            severity: "error",
          }));
          openedThisLine = true;
        }
        break;
      }
    }

    if (openedThisLine) continue;

    if (loopDepth > 0 && (trimmed === "}" || trimmed === "});" || trimmed.startsWith("}"))) {
      loopDepth = Math.max(0, loopDepth - 1);
    }
  }
}

function checkFilter5AwaitInLoop(file, lines, errors) {
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    const loopMatch = trimmed.match(/\b(for|while)\s*[\(\{]/);
    if (!loopMatch) continue;

    const contextEnd = Math.min(lines.length, i + 20);
    let braceDepth = 0;
    let foundOpen = false;
    let hasAwait = false;
    let hasPromiseAll = false;

    for (let j = i; j < contextEnd; j++) {
      const ctxLine = lines[j];

      if (/\bawait\b/.test(ctxLine) && !/Promise\.all/.test(ctxLine)) {
        hasAwait = true;
      }
      if (/Promise\.all/.test(ctxLine)) {
        hasPromiseAll = true;
      }

      for (const ch of ctxLine) {
        if (ch === "{") { braceDepth++; foundOpen = true; }
        if (ch === "}") braceDepth--;
      }

      if (foundOpen && braceDepth === 0) break;
    }

    if (hasAwait && !hasPromiseAll) {
      errors.push(new ValidatorError({
        file: file,
        line: i + 1,
        rule: "perf-await-in-loop",
        message: `await inside ${loopMatch[1]} loop — N+1 query pattern`,
        ai_hint: "Collect promises and use: await Promise.all(items.map(async (item) => ...))",
        severity: "error",
      }));
    }
  }
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
