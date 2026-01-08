import prompts from 'prompts';
import { execSync } from 'node:child_process';
import { getLinearClient, loadConfig, loadLocalConfig, loadCycleData, saveCycleData, getTeamId, getDefaultTeamKey } from './utils';

interface CommitInfo {
  shortHash: string;
  fullHash: string;
  message: string;
  diffStat: string;
  commitUrl: string | null;
}

async function getLatestCommit(): Promise<CommitInfo | null> {
  try {
    const shortHash = execSync('git rev-parse --short HEAD', { encoding: 'utf-8' }).trim();
    const fullHash = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
    const message = execSync('git log -1 --format=%s', { encoding: 'utf-8' }).trim();
    const diffStat = execSync('git diff HEAD~1 --stat --stat-width=60', { encoding: 'utf-8' }).trim();

    // Get remote URL and construct commit link
    let commitUrl: string | null = null;
    try {
      const remoteUrl = execSync('git remote get-url origin', { encoding: 'utf-8' }).trim();
      // Handle SSH or HTTPS URLs
      // git@gitlab.com:org/repo.git -> https://gitlab.com/org/repo/-/commit/hash
      // https://gitlab.com/org/repo.git -> https://gitlab.com/org/repo/-/commit/hash
      if (remoteUrl.includes('gitlab')) {
        const match = remoteUrl.match(/(?:git@|https:\/\/)([^:\/]+)[:\\/](.+?)(?:\.git)?$/);
        if (match) {
          commitUrl = `https://${match[1]}/${match[2]}/-/commit/${fullHash}`;
        }
      } else if (remoteUrl.includes('github')) {
        const match = remoteUrl.match(/(?:git@|https:\/\/)([^:\/]+)[:\\/](.+?)(?:\.git)?$/);
        if (match) {
          commitUrl = `https://${match[1]}/${match[2]}/commit/${fullHash}`;
        }
      }
    } catch {
      // Ignore if can't get remote URL
    }

    return { shortHash, fullHash, message, diffStat, commitUrl };
  } catch {
    return null;
  }
}

function parseArgs(args: string[]): { issueId?: string; message?: string } {
  let issueId: string | undefined;
  let message: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-m' || arg === '--message') {
      message = args[++i];
    } else if (!arg.startsWith('-')) {
      issueId = arg;
    }
  }

  return { issueId, message };
}

async function doneJob() {
  const args = process.argv.slice(2);

  // Handle help flag
  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: ttt done [issue-id] [-m message]

Arguments:
  issue-id          Issue ID (e.g., MP-624). Optional if only one task is in-progress

Options:
  -m, --message     AI summary message describing the fix

Examples:
  ttt done                         # Complete current in-progress task
  ttt done MP-624                  # Complete specific task
  ttt done -m "Fixed null check"   # With completion message
  ttt done MP-624 -m "Refactored"  # Specific task with message`);
    process.exit(0);
  }

  const { issueId: argIssueId, message: argMessage } = parseArgs(args);
  let issueId = argIssueId;

  const config = await loadConfig();
  const localConfig = await loadLocalConfig();
  const data = await loadCycleData();

  if (!data) {
    console.error('No cycle data found. Run /sync-linear first.');
    process.exit(1);
  }

  // Find in-progress tasks
  const inProgressTasks = data.tasks.filter(t => t.localStatus === 'in-progress');

  if (inProgressTasks.length === 0) {
    console.log('沒有進行中的任務');
    process.exit(0);
  }

  // Phase 0: Issue Resolution
  if (!issueId) {
    if (inProgressTasks.length === 1) {
      issueId = inProgressTasks[0].id;
      console.log(`Auto-selected: ${issueId}`);
    } else if (process.stdin.isTTY) {
      const choices = inProgressTasks.map(task => ({
        title: `${task.id}: ${task.title}`,
        value: task.id,
        description: task.labels.join(', ')
      }));

      const response = await prompts({
        type: 'select',
        name: 'issueId',
        message: '選擇要完成的任務:',
        choices: choices
      });

      if (!response.issueId) {
        console.log('已取消');
        process.exit(0);
      }
      issueId = response.issueId;
    } else {
      console.error('多個進行中任務，請指定 issue ID:');
      inProgressTasks.forEach(t => console.log(`  - ${t.id}: ${t.title}`));
      process.exit(1);
    }
  }

  // Phase 1: Find task
  const task = data.tasks.find(t => t.id === issueId || t.id === `MP-${issueId}`);
  if (!task) {
    console.error(`Issue ${issueId} not found in current cycle.`);
    process.exit(1);
  }

  if (task.localStatus !== 'in-progress') {
    console.log(`⚠️ 任務 ${task.id} 不在進行中狀態 (目前: ${task.localStatus})`);
    process.exit(1);
  }

  // Get latest commit for comment
  const commit = await getLatestCommit();

  // Phase 2: Get AI summary message
  let aiMessage = argMessage || '';
  if (!aiMessage && process.stdin.isTTY) {
    const aiMsgResponse = await prompts({
      type: 'text',
      name: 'aiMessage',
      message: 'AI 修復說明 (如何解決此問題):',
    });
    aiMessage = aiMsgResponse.aiMessage || '';
  }

  // Phase 3: Update Linear
  if (task.linearId && process.env.LINEAR_API_KEY) {
    try {
      const client = getLinearClient();
      const workflowStates = await client.workflowStates({
        filter: { team: { id: { eq: getTeamId(config, localConfig.team) } } }
      });
      const doneState = workflowStates.nodes.find(s => s.name === 'Done');

      // Update issue to Done
      if (doneState) {
        await client.updateIssue(task.linearId, { stateId: doneState.id });
        console.log(`Linear: ${task.id} → Done`);
      }

      // Add comment with commit info and AI summary
      if (commit) {
        const commitLink = commit.commitUrl
          ? `[${commit.shortHash}](${commit.commitUrl})`
          : `\`${commit.shortHash}\``;

        const commentParts = [
          '## ✅ 開發完成',
          '',
          '### 🤖 AI 修復說明',
          aiMessage || '_No description provided_',
          '',
          '### 📝 Commit Info',
          `**Commit:** ${commitLink}`,
          `**Message:** ${commit.message}`,
          '',
          '### 📊 Changes',
          '```',
          commit.diffStat,
          '```',
        ];

        await client.createComment({
          issueId: task.linearId,
          body: commentParts.join('\n')
        });
        console.log(`Linear: 已新增 commit 留言`);
      }

      // Update parent to Testing if exists
      if (task.parentIssueId) {
        try {
          // Find parent issue by identifier
          const searchResult = await client.searchIssues(task.parentIssueId);
          const parentIssue = searchResult.nodes.find(
            issue => issue.identifier === task.parentIssueId
          );

          if (parentIssue) {
            // Get parent's team workflow states
            const parentTeam = await parentIssue.team;
            if (parentTeam) {
              const parentWorkflowStates = await client.workflowStates({
                filter: { team: { id: { eq: parentTeam.id } } }
              });
              const testingState = parentWorkflowStates.nodes.find(s => s.name === 'Testing');

              if (testingState) {
                await client.updateIssue(parentIssue.id, { stateId: testingState.id });
                console.log(`Linear: Parent ${task.parentIssueId} → Testing`);
              }
            }
          }
        } catch (parentError) {
          console.error('Failed to update parent issue:', parentError);
        }
      }
    } catch (e) {
      console.error('Failed to update Linear:', e);
    }
  }

  // Phase 4: Update local status
  task.localStatus = 'completed';
  await saveCycleData(data);
  console.log(`Local: ${task.id} → completed`);

  // Phase 5: Summary
  console.log(`\n${'═'.repeat(50)}`);
  console.log(`✅ ${task.id}: ${task.title}`);
  console.log(`${'═'.repeat(50)}`);
  if (commit) {
    console.log(`Commit: ${commit.shortHash} - ${commit.message}`);
    if (commit.commitUrl) {
      console.log(`URL: ${commit.commitUrl}`);
    }
  }
  if (aiMessage) {
    console.log(`AI: ${aiMessage}`);
  }
  if (task.parentIssueId) {
    console.log(`Parent: ${task.parentIssueId} → Testing`);
  }
  console.log(`\n🎉 任務完成！`);
}

doneJob().catch(console.error);
