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
| `property-tests` | pre-push | Property-based invariants hold |
| `impact-analysis` | pre-push | Change blast radius within threshold |
| `schema-sync-check` | pre-push | ORM models match SQL migrations |
| `api-compat-check` | pre-push | API backward compatibility |
| `perf-budget-check` | pre-push | N+1 queries, unpaginated reads, SELECT *, await in loop |
| `mutation-test` | CI | Tests detect mutations (test quality) |

## Supported IDEs

Cursor, Windsurf, Cline, VS Code (Copilot), JetBrains, Neovim, Aider — auto-detected.

## Supported Languages

TypeScript/JS, Python, Rust, Go, Java, C# — validators configured per language.

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
├── validators/          # 14 deterministic validators
├── lib/                 # Scanners, mappers, budget, cache
├── hooks/               # pre-commit, pre-push
└── workflows/           # GitHub Actions CI
```

## License

MIT
