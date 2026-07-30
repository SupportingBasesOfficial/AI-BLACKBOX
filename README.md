# AI Black Box v2 — Context Engine Universal

A black box that makes any AI-assisted IDE operate under the Zero-Error Doctrine — 100% as the minimum acceptance criterion.

## Quick Start

```bash
# Clone into your project
git clone https://github.com/SupportingBasesOfficial/AI-BLACKBOX.git .zero-error

# Initialize (auto-detects IDE, language, infers Constitution, installs hooks)
node .zero-error/init.js

# Update on changes (re-scans, preserves gates.json and anchors)
node .zero-error/init.js --update

# Force regenerate everything
node .zero-error/init.js --force
```

Open your IDE. The AI now operates under the Doctrine. Zero configuration.

## How It Works

**Three layers:**

1. **Cognitive** — Generates `.cursorrules`, `.windsurfrules`, `.clinerules`, etc. Your IDE injects these into the AI's system prompt automatically. The AI cannot ignore them. Context budget pruned to < 8KB for optimal attention.

2. **Enforcement (Bimodal)** — Git hooks (pre-commit, pre-push) and CI/CD run 14 validators. Code that doesn't pass 100% is blocked. Hard gate, not suggestion. Hooks can be bypassed with `--no-verify`; CI cannot.

3. **Integrity** — SHA-256 hash protection on immutable files (`system-rules.md`, `tech-stack.json`, `source-of-truth.json`). Tampering is detected and blocked.

## What the Doctrine Enforces

- **100% is the floor**, not the ceiling. Below 100%, work is not done.
- **No workarounds.** If the direct solution seems hard, understanding is incomplete.
- **Study before execute.** Flow: ENTENDER → ESTUDAR → PLANEJAR → EXECUTAR → VERIFICAR.
- **Root cause, not symptoms.** Every problem has a cause. Sanar the cause.
- **80/20.** 80% effort in understanding. 20% in execution.
- **Preemption Command.** System rules override any AI suggestion.
- **Prompt Salt.** Micro-anchor re-injects critical rules into AI attention cycle.
- **Payload Rígido.** AI responses must contain 4 sections: Diagnóstico, Alterações, Enforcement, Rollback.

## Validators

| Validator | Gate | What it checks |
|-----------|------|----------------|
| `type-check` | pre-commit | Compiles and types are correct |
| `lint` | pre-commit | Follows project conventions |
| `doctrine-check` | pre-commit | No workarounds, direct path, certainty, Preemption Command, [CHECK:] markers |
| `test` | pre-commit | All tests pass + critical path coverage |
| `security-scan` | pre-commit | SAST + dependency scan + secrets scan |
| `contract-check` | pre-commit | Inter-module contracts respected |
| `anchor-check` | pre-commit | @ai-context anchors consistent |
| `tech-debt-check` | pre-commit | Phantom imports, orphan env vars, unused deps, missing @types |
| `property-tests` | pre-push | Property-based invariants hold |
| `impact-analysis` | pre-push | Change blast radius within threshold |
| `schema-sync-check` | pre-push | ORM models match SQL migrations |
| `api-compat-check` | pre-push | API backward compatibility |
| `perf-budget-check` | pre-push | N+1 queries, unpaginated reads, SELECT *, await in loop |
| `mutation-test` | CI | Tests detect mutations (test quality) |

## Tech Debt Scanner

The AI Black Box doesn't just scan what's right — it detects what's **invisible and wrong**:

- **Phantom Imports**: `import pg from "pg"` in source code but `pg` not in any `package.json` — critical severity
- **Orphan Env Vars**: `process.env.DATABASE_URL` referenced in code but not declared in `.env` files — warning
- **Unused Dependencies**: declared in `package.json` but never imported in any source file — info
- **Missing Type Definitions**: package imported without `@types/` and no bundled types — info
- **Uncommitted Critical Files**: env vars like `DATABASE_URL` not detected — the file referencing them may be uncommitted

Generates `tech-debt-report.json` + `tech-debt-report.md` on every scan. Critical findings block pre-commit. The `tech-debt-check` validator enforces this gate.

**Multi-language support** (15 languages): TypeScript/JS, Python, Go, Rust, Java, Kotlin, Scala, Groovy, C#, Ruby, PHP, Swift, Dart, C/C++, Elixir — imports, env vars, and dependency files are parsed per-language:
- **Python**: `import X`, `from X import Y`, `os.environ.get()`, `os.getenv()` | `requirements.txt`, `pyproject.toml`
- **Go**: `import "pkg"`, `os.Getenv()` | `go.mod`
- **Rust**: `use crate::X`, `std::env::var()` | `Cargo.toml`
- **Java/Kotlin/Scala/Groovy**: `import X;`, `System.getenv()` | `pom.xml`, `build.gradle`
- **C#**: `using X;`, `Environment.GetEnvironmentVariable()` | `.csproj`
- **Ruby**: `require "gem"`, `ENV["VAR"]` | `Gemfile`
- **PHP**: `use Namespace\Class`, `$_ENV["VAR"]`, `getenv()` | `composer.json`
- **Swift**: `import Module`, `ProcessInfo.environment` | `Package.swift`
- **Dart**: `import "package:..."`, `Platform.environment` | `pubspec.yaml`
- **C/C++**: `#include <header>`, `getenv()` | `CMakeLists.txt`
- **Elixir**: `defmodule`, `System.get_env()` | `mix.exs`

## Supported IDEs

Cursor, Windsurf, Cline, VS Code (Copilot), JetBrains, Neovim, Aider — auto-detected.

## Supported Languages

TypeScript/JS, Python, Rust, Go, Java, Kotlin, Scala, Groovy, C#, Ruby, PHP, Swift, Dart, C/C++, Elixir — 15 languages with per-language validators, route detection, schema extraction, component detection, env var scanning, and tech debt analysis.

## Project Structure

```
.zero-error/
├── init.js              # Bootstrap (21 steps, 3 modes)
├── gates.json           # Validator configuration (editable)
├── system-rules.md      # Preemption Command + rules
├── tech-stack.json      # Auto-detected stack + lexical glossary
├── source-of-truth.json # Immutable project truth
├── architecture-map.md  # Layer classification
├── shadow-context.md    # Feature flags + env vars
├── state-context.md     # Current state
├── blackbox-index.json  # Semantic index
├── code-standards.md    # Naming, anti-patterns, security
├── tech-debt-report.json # Phantom imports, orphan env vars, unused deps
├── tech-debt-report.md  # Human-readable tech debt report
├── validators/          # 15 deterministic validators
├── lib/                 # Scanners, mappers, budget, cache
├── hooks/               # pre-commit, pre-push
└── workflows/           # GitHub Actions CI
```

## License

MIT
