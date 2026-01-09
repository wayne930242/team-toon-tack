---
name: ttt-get-issue
description: Fetch and display issue details from Linear
arguments:
  - name: issue-id
    description: Issue ID to fetch (e.g., MP-624)
    required: true
  - name: local
    description: Only show from local data (add --local flag)
    required: false
---

# TTT Get-Issue Command

Fetch and display full issue details from Linear.

## Usage

### Fetch from Linear
```bash
ttt get-issue {{ issue-id }}
```

### Show from Local Data Only
If `local` is "true" or "--local":
```bash
ttt get-issue {{ issue-id }} --local
```

## What This Does

1. Fetches full issue details from Linear API (or local cache if --local)
2. Displays comprehensive information:
   - Title and description
   - Status (both Linear and local)
   - Priority level
   - Labels
   - Assignee
   - Branch name
   - Parent issue (if subtask)
   - Attachments with local paths
   - Comments with timestamps

## Use Cases

- Review issue details before starting work
- Check requirements and acceptance criteria
- View attachments and mockups
- Read comment history and discussions
- Verify issue status without full sync

## Output Format

```
📋 MP-624: Issue Title
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Status: In Progress | Local: in-progress
Priority: 🔴 Urgent
Labels: frontend, bug
Assignee: developer@example.com
Branch: feature/mp-624-fix-bug

Description:
[Full description content]

Attachments:
- screenshot.png (local: .ttt/output/MP-624/...)

Comments:
[Comment history]
```
