// validators/api-compat-check.js — Backward compatibility of API contracts
// Compares OpenAPI/GraphQL schemas before and after. Zero IA calls.

import { execSync } from "child_process";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, extname, basename } from "path";
import { ValidatorResult, ValidatorError } from "../lib/validator-contract.js";

export const name = "api-compat-check";

export async function run(files, config = {}) {
  const startTime = Date.now();
  const errors = [];
  const warnings = [];
  const cwd = config.cwd || process.cwd();
  const changedFiles = getChangedFiles(cwd);

  const hasApiChanges = changedFiles.some(f =>
    f.includes("openapi") || f.includes("swagger") ||
    f.endsWith(".graphql") || f.endsWith(".gql") ||
    f.endsWith(".proto")
  );

  if (!hasApiChanges) {
    return new ValidatorResult({
      passed: true,
      errors: [],
      warnings: [],
      duration_ms: Date.now() - startTime,
    });
  }

  for (const file of changedFiles) {
    if (file.includes("openapi") || file.includes("swagger")) {
      const oldSpec = getOldFileContent(cwd, file);
      const newSpec = safeRead(join(cwd, file));

      if (oldSpec && newSpec) {
        const oldPaths = extractOpenApiPaths(oldSpec);
        const newPaths = extractOpenApiPaths(newSpec);

        for (const path of oldPaths) {
          if (!newPaths.includes(path)) {
            errors.push(new ValidatorError({
              file: file,
              line: 0,
              rule: "api-path-removed",
              message: `API path "${path}" was removed — breaking backward compatibility`,
              ai_hint: `If intentional, bump API version (e.g., /api/v1/ -> /api/v2/). Otherwise, restore the path.`,
              severity: "error",
            }));
          }
        }

        const oldFields = extractOpenApiFields(oldSpec);
        const newFields = extractOpenApiFields(newSpec);
        for (const field of oldFields) {
          if (!newFields.includes(field)) {
            warnings.push(new ValidatorError({
              file: file,
              line: 0,
              rule: "api-field-removed",
              message: `API response field "${field}" was removed — may break consumers`,
              ai_hint: `If intentional, deprecate first. Otherwise, restore the field.`,
              severity: "warning",
            }));
          }
        }
      }
    }

    if (file.endsWith(".graphql") || file.endsWith(".gql")) {
      const oldContent = getOldFileContent(cwd, file);
      const newContent = safeRead(join(cwd, file));

      if (oldContent && newContent) {
        const oldTypes = extractGraphQLTypes(oldContent);
        const newTypes = extractGraphQLTypes(newContent);

        for (const type of oldTypes) {
          if (!newTypes.includes(type)) {
            errors.push(new ValidatorError({
              file: file,
              line: 0,
              rule: "graphql-type-removed",
              message: `GraphQL type "${type}" was removed — breaking schema`,
              ai_hint: `If intentional, coordinate with all consumers. Otherwise, restore the type.`,
              severity: "error",
            }));
          }
        }
      }
    }

    if (file.endsWith(".proto")) {
      const oldContent = getOldFileContent(cwd, file);
      const newContent = safeRead(join(cwd, file));

      if (oldContent && newContent) {
        const oldMessages = extractProtoMessages(oldContent);
        const newMessages = extractProtoMessages(newContent);

        for (const msg of oldMessages) {
          if (!newMessages.includes(msg)) {
            errors.push(new ValidatorError({
              file: file,
              line: 0,
              rule: "proto-message-removed",
              message: `Protobuf message "${msg}" was removed — breaking gRPC contract`,
              ai_hint: `If intentional, coordinate with all gRPC clients. Otherwise, restore the message.`,
              severity: "error",
            }));
          }
        }
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

function getOldFileContent(cwd, file) {
  try {
    return execSync(`git show HEAD:${file}`, {
      cwd, encoding: "utf-8", timeout: 5000,
    });
  } catch {
    return null;
  }
}

function extractOpenApiPaths(content) {
  try {
    const spec = JSON.parse(content);
    return Object.keys(spec.paths || {});
  } catch {
    const paths = [];
    const matches = content.matchAll(/^\s*(\/[\w\/\-{}]+):\s*$/gm);
    for (const m of matches) paths.push(m[1]);
    return paths;
  }
}

function extractOpenApiFields(content) {
  const fields = [];
  try {
    const spec = JSON.parse(content);
    if (spec.components?.schemas) {
      for (const [name, schema] of Object.entries(spec.components.schemas)) {
        if (schema.properties) {
          for (const prop of Object.keys(schema.properties)) {
            fields.push(`${name}.${prop}`);
          }
        }
      }
    }
  } catch {}
  return fields;
}

function extractGraphQLTypes(content) {
  const types = [];
  const matches = content.matchAll(/type\s+(\w+)\s*\{/g);
  for (const m of matches) types.push(m[1]);
  return types;
}

function extractProtoMessages(content) {
  const messages = [];
  const matches = content.matchAll(/message\s+(\w+)\s*\{/g);
  for (const m of matches) messages.push(m[1]);
  return messages;
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
