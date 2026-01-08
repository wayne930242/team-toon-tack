import { getLinearClient, loadConfig, loadLocalConfig, saveConfig, loadCycleData, saveCycleData, getTeamId, CycleData, Task, Attachment, Comment } from './utils';

async function sync() {
  const args = process.argv.slice(2);

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: ttt sync

Sync issues from Linear to local cycle.ttt file.

What it does:
  - Fetches active cycle from Linear
  - Downloads all issues matching configured label
  - Preserves local status for existing tasks
  - Updates config with new cycle info

Examples:
  ttt sync              # Sync in current directory
  ttt sync -d .ttt     # Sync using .ttt directory`);
    process.exit(0);
  }

  const config = await loadConfig();
  const localConfig = await loadLocalConfig();
  const client = getLinearClient();
  const teamId = getTeamId(config);

  // Build excluded emails from local config
  const excludedEmails = new Set(
    (localConfig.exclude_assignees ?? [])
      .map(key => config.users[key]?.email)
      .filter(Boolean)
  );

  // Phase 1: Fetch and update latest active cycle
  console.log('Fetching latest cycle...');
  const team = await client.team(teamId);
  const cycles = await team.cycles({
    filter: { isActive: { eq: true } },
    first: 1
  });

  if (cycles.nodes.length === 0) {
    console.error('No active cycle found.');
    process.exit(1);
  }

  const activeCycle = cycles.nodes[0];
  const cycleChanged = config.current_cycle.id !== activeCycle.id;

  if (cycleChanged) {
    console.log(`Cycle changed: ${config.current_cycle.name} → ${activeCycle.name}`);
    config.current_cycle = {
      id: activeCycle.id,
      name: activeCycle.name ?? `Cycle`,
      start_date: activeCycle.startsAt?.toISOString().split('T')[0] ?? '',
      end_date: activeCycle.endsAt?.toISOString().split('T')[0] ?? ''
    };
    await saveConfig(config);
    console.log('Config updated with new cycle.');
  } else {
    console.log(`Current cycle: ${config.current_cycle.name}`);
  }

  const cycleId = config.current_cycle.id;

  // Phase 2: Fetch workflow states
  const workflowStates = await client.workflowStates({
    filter: { team: { id: { eq: teamId } } }
  });
  const stateMap = new Map(workflowStates.nodes.map(s => [s.name, s.id]));
  const testingStateId = stateMap.get('Testing');

  // Phase 3: Read existing local state
  const existingData = await loadCycleData();
  const existingTasksMap = new Map(existingData?.tasks.map(t => [t.id, t]));

  // Phase 4: Fetch current issues with full content
  const filterLabel = localConfig.label ?? 'Frontend';
  console.log(`Fetching issues with label: ${filterLabel}...`);
  const issues = await client.issues({
    filter: {
      team: { id: { eq: teamId } },
      cycle: { id: { eq: cycleId } },
      labels: { name: { eq: filterLabel } },
      state: { name: { in: ["Todo", "In Progress"] } }
    },
    first: 50
  });

  if (issues.nodes.length === 0) {
    console.log(`No ${filterLabel} issues found in current cycle with Todo/In Progress status.`);
  }

  const tasks: Task[] = [];
  let updatedCount = 0;

  for (const issue of issues.nodes) {
    const assignee = await issue.assignee;
    const assigneeEmail = assignee?.email;

    // Skip excluded assignees
    if (assigneeEmail && excludedEmails.has(assigneeEmail)) {
      continue;
    }

    const labels = await issue.labels();
    const state = await issue.state;
    const parent = await issue.parent;
    const attachmentsData = await issue.attachments();
    const commentsData = await issue.comments();

    // Build attachments list
    const attachments: Attachment[] = attachmentsData.nodes.map(a => ({
      id: a.id,
      title: a.title,
      url: a.url,
      sourceType: a.sourceType ?? undefined
    }));

    // Build comments list
    const comments: Comment[] = await Promise.all(
      commentsData.nodes.map(async c => {
        const user = await c.user;
        return {
          id: c.id,
          body: c.body,
          createdAt: c.createdAt.toISOString(),
          user: user?.displayName ?? user?.email
        };
      })
    );

    let localStatus: Task['localStatus'] = 'pending';

    // Preserve local status & sync completed tasks to Linear
    if (existingTasksMap.has(issue.identifier)) {
      const existing = existingTasksMap.get(issue.identifier)!;
      localStatus = existing.localStatus;

      if (localStatus === 'completed' && state && testingStateId) {
        if (!['Testing', 'Done', 'In Review', 'Canceled'].includes(state.name)) {
          console.log(`Updating ${issue.identifier} to Testing in Linear...`);
          await client.updateIssue(issue.id, { stateId: testingStateId });
          updatedCount++;
        }
      }
    }

    const task: Task = {
      id: issue.identifier,
      linearId: issue.id,
      title: issue.title,
      status: state ? state.name : 'Unknown',
      localStatus: localStatus,
      assignee: assigneeEmail,
      priority: issue.priority,
      labels: labels.nodes.map(l => l.name),
      branch: issue.branchName,
      description: issue.description,
      parentIssueId: parent ? parent.identifier : undefined,
      url: issue.url,
      attachments: attachments.length > 0 ? attachments : undefined,
      comments: comments.length > 0 ? comments : undefined
    };

    tasks.push(task);
  }

  // Sort by priority (urgent first)
  tasks.sort((a, b) => {
    const pa = a.priority === 0 ? 5 : a.priority;
    const pb = b.priority === 0 ? 5 : b.priority;
    return pa - pb;
  });

  const newData: CycleData = {
    cycleId: cycleId,
    cycleName: config.current_cycle.name,
    updatedAt: new Date().toISOString(),
    tasks: tasks
  };

  await saveCycleData(newData);
  console.log(`\n✅ Synced ${tasks.length} tasks for ${config.current_cycle.name}.`);
  if (updatedCount > 0) {
    console.log(`   Updated ${updatedCount} issues to Testing in Linear.`);
  }
}

sync().catch(console.error);
