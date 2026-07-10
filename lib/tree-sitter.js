// lib/tree-sitter.js — AST parsing using tree-sitter (with graceful fallback)

let Parser = null;
let languages = {};

try {
  Parser = await import("tree-sitter");
} catch {
  // tree-sitter not installed — will use regex fallback
}

export async function parseAST(filePath) {
  const content = readFileSync(filePath, "utf-8");
  const ext = extname(filePath);

  if (Parser) {
    try {
      const parser = new Parser.default();
      const lang = await getLanguage(ext);
      if (lang) {
        parser.setLanguage(lang);
        const tree = parser.parse(content);
        return {
          rootNode: tree.rootNode,
          content,
          language: extToLanguage(ext),
          usesTreeSitter: true,
        };
      }
    } catch {
      // Fall through to fallback
    }
  }

  // Fallback: regex-based pseudo-AST
  return parseWithRegex(content, ext);
}

async function getLanguage(ext) {
  if (languages[ext]) return languages[ext];

  try {
    if (ext === ".ts" || ext === ".tsx") {
      const mod = await import("tree-sitter-typescript");
      languages[ext] = ext === ".tsx" ? mod.typescript : mod.typescript;
    } else if (ext === ".js" || ext === ".jsx") {
      const mod = await import("tree-sitter-javascript");
      languages[ext] = mod.default;
    } else if (ext === ".py") {
      const mod = await import("tree-sitter-python");
      languages[ext] = mod.default;
    }
  } catch {}

  return languages[ext] || null;
}

function parseWithRegex(content, ext) {
  const nodes = [];
  const lines = content.split("\n");

  // Detect function declarations
  const functionPatterns = [
    /function\s+(\w+)\s*\(/g,           // JS/TS: function name(
    /(\w+)\s*=\s*\([^)]*\)\s*=>/g,       // JS/TS: name = () =>
    /(?:async\s+)?function\s+(\w+)\s*\(/g, // Python: def name(
    /def\s+(\w+)\s*\(/g,                 // Python: def name(
    /fn\s+(\w+)\s*\(/g,                  // Rust: fn name(
    /func\s+(\w+)\s*\(/g,                // Go: func name(
  ];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const pattern of functionPatterns) {
      const match = pattern.exec(line);
      if (match) {
        nodes.push({
          type: "function_declaration",
          name: match[1],
          startLine: i + 1,
          endLine: i + 1,
          body: line,
        });
      }
    }
  }

  // Detect try/catch
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].match(/\btry\b\s*[{(:]/)) {
      nodes.push({
        type: "try_statement",
        startLine: i + 1,
        endLine: i + 1,
      });
    }
  }

  // Detect class declarations
  for (let i = 0; i < lines.length; i++) {
    const classMatch = lines[i].match(/\bclass\s+(\w+)/);
    if (classMatch) {
      nodes.push({
        type: "class_declaration",
        name: classMatch[1],
        startLine: i + 1,
        endLine: i + 1,
      });
    }
  }

  return {
    rootNode: { children: nodes },
    content,
    language: extToLanguage(ext),
    usesTreeSitter: false,
    findAll: (predicate) => nodes.filter(predicate),
    findAllByType: (types) => nodes.filter(n => types.includes(n.type)),
  };
}

function extToLanguage(ext) {
  const map = {
    ".ts": "typescript", ".tsx": "typescript",
    ".js": "javascript", ".jsx": "javascript",
    ".py": "python", ".rs": "rust", ".go": "go",
    ".java": "java", ".cs": "csharp",
  };
  return map[ext] || "unknown";
}

// Helper functions used by validators
export function getLineNumber(content, index) {
  return content.substring(0, index).split("\n").length;
}

export function isEmptyOrSilent(catchNode) {
  if (!catchNode) return true;
  const body = catchNode.body || catchNode.text || "";
  const trimmed = body.trim();
  if (trimmed === "" || trimmed === "{}") return true;
  // Only contains console.log or comment
  if (trimmed.match(/^[\s{}]*console\.(log|warn|error)\([^)]*\)[\s{}]*$/)) return true;
  if (trimmed.match(/^[\s{}]*\/\/.*$/)) return true;
  return false;
}

import { readFileSync } from "fs";
import { extname } from "path";
