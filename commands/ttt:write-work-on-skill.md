---
name: ttt:write-work-on-skill
description: Create a project-specific work-on skill with best practices, validation, and workflow conventions
arguments:
  - name: skill-name
    description: Name for the skill (default: work-on)
    required: false
---

# TTT Write Work-On Skill Command

Create a project-specific work-on skill by analyzing the codebase.

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

Look for configurations to include in best practices:

**Linting**: `biome.json`, `.eslintrc.*`, `ruff.toml`
**Type Check**: `tsconfig.json`, `mypy.ini`
**Testing**: `jest.config.*`, `vitest.config.*`, `pytest.ini`
**Formatting**: `.prettierrc`, `.editorconfig`

### 3. Check package.json Scripts

If Node.js project:
```bash
cat package.json | jq '.scripts | keys[]' 2>/dev/null
```

Look for: `lint`, `type-check`, `test`, `check`, `validate`, `format`

### 4. Create Skill File

Create `.claude/skills/{{ $1 | default: "work-on" }}/SKILL.md`:

```markdown
---
name: {{ $1 | default: "work-on" }}
description: Project-specific best practices for starting and completing tasks
---

# Work-On Skill

Best practices for working on tasks in this project.

## Before Starting

### 1. Validation Checks
\`\`\`bash
{{ lint-command }}
{{ type-check-command }}
\`\`\`

### 2. Branch Naming
- Feature: `feature/<issue-id>-<short-description>`
- Bugfix: `fix/<issue-id>-<short-description>`
- Refactor: `refactor/<issue-id>-<short-description>`

### 3. Environment Setup
- Ensure dependencies are installed
- Check for required environment variables

## Code Style

### Formatting
{{ formatting-rules }}

### Naming Conventions
{{ naming-conventions }}

### File Structure
{{ file-structure-notes }}

## Before Completing

### 1. Run All Checks
\`\`\`bash
{{ combined-validation-command }}
\`\`\`

### 2. Commit Message Format
\`\`\`
<type>(<scope>): <description>

<body>
\`\`\`

Types: feat, fix, refactor, docs, test, chore

### 3. Self-Review Checklist
- [ ] Code compiles without errors
- [ ] All tests pass
- [ ] No linting errors
- [ ] Changes are focused on the task
- [ ] No debug code or console.logs left
```

### 5. Output

After creating:
1. Show created file path
2. Display detected configurations
3. Suggest customizing the skill

## Examples

### Node.js with Biome + TypeScript
```
Detected: Node.js project with Biome + TypeScript

Created: .claude/skills/work-on/SKILL.md

Configurations found:
  Lint: bun run lint
  Type: bun run type-check
  Format: bun run format
  Test: bun run test

The skill has been created with these defaults.
Please review and customize for your team's conventions.
```

### Python with Ruff + mypy
```
Detected: Python project with Ruff + mypy

Created: .claude/skills/work-on/SKILL.md

Configurations found:
  Lint: ruff check .
  Type: mypy .
  Format: ruff format .
  Test: pytest

The skill has been created with these defaults.
Please review and customize for your team's conventions.
```

## Customization Tips

After creating the skill, consider adding:

1. **Team-specific conventions**: PR review process, documentation requirements
2. **Project-specific checks**: Security scanning, dependency audits
3. **Environment setup**: Database migrations, API key checks
4. **Testing requirements**: Coverage thresholds, required test types
