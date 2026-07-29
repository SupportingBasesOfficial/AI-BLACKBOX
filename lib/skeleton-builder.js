// lib/skeleton-builder.js — Generates skeleton files (signatures without body)
// Allows AI to understand project structure without reading full implementations.
// Zero IA calls. Pure RegEx extraction.

import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "fs";
import { join, extname, basename, dirname, relative } from "path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", "build", "dist",
  ".next", ".nuxt", "__pycache__", "target", "bin",
  ".zero-error", ".gradle", ".cache",
]);

export function buildSkeletons(rootDir, outputDir) {
  const skeletons = [];
  const files = collectCodeFiles(rootDir, rootDir, 0, 12);

  for (const file of files) {
    const content = safeRead(file.absolutePath);
    if (!content) continue;

    const ext = extname(file.relativePath).toLowerCase();
    const skeleton = extractSkeleton(content, ext, file.relativePath);
    if (skeleton && skeleton.trim().length > 0) {
      skeletons.push({
        path: file.relativePath,
        skeleton: skeleton,
        language: extToLanguage(ext),
      });
    }
  }

  if (outputDir && existsSync(outputDir)) {
    const skeletonDir = join(outputDir, "skeletons");
    if (!existsSync(skeletonDir)) mkdirSync(skeletonDir, { recursive: true });

    for (const sk of skeletons) {
      const outPath = join(skeletonDir, sk.path);
      const outDir = dirname(outPath);
      if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
      writeFileSync(outPath, sk.skeleton);
    }
  }

  return {
    skeletons: skeletons,
    totalFiles: files.length,
    totalSkeletons: skeletons.length,
  };
}

function collectCodeFiles(rootDir, currentDir, depth, maxDepth) {
  if (depth > maxDepth) return [];

  let results = [];
  let entries = [];

  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".")) continue;

    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      results = results.concat(collectCodeFiles(rootDir, fullPath, depth + 1, maxDepth));
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if ([".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java", ".rs"].includes(ext)) {
        results.push({ absolutePath: fullPath, relativePath: relPath });
      }
    }
  }

  return results;
}

function extractSkeleton(content, ext, filePath) {
  const lines = content.split("\n");
  const skeletonLines = [];
  const lang = extToLanguage(ext);

  let inClass = false;
  let classDepth = 0;
  let braceDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed.startsWith("//") || trimmed.startsWith("#") || trimmed.startsWith("/*") || trimmed.startsWith("*")) {
      if (trimmed.includes("@ai-context") || trimmed.includes("@ai-restriction") || trimmed.includes("[CHECK:")) {
        skeletonLines.push(line);
      }
      continue;
    }

    if (lang === "typescript" || lang === "javascript") {
      if (isImportOrExport(trimmed)) {
        skeletonLines.push(line);
        continue;
      }

      if (isClassDeclaration(trimmed)) {
        skeletonLines.push(line);
        inClass = true;
        continue;
      }

      if (isFunctionDeclaration(trimmed)) {
        skeletonLines.push(line + " { ... }");
        continue;
      }

      if (isInterfaceOrType(trimmed)) {
        const block = extractBlock(lines, i);
        skeletonLines.push(...block);
        i += block.length - 1;
        continue;
      }

      if (isConstArrow(trimmed)) {
        skeletonLines.push(line + " { ... }");
        continue;
      }
    }

    if (lang === "python") {
      if (trimmed.startsWith("import ") || trimmed.startsWith("from ")) {
        skeletonLines.push(line);
        continue;
      }
      if (trimmed.startsWith("class ")) {
        skeletonLines.push(line);
        continue;
      }
      if (trimmed.startsWith("def ") || trimmed.startsWith("async def ")) {
        skeletonLines.push(line);
        continue;
      }
    }

    if (lang === "go") {
      if (trimmed.startsWith("import ") || trimmed.startsWith("package ")) {
        skeletonLines.push(line);
        continue;
      }
      if (trimmed.startsWith("type ") && trimmed.includes("struct")) {
        const block = extractBlock(lines, i);
        skeletonLines.push(...block);
        i += block.length - 1;
        continue;
      }
      if (trimmed.startsWith("func ")) {
        skeletonLines.push(line + " { ... }");
        continue;
      }
    }

    if (lang === "rust") {
      if (trimmed.startsWith("use ") || trimmed.startsWith("mod ")) {
        skeletonLines.push(line);
        continue;
      }
      if (trimmed.startsWith("pub struct ") || trimmed.startsWith("struct ")) {
        const block = extractBlock(lines, i);
        skeletonLines.push(...block);
        i += block.length - 1;
        continue;
      }
      if (trimmed.startsWith("pub fn ") || trimmed.startsWith("fn ") || trimmed.startsWith("pub async fn ") || trimmed.startsWith("async fn ")) {
        skeletonLines.push(line + " { ... }");
        continue;
      }
    }

    if (lang === "java") {
      if (trimmed.startsWith("import ") || trimmed.startsWith("package ")) {
        skeletonLines.push(line);
        continue;
      }
      if (trimmed.startsWith("public class ") || trimmed.startsWith("class ")) {
        skeletonLines.push(line);
        continue;
      }
      if (trimmed.match(/(public|private|protected)\s+(static\s+)?(async\s+)?[\w<>\[\]]+\s+\w+\s*\(/)) {
        skeletonLines.push(line + " { ... }");
        continue;
      }
    }
  }

  return skeletonLines.join("\n");
}

function isImportOrExport(line) {
  return /^(import|export)\s/.test(line);
}

function isClassDeclaration(line) {
  return /^(export\s+)?(default\s+)?(abstract\s+)?class\s+/.test(line);
}

function isFunctionDeclaration(line) {
  return /^(export\s+)?(async\s+)?function\s+/.test(line);
}

function isInterfaceOrType(line) {
  return /^(export\s+)?(interface|type)\s+/.test(line);
}

function isConstArrow(line) {
  return /^(export\s+)?(const|let|var)\s+\w+\s*=\s*(async\s*)?\(/.test(line);
}

function extractBlock(lines, startIdx) {
  const block = [lines[startIdx]];
  let depth = 0;
  let foundOpen = false;

  for (let i = startIdx + 1; i < lines.length && i < startIdx + 50; i++) {
    const line = lines[i];
    block.push(line);

    for (const ch of line) {
      if (ch === "{") { depth++; foundOpen = true; }
      if (ch === "}") depth--;
    }

    if (foundOpen && depth === 0) break;
  }

  return block;
}

function extToLanguage(ext) {
  const map = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".py": "python", ".rs": "rust", ".go": "go",
    ".java": "java",
  };
  return map[ext] || "unknown";
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}
