// lib/anchor-injector.js — Injects // @ai-context and // @ai-restriction anchors
// into critical files. Idempotent: skips files that already have anchors.
// Zero IA calls. Pure file system + RegEx.

import { readFileSync, writeFileSync, existsSync } from "fs";
import { join, extname, basename, dirname } from "path";

const ANCHOR_PATTERNS = {
  "// @ai-context:": { commentStyle: "//", languages: ["js", "ts", "tsx", "jsx", "go", "rs", "java", "kt", "swift", "csharp"] },
  "# @ai-context:": { commentStyle: "#", languages: ["py", "rb", "yaml", "yml", "toml"] },
  "<!-- @ai-context:": { commentStyle: "<!-- -->", languages: ["html", "vue", "svelte", "md"] },
};

const COMMENT_STYLES = {
  ".js": "//", ".ts": "//", ".tsx": "//", ".jsx": "//",
  ".go": "//", ".rs": "//", ".java": "//", ".kt": "//",
  ".swift": "//", ".cs": "//",
  ".py": "#", ".rb": "#",
  ".html": "<!-- -->", ".vue": "<!-- -->", ".svelte": "<!-- -->",
  ".css": "/* */",
  ".sql": "--",
};

export function injectAnchors(rootDir, archMap) {
  let injected = 0;
  let skipped = 0;
  let errors = 0;

  const criticalFiles = collectCriticalFiles(archMap);

  for (const file of criticalFiles) {
    const fullPath = join(rootDir, file.path);
    if (!existsSync(fullPath)) {
      errors++;
      continue;
    }

    const ext = extname(fullPath).toLowerCase();
    const commentStyle = COMMENT_STYLES[ext];
    if (!commentStyle) {
      skipped++;
      continue;
    }

    try {
      const content = readFileSync(fullPath, "utf-8");

      if (hasAnchor(content)) {
        skipped++;
        continue;
      }

      const anchorBlock = buildAnchorBlock(file, commentStyle);
      const newContent = anchorBlock + "\n" + content;
      writeFileSync(fullPath, newContent);
      injected++;
    } catch {
      errors++;
    }
  }

  return { injected, skipped, errors, total: criticalFiles.length };
}

function collectCriticalFiles(archMap) {
  const files = [];

  for (const entry of archMap.layers.ingress) {
    files.push({ path: entry.path, layer: "ingress", type: entry.type, name: entry.name });
  }
  for (const entry of archMap.layers.logicCore) {
    files.push({ path: entry.path, layer: "logic-core", type: entry.type, name: entry.name });
  }
  for (const entry of archMap.layers.stateStore) {
    files.push({ path: entry.path, layer: "state-store", type: entry.type, name: entry.name });
  }

  return deduplicateByPath(files);
}

function deduplicateByPath(files) {
  const seen = new Set();
  return files.filter(f => {
    if (seen.has(f.path)) return false;
    seen.add(f.path);
    return true;
  });
}

function hasAnchor(content) {
  return /@(ai-context|ai-restriction):/.test(content);
}

function buildAnchorBlock(file, commentStyle) {
  const lines = [];
  const layerLabel = layerToLabel(file.layer);

  if (commentStyle === "//") {
    lines.push(`// @ai-context: .zero-error/architecture-map.md#${layerLabel}`);
    lines.push(`// @ai-restriction: .zero-error/code-standards.md#error-handling`);
  } else if (commentStyle === "#") {
    lines.push(`# @ai-context: .zero-error/architecture-map.md#${layerLabel}`);
    lines.push(`# @ai-restriction: .zero-error/code-standards.md#error-handling`);
  } else if (commentStyle === "<!-- -->") {
    lines.push(`<!-- @ai-context: .zero-error/architecture-map.md#${layerLabel} -->`);
    lines.push(`<!-- @ai-restriction: .zero-error/code-standards.md#error-handling -->`);
  } else if (commentStyle === "/* */") {
    lines.push(`/* @ai-context: .zero-error/architecture-map.md#${layerLabel} */`);
    lines.push(`/* @ai-restriction: .zero-error/code-standards.md#error-handling */`);
  } else if (commentStyle === "--") {
    lines.push(`-- @ai-context: .zero-error/architecture-map.md#${layerLabel}`);
    lines.push(`-- @ai-restriction: .zero-error/code-standards.md#error-handling`);
  }

  return lines.join("\n");
}

function layerToLabel(layer) {
  const map = {
    "ingress": "ingress",
    "logic-core": "logic-core",
    "state-store": "state-store",
    "unclassified": "unclassified",
  };
  return map[layer] || "unclassified";
}
