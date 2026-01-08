import prompts from 'prompts';
import { getLinearClient, loadConfig, loadLocalConfig, loadCycleData, saveCycleData, getUserEmail, getTeamId, getPrioritySortIndex } from './utils';

const PRIORITY_LABELS: Record<number, string> = {
  0: '⚪ None',
  1: '🔴 Urgent',
  2: '🟠 High',
  3: '🟡 Medium',
  4: '🟢 Low'
};

async function workOn() {
  const args = process.argv.slice(2);

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: ttt work-on [issue-id]

Arguments:
  issue-id    Issue ID (e.g., MP-624) or 'next' for auto-select
              If omitted, shows interactive selection

Examples:
  ttt work-on           # Interactive selection
  ttt work-on MP-624    # Work on specific issue
  ttt work-on next      # Auto-select highest priority`);
    process.exit(0);
  }

  let issueId = args[0];

  const config = await loadConfig();
  const data = await loadCycleData();

  if (!data) {
    console.error('No cycle data found. Run /sync-linear first.');
    process.exit(1);
  }

  const userEmail = await getUserEmail();
  const localConfig = await loadLocalConfig();

  // Build excluded emails list from user keys
  const excludedEmails = new Set(
    (localConfig.exclude_assignees ?? [])
      .map(key => config.users[key]?.email)
      .filter(Boolean)
  );

  const pendingTasks = data.tasks
    .filter(t =>
      t.localStatus === 'pending' &&
      !excludedEmails.has(t.assignee ?? '')
    )
    .sort((a, b) => {
      const pa = getPrioritySortIndex(a.priority, config.priority_order);
      const pb = getPrioritySortIndex(b.priority, config.priority_order);
      return pa - pb;
    });

  // Phase 0: Issue Resolution
  if (!issueId) {
    // Interactive selection
    if (pendingTasks.length === 0) {
      console.log('✅ 沒有待處理的任務，所有工作已完成或進行中');
      process.exit(0);
    }

    const choices = pendingTasks.map(task => ({
      title: `${PRIORITY_LABELS[task.priority] || '⚪'} ${task.id}: ${task.title}`,
      value: task.id,
      description: task.labels.join(', ')
    }));

    const response = await prompts({
      type: 'select',
      name: 'issueId',
      message: '選擇要處理的任務:',
      choices: choices
    });

    if (!response.issueId) {
      console.log('已取消');
      process.exit(0);
    }
    issueId = response.issueId;
  } else if (['next', '下一個', '下一個工作'].includes(issueId)) {
    // Auto-select highest priority
    if (pendingTasks.length === 0) {
      console.log('✅ 沒有待處理的任務，所有工作已完成或進行中');
      process.exit(0);
    }
    issueId = pendingTasks[0].id;
    console.log(`Auto-selected: ${issueId}`);
  }

  // Phase 1: Find task
  const task = data.tasks.find(t => t.id === issueId || t.id === `MP-${issueId}`);
  if (!task) {
    console.error(`Issue ${issueId} not found in current cycle.`);
    process.exit(1);
  }

  // Phase 2: Availability Check
  if (task.localStatus === 'in-progress') {
    console.log(`⚠️ 此任務 ${task.id} 已在進行中`);
  } else if (task.localStatus === 'completed') {
    console.log(`⚠️ 此任務 ${task.id} 已完成`);
    process.exit(0);
  }

  // Phase 3: Mark as In Progress
  if (task.localStatus === 'pending') {
    task.localStatus = 'in-progress';
    await saveCycleData(data);
    console.log(`Local: ${task.id} → in-progress`);

    // Update Linear using stored linearId
    if (task.linearId && process.env.LINEAR_API_KEY) {
      try {
        const client = getLinearClient();
        const workflowStates = await client.workflowStates({
          filter: { team: { id: { eq: getTeamId(config) } } }
        });
        const inProgressState = workflowStates.nodes.find(s => s.name === 'In Progress');

        if (inProgressState) {
          await client.updateIssue(task.linearId, { stateId: inProgressState.id });
          console.log(`Linear: ${task.id} → In Progress`);
        }
      } catch (e) {
        console.error('Failed to update Linear:', e);
      }
    }
  }

  // Phase 4: Display task info
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`👷 ${task.id}: ${task.title}`);
  console.log(`${'═'.repeat(50)}`);
  console.log(`Priority: ${PRIORITY_LABELS[task.priority] || 'None'}`);
  console.log(`Labels: ${task.labels.join(', ')}`);
  console.log(`Branch: ${task.branch || 'N/A'}`);
  if (task.url) console.log(`URL: ${task.url}`);

  if (task.description) {
    console.log(`\n📝 Description:\n${task.description}`);
  }

  if (task.attachments && task.attachments.length > 0) {
    console.log(`\n📎 Attachments:`);
    for (const att of task.attachments) {
      console.log(`   - ${att.title}: ${att.url}`);
    }
  }

  console.log(`\n${'─'.repeat(50)}`);
  console.log('Next: bun type-check && bun lint');
}

workOn().catch(console.error);
