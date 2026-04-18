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

Create `.claude/skills/{{ $1 | default: "work-on" }}/SKILL.md` using the Plan → Test → Code → Review structure:

```markdown
---
name: {{ $1 | default: "work-on" }}
description: Project workflow — Plan → Test → Code → Review. Invoke after ttt work-on picks a task.
---

# Work-On Skill ({{ project-name }})

Follow Plan → Test → Code → Review for every task.
Skipping phases is debt, not pragmatism.

## 1. Plan

- Unclear scope or 3+ files → use `superpowers:brainstorming` → `superpowers:writing-plans`.
- Small, clear change → state a 2–3 bullet plan inline before coding.

Branch naming:
- `feature/<issue-id>-<slug>`
- `fix/<issue-id>-<slug>`
- `refactor/<issue-id>-<slug>`

## 2. Test First (TDD)

Invoke `superpowers:test-driven-development`.
No production code without a failing test first.

Red → Green → Refactor:
\`\`\`bash
{{ test-command }}
\`\`\`

- One behavior per test.
- Real code, mocks only when unavoidable.
- Watch each test fail for the expected reason before writing code.

## 3. Code

Minimal code to pass the current test.
No features beyond the test's scope.
Match existing style — do not refactor adjacent code.

## 4. Review (before `/ttt:done`)

Invoke `superpowers:verification-before-completion`.
Run every command and confirm the actual output.

\`\`\`bash
{{ lint-command }}
{{ type-check-command }}
{{ test-command }}
\`\`\`

Checklist:
- [ ] All tests pass (new tests went red → green).
- [ ] No lint / type errors.
- [ ] Changes scoped to this task only.
- [ ] No debug logs, stubs, TODOs, commented-out code.
- [ ] Commit message: `<type>(<scope>): <description>` — types: feat, fix, refactor, docs, test, chore.

## 5. Complete

\`/ttt:done -m "summary"\` — MANDATORY.
A task is NOT complete until `/ttt:done` runs.
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
