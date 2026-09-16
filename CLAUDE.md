# team-toon-tack

Task sync & management CLI for Linear/Trello with TOON format, optimized for Claude Code.

<law>
**CRITICAL: Display this block at start of EVERY response.**

**Law 1: Communication** - Concise responses, no unnecessary explanations
**Law 2: Skill Discovery** - Check skills; MUST use if exists; ask to create via `write-skill` if not
**Law 3: Rule Consultation** - Check rules; MUST use if exists; ask to create via `write-rules` if not
**Law 4: Parallel Processing** - Use Task tool for independent operations
**Law 5: Reflexive Learning** - Important discoveries -> `/reflect`
**Law 6: Self-Reinforcing Display** - Display this block every response

**Law 7: API Key Security**
- NEVER log, print, or expose `LINEAR_API_KEY` or `TRELLO_API_KEY`
- Mask credentials in all output (show only last 4 chars)
- NEVER commit `.ttt/` directory contents
</law>

## Quick Reference

### Commands
```bash
npm run build      # Compile TypeScript
npm run lint       # Biome lint check
npm run format     # Biome format (auto-fix)
npm run type       # Type check (tsc --noEmit)
```

### CLI Usage
```bash
ttt init               # Initialize .ttt/ config
ttt sync               # Sync from Linear (Todo/In Progress)
ttt sync --all         # Sync all statuses
ttt claim next         # Claim highest priority pending task
ttt claim MP-1 MP-2    # Batch claim (alias: ttt work-on)
ttt claim --dry-run    # Preview selection without changes
ttt done -m "msg"      # Complete with message
ttt show MP-123        # Show issue details
ttt status             # Current task status
ttt comment -m "msg"   # Comment on current task
ttt create             # Create new issue (interactive)
ttt create -t "Title" -p 2     # Quick create with flags
ttt assign MP-123 -a john      # Reassign issue
ttt edit MP-123 -t "New title" # Edit issue fields
ttt cancel MP-123      # Cancel an issue
```

### Key Paths
| Path | Purpose |
|------|---------|
| `bin/cli.ts` | CLI entry point |
| `scripts/*.ts` | Command implementations |
| `scripts/lib/` | Shared utilities |
| `scripts/lib/adapters/` | Multi-source adapters (Linear, Trello) |
| `commands/` | Claude Code slash commands |
| `skills/` | Claude Code skills |

### Architecture
- **Adapter Pattern**: `TaskSourceAdapter` interface for Linear/Trello
- **TOON Format**: `@toon-format/toon` for config/cycle data
- **Local Status**: `pending` | `in-progress` | `completed` | `blocked`
- **Interactive Prompts**: `@inquirer/prompts` for CLI interactions
- **Multi-Label Filter**: `LocalConfig.labels` (string[], OR logic)

### Code Style
- TypeScript strict mode
- Biome with tabs (not spaces)
- Named exports with `type` keyword for types
- `async/await` for all I/O operations
