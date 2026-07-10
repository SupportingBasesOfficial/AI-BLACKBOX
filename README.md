# Zero-Error Black Box

A black box that makes any AI-assisted IDE operate under the Zero-Error Doctrine — 100% as the minimum acceptance criterion.

## Quick Start

```bash
# Clone into your project
git clone https://github.com/zero-error/box .zero-error

# Initialize (auto-detects IDE, language, infers Constitution, installs hooks)
node .zero-error/init.js
```

Open your IDE. The AI now operates under the Doctrine. Zero configuration.

## How It Works

**Two layers:**

1. **Cognitive** — Generates `.cursorrules`, `.windsurfrules`, `.clinerules`, etc. Your IDE injects these into the AI's system prompt automatically. The AI cannot ignore them.

2. **Enforcement** — Git hooks (pre-commit, pre-push) and CI/CD run 8 validators. Code that doesn't pass 100% is blocked. Hard gate, not suggestion.

## What the Doctrine Enforces

- **100% is the floor**, not the ceiling. Below 100%, work is not done.
- **No workarounds.** If the direct solution seems hard, understanding is incomplete.
- **Study before execute.** Flow: ENTENDER → ESTUDAR → PLANEJAR → EXECUTAR → VERIFICAR.
- **Root cause, not symptoms.** Every problem has a cause. Sanar the cause.
- **80/20.** 80% effort in understanding. 20% in execution.

## Validators

| Validator | What it checks |
|-----------|---------------|
| `type-check` | Compiles and types are correct |
| `lint` | Follows project conventions |
| `doctrine-check` | No workarounds, direct path, certainty, 100% criteria met |
| `test` | All tests pass (or generates them if missing) |
| `security-scan` | SAST + dependency scan + secrets scan |
| `property-tests` | Property-based invariants hold |
| `mutation-test` | Tests detect mutations (test quality) |
| `impact-analysis` | Change doesn't break dependencies beyond threshold |

## Supported IDEs

Cursor, Windsurf, Cline, VS Code (Copilot), JetBrains, Neovim, Aider — auto-detected.

## Supported Languages

TypeScript/JS, Python, Rust, Go, Java, C# — validators configured per language.

## License

MIT
