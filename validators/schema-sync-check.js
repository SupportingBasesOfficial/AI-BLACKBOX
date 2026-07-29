// validators/schema-sync-check.js — Compares ORM models with SQL migrations
// Zero IA calls. Pure RegEx + file parsing.

import { readFileSync, existsSync, readdirSync } from "fs";
import { join, extname, basename } from "path";
import { execSync } from "child_process";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "schema-sync-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const cwd = config.cwd || process.cwd();
  const changedFiles = getChangedFiles(cwd);

  const hasSchemaChanges = changedFiles.some(f =>
    f.includes("migration") || f.includes("schema") || f.includes("model") ||
    f.endsWith(".prisma") || f.endsWith(".sql")
  );

  if (!hasSchemaChanges) {
    return new ValidatorResult({
      passed: true,
      errors: [],
      warnings: [],
      duration_ms: Date.now() - startTime,
    });
  }

  const ormModels = extractOrmModels(cwd);
  const sqlTables = extractSqlTables(cwd);

  for (const model of ormModels) {
    const matchingTable = sqlTables.find(t => t.name.toLowerCase() === model.name.toLowerCase());
    if (!matchingTable) {
      warnings.push(new ValidatorError({
        file: model.file,
        line: 0,
        rule: "schema-sync-no-table",
        message: `ORM model "${model.name}" has no corresponding SQL migration table`,
        ai_hint: `Create a migration for table "${model.name}" or verify the model name matches the table.`,
        severity: "warning",
      }));
      continue;
    }

    const modelFields = new Set(model.fields.map(f => f.name.toLowerCase()));
    const tableColumns = new Set(matchingTable.columns.map(c => c.name.toLowerCase()));

    for (const field of model.fields) {
      if (!tableColumns.has(field.name.toLowerCase())) {
        errors.push(new ValidatorError({
          file: model.file,
          line: 0,
          rule: "schema-sync-field-missing-in-sql",
          message: `ORM model "${model.name}" has field "${field.name}" not in SQL table`,
          ai_hint: `Add column "${field.name}" to migration for table "${matchingTable.name}"`,
          severity: "error",
        }));
      }
    }

    for (const col of matchingTable.columns) {
      if (!modelFields.has(col.name.toLowerCase())) {
        warnings.push(new ValidatorError({
          file: matchingTable.file,
          line: 0,
          rule: "schema-sync-column-missing-in-orm",
          message: `SQL table "${matchingTable.name}" has column "${col.name}" not in ORM model`,
          ai_hint: `Add field "${col.name}" to ORM model "${model.name}" or remove from migration`,
          severity: "warning",
        }));
      }
    }
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

function extractOrmModels(cwd) {
  const models = [];
  const files = findFiles(cwd, [".prisma"], 10);

  for (const file of files) {
    const content = safeRead(file);
    if (!content) continue;

    const matches = content.matchAll(/model\s+(\w+)\s*\{([^}]*)\}/g);
    for (const m of matches) {
      const fields = [];
      const lines = m[2].split("\n");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("@@")) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2 && !parts[0].startsWith("@")) {
          fields.push({ name: parts[0], type: parts[1] });
        }
      }
      models.push({ name: m[1], fields, file: relativePath(cwd, file) });
    }
  }

  return models;
}

function extractSqlTables(cwd) {
  const tables = [];
  const files = findFiles(cwd, [".sql"], 10);

  for (const file of files) {
    if (!file.includes("migration") && !file.includes("migrations")) continue;
    const content = safeRead(file);
    if (!content) continue;

    const matches = content.matchAll(/CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?[`"]?(\w+)[`"]?\s*\(([^;]*)\)/gis);
    for (const m of matches) {
      const columns = [];
      const lines = m[2].split(",");
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || /^(CONSTRAINT|PRIMARY|FOREIGN|UNIQUE|INDEX|CHECK)/i.test(trimmed)) continue;
        const parts = trimmed.split(/\s+/);
        if (parts.length >= 2) {
          columns.push({ name: parts[0].replace(/[`"]/g, ""), type: parts[1] });
        }
      }
      tables.push({ name: m[1], columns, file: relativePath(cwd, file) });
    }
  }

  return tables;
}

function findFiles(rootDir, exts, maxDepth) {
  const results = [];
  const ignoreDirs = new Set(["node_modules", ".git", "vendor", "build", "dist", ".zero-error"]);

  function scan(dir, depth) {
    if (depth > maxDepth) return;
    let entries = [];
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }

    for (const entry of entries) {
      if (ignoreDirs.has(entry.name)) continue;
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        scan(fullPath, depth + 1);
      } else if (entry.isFile() && exts.includes(extname(entry.name).toLowerCase())) {
        results.push(fullPath);
      }
    }
  }

  scan(rootDir, 0);
  return results;
}

function relativePath(cwd, fullPath) {
  return fullPath.replace(cwd, "").replace(/^[\\/]/, "").replace(/\\/g, "/");
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
