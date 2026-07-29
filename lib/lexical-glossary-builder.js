// lib/lexical-glossary-builder.js — Scans project for non-standard terms and builds a glossary
// Combats "Tokenization Dialect Fragmentation" across different LLM models (Claude, GPT-4o, Gemini)
// Zero IA calls. Pure heuristics + RegEx.

import { readFileSync, readdirSync } from "fs";
import { join, extname, relative, sep } from "path";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "vendor", "build", "dist",
  ".next", ".nuxt", "__pycache__", "target", "bin",
  ".zero-error", ".gradle", ".cache", "obj",
]);

const CODE_EXTS = new Set([
  ".ts", ".js", ".tsx", ".jsx", ".py", ".go", ".java",
  ".rs", ".cs", ".rb", ".php", ".kt", ".swift", ".scala",
]);

const STANDARD_WORDS = new Set([
  "get", "set", "create", "update", "delete", "remove", "add",
  "list", "find", "search", "filter", "sort", "count", "save",
  "load", "fetch", "send", "receive", "parse", "format", "validate",
  "check", "verify", "confirm", "cancel", "close", "open", "start",
  "stop", "reset", "clear", "flush", "init", "run", "execute",
  "process", "handle", "manage", "build", "generate", "render",
  "mount", "unmount", "connect", "disconnect", "subscribe", "unsubscribe",
  "login", "logout", "register", "authenticate", "authorize",
  "user", "admin", "guest", "system", "config", "option", "param",
  "data", "value", "result", "error", "warning", "info", "debug",
  "test", "spec", "mock", "stub", "fake", "real", "actual",
  "service", "controller", "model", "view", "route", "router",
  "middleware", "handler", "listener", "observer", "factory",
  "builder", "adapter", "wrapper", "proxy", "client", "server",
  "request", "response", "header", "body", "query", "mutation",
  "input", "output", "source", "target", "from", "to", "with",
  "new", "old", "current", "next", "prev", "previous", "last",
  "first", "all", "none", "some", "any", "each", "every",
  "is", "has", "can", "should", "will", "was", "were", "been",
  "do", "does", "did", "done", "make", "made", "take", "took",
  "string", "number", "boolean", "array", "object", "function",
  "class", "interface", "type", "enum", "const", "let", "var",
  "public", "private", "protected", "static", "async", "await",
  "return", "throw", "catch", "try", "finally", "break", "continue",
  "if", "else", "switch", "case", "default", "for", "while", "loop",
  "true", "false", "null", "undefined", "void", "never", "unknown",
  "http", "https", "url", "uri", "api", "rest", "graphql", "grpc",
  "json", "xml", "yaml", "csv", "html", "css", "sql", "nosql",
  "auth", "token", "session", "cookie", "header", "payload",
  "encrypt", "decrypt", "hash", "salt", "cipher", "key", "cert",
  "file", "path", "dir", "directory", "folder", "name", "ext",
  "read", "write", "stream", "buffer", "chunk", "byte", "size",
  "time", "date", "now", "today", "yesterday", "tomorrow", "week",
  "month", "year", "hour", "minute", "second", "ms", "timestamp",
  "id", "uuid", "guid", "index", "key", "ref", "link", "href",
  "message", "text", "title", "description", "label", "placeholder",
  "button", "input", "form", "field", "select", "option", "checkbox",
  "table", "row", "column", "cell", "grid", "list", "item", "card",
  "modal", "dialog", "popup", "toast", "alert", "notification",
  "sidebar", "navbar", "header", "footer", "main", "section", "aside",
  "page", "layout", "template", "component", "element", "node",
  "parent", "child", "sibling", "root", "leaf", "branch", "tree",
  "state", "store", "action", "reducer", "selector", "dispatch",
  "event", "emit", "on", "off", "once", "trigger", "fire",
  "cache", "memo", "memory", "storage", "persist", "restore",
  "log", "trace", "monitor", "metric", "counter", "gauge", "timer",
  "health", "status", "ready", "alive", "dead", "pending", "active",
  "success", "fail", "failure", "retry", "timeout", "interval",
]);

const KNOWN_ACRONYMS = new Set([
  "API", "URL", "URI", "HTTP", "HTTPS", "SSL", "TLS", "DNS",
  "CDN", "CSS", "HTML", "XML", "JSON", "JWT", "OAuth", "OIDC",
  "CRUD", "REST", "RPC", "gRPC", "ORM", "SQL", "DDL", "DML",
  "ACID", "BASE", "CAP", "SOLID", "DRY", "KISS", "YAGNI",
  "CI", "CD", "CDN", "DDOS", "XSS", "CSRF", "CORS", "CSP",
  "TDD", "BDD", "DDD", "EDA", "SOA", "SaaS", "PaaS", "IaaS",
  "VM", "OS", "IO", "CPU", "RAM", "SSD", "HDD", "GPU",
  "AWS", "GCP", "Azure", "VPC", "EC2", "S3", "RDS", "Lambda",
  "SDK", "CLI", "GUI", "UI", "UX", "POC", "MVP", "PRD",
  "RFC", "SLA", "SLO", "MTTR", "MTBF", "RTO", "RPO",
]);

const LEGACY_PREFIXES = [
  "Cob", "Dev", "NF", "NFSe", "NFe", "CTe", "MDFe",
  "SPED", "CNAB", "Boleto", "Duplicata", "IPTU", "ISS",
  "ICMS", "IPI", "PIS", "COFINS", "CSLL", "IRPJ",
  "Sintegra", "Sefaz", "Receita", "Prefeitura",
  "Cad", "Proc", "Exec", "Calc", "Ger", "Rel",
  "Cons", "Alt", "Exc", "Inc", "Pesq", "Cad",
];

export function buildLexicalGlossary(rootDir) {
  const terms = new Map();

  scanForTerms(rootDir, rootDir, 0, 12, terms);

  const glossary = Array.from(terms.values())
    .filter(t => t.score >= 2)
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term))
    .map(t => ({
      term: t.term,
      translation: t.translation || generateTranslation(t.term),
      occurrences: t.occurrences,
      files: t.files.slice(0, 5),
      score: t.score,
    }));

  return {
    glossary: glossary,
    totalTerms: glossary.length,
  };
}

function scanForTerms(rootDir, currentDir, depth, maxDepth, terms) {
  if (depth > maxDepth) return;

  let entries = [];
  try {
    entries = readdirSync(currentDir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (IGNORE_DIRS.has(entry.name)) continue;
    if (entry.name.startsWith(".") && entry.name !== ".env") continue;

    const fullPath = join(currentDir, entry.name);
    const relPath = relative(rootDir, fullPath).replace(/\\/g, "/");

    if (entry.isDirectory()) {
      scanForTerms(rootDir, fullPath, depth + 1, maxDepth, terms);
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase();
      if (!CODE_EXTS.has(ext)) continue;

      const content = safeRead(fullPath);
      if (!content) continue;

      extractTermsFromContent(content, relPath, terms);
    }
  }
}

function extractTermsFromContent(content, filePath, terms) {
  const identifiers = extractIdentifiers(content);

  for (const id of identifiers) {
    const analysis = analyzeTerm(id);
    if (!analysis.isNonStandard) continue;

    const key = id;
    if (!terms.has(key)) {
      terms.set(key, {
        term: id,
        translation: null,
        occurrences: 0,
        files: [],
        score: analysis.score,
        reasons: analysis.reasons,
      });
    }

    const entry = terms.get(key);
    entry.occurrences++;
    if (!entry.files.includes(filePath)) {
      entry.files.push(filePath);
    }
    entry.score = Math.max(entry.score, analysis.score);
  }
}

function extractIdentifiers(content) {
  const identifiers = new Set();

  const funcMatches = content.matchAll(/(?:function|def|fn|func|public|private|protected)\s+(?:async\s+)?(\w+)/g);
  for (const m of funcMatches) identifiers.add(m[1]);

  const classMatches = content.matchAll(/class\s+(\w+)/g);
  for (const m of classMatches) identifiers.add(m[1]);

  const constMatches = content.matchAll(/(?:const|let|var)\s+(\w+)/g);
  for (const m of constMatches) identifiers.add(m[1]);

  const typeMatches = content.matchAll(/(?:type|interface|enum)\s+(\w+)/g);
  for (const m of typeMatches) identifiers.add(m[1]);

  return Array.from(identifiers);
}

function analyzeTerm(term) {
  let score = 0;
  const reasons = [];

  const camelParts = splitCamelCase(term);
  if (camelParts.length > 3) {
    score += 2;
    reasons.push("camelCase with > 3 segments");
  } else if (camelParts.length === 3) {
    score += 1;
    reasons.push("camelCase with 3 segments");
  }

  const upperAcronym = term.match(/^[A-Z]{2,}$/);
  if (upperAcronym && !KNOWN_ACRONYMS.has(term)) {
    score += 3;
    reasons.push("unknown acronym (all caps)");
  }

  const mixedAcronym = term.match(/[A-Z]{3,}/);
  if (mixedAcronym && !KNOWN_ACRONYMS.has(mixedAcronym[0])) {
    score += 2;
    reasons.push(`contains unknown acronym: ${mixedAcronym[0]}`);
  }

  for (const prefix of LEGACY_PREFIXES) {
    if (term.startsWith(prefix) || term.includes(prefix)) {
      score += 2;
      reasons.push(`contains legacy prefix: ${prefix}`);
      break;
    }
  }

  const nonStandardParts = camelParts.filter(
    part => !STANDARD_WORDS.has(part.toLowerCase()) && part.length > 2 && !KNOWN_ACRONYMS.has(part.toUpperCase())
  );
  if (nonStandardParts.length > 0) {
    score += nonStandardParts.length;
    reasons.push(`non-standard words: ${nonStandardParts.join(", ")}`);
  }

  const portuguesePattern = term.match(/[ãáéíóúâêôçõ]/i);
  if (portuguesePattern) {
    score += 1;
    reasons.push("contains Portuguese accented characters");
  }

  return {
    isNonStandard: score >= 2,
    score: score,
    reasons: reasons,
  };
}

function splitCamelCase(term) {
  const parts = term
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1 $2")
    .split(/\s+|_+/)
    .filter(p => p.length > 0);
  return parts;
}

function generateTranslation(term) {
  const parts = splitCamelCase(term);
  const translations = [];

  for (const part of parts) {
    const lower = part.toLowerCase();
    const upper = part.toUpperCase();

    if (STANDARD_WORDS.has(lower)) {
      translations.push(capitalize(lower));
    } else if (KNOWN_ACRONYMS.has(upper)) {
      translations.push(upper);
    } else if (LEGACY_PREFIXES.includes(part)) {
      translations.push(translateLegacyPrefix(part));
    } else {
      translations.push(capitalize(lower));
    }
  }

  return translations.join(" ");
}

function translateLegacyPrefix(prefix) {
  const map = {
    "Cob": "Billing",
    "Dev": "Development",
    "NF": "Invoice",
    "NFSe": "Service Invoice",
    "NFe": "Electronic Invoice",
    "CTe": "Transport Document",
    "MDFe": "Manifest Document",
    "SPED": "Public Digital Bookkeeping System",
    "CNAB": "Bank Payment File Format",
    "Boleto": "Bank Payment Slip",
    "Duplicata": "Duplicate Invoice",
    "IPTU": "Property Tax",
    "ISS": "Service Tax",
    "ICMS": "Circulation Tax",
    "IPI": "Industrialized Products Tax",
    "PIS": "Social Integration Tax",
    "COFINS": "Social Security Tax",
    "CSLL": "Social Contribution Tax",
    "IRPJ": "Corporate Income Tax",
    "Sintegra": "Tax Information System",
    "Sefaz": "State Tax Authority",
    "Receita": "Federal Tax Authority",
    "Prefeitura": "City Hall",
    "Cad": "Register",
    "Proc": "Process",
    "Exec": "Execute",
    "Calc": "Calculate",
    "Ger": "Manage",
    "Rel": "Report",
    "Cons": "Consult",
    "Alt": "Update",
    "Exc": "Delete",
    "Inc": "Insert",
    "Pesq": "Search",
  };
  return map[prefix] || capitalize(prefix.toLowerCase());
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function safeRead(filePath) {
  try {
    return readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export function generateGlossaryJson(glossaryResult) {
  const obj = {};
  for (const entry of glossaryResult.glossary) {
    obj[entry.term] = entry.translation;
  }
  return obj;
}
