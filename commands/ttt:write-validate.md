---
name: ttt:write-validate
description: Create a project validation command by detecting project type and existing lint/test configurations
arguments:
  - name: command-name
    description: Name for the command (default: validate)
    required: false
---

# TTT Write-Validate Command

Create a project-specific validation command by analyzing the codebase.

## Process

### 1. Detect Project Type

Check for project indicators:

| File | Project Type |
|------|--------------|
| `package.json` | Node.js / Bun |
| `Cargo.toml` | Rust |
| `go.mod` | Go |
| `pyproject.toml`, `requirements.txt` | Python |

### 2. Find Existing Configurations

Look for static analysis configs:

**Linting**: `biome.json`, `.eslintrc.*`, `ruff.toml`
**Type Check**: `tsconfig.json`, `mypy.ini`
**Testing**: `jest.config.*`, `vitest.config.*`, `pytest.ini`

### 3. Check package.json Scripts

If Node.js project:
```bash
cat package.json | jq '.scripts | keys[]' 2>/dev/null
```

Look for: `lint`, `type-check`, `test`, `check`, `validate`

### 4. Create Command File

Create `.claude/commands/{{ $1 | default: "validate" }}.md`:

```markdown
---
name: {{ $1 | default: "validate" }}
description: Run project validation (lint, type-check, test)
---

# Project Validation

Run validation checks for this project.

## Process

### 1. Lint
\`\`\`bash
{{ lint-command }}
\`\`\`

### 2. Type Check
\`\`\`bash
{{ type-check-command }}
\`\`\`

### 3. Test (optional)
\`\`\`bash
{{ test-command }}
\`\`\`

## Quick Validate All

\`\`\`bash
{{ combined-command }}
\`\`\`

## On Failure

1. Show error output
2. Identify failing file(s) and line(s)
3. Suggest fixes
4. Re-run validation after fixes
```

### 5. Output

After creating:
1. Show created file path
2. Display detected validation commands
3. Suggest running `/{{ $1 | default: "validate" }}` to test

## Examples

### Node.js with Biome
```
Detected: Node.js project with Biome + TypeScript
Created: .claude/commands/validate.md

Commands:
  Lint: bun run lint
  Type: bun run type-check
  Test: bun run test

Try: /validate
```

### Python with Ruff
```
Detected: Python project with Ruff + mypy
Created: .claude/commands/validate.md

Commands:
  Lint: ruff check .
  Type: mypy .
  Test: pytest

Try: /validate
```
