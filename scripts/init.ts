#!/usr/bin/env bun
import fs from 'node:fs/promises';
import path from 'node:path';
import prompts from 'prompts';
import { encode, decode } from '@toon-format/toon';
import { getLinearClient, getPaths, fileExists, Config, LocalConfig } from './utils';

interface InitOptions {
  apiKey?: string;
  user?: string;
  team?: string;
  label?: string;
  force?: boolean;
  interactive?: boolean;
}

function parseArgs(args: string[]): InitOptions {
  const options: InitOptions = { interactive: true };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    switch (arg) {
      case '--api-key':
      case '-k':
        options.apiKey = args[++i];
        break;
      case '--user':
      case '-u':
        options.user = args[++i];
        break;
      case '--team':
      case '-t':
        options.team = args[++i];
        break;
      case '--label':
      case '-l':
        options.label = args[++i];
        break;
      case '--force':
      case '-f':
        options.force = true;
        break;
      case '--yes':
      case '-y':
        options.interactive = false;
        break;
      case '--help':
      case '-h':
        printHelp();
        process.exit(0);
    }
  }

  return options;
}

function printHelp() {
  console.log(`
linear-toon init - Initialize configuration files

USAGE:
  bun run init [OPTIONS]

OPTIONS:
  -k, --api-key <key>   Linear API key (or set LINEAR_API_KEY env)
  -u, --user <email>    Your email address in Linear
  -t, --team <name>     Team name to sync (optional, fetches from Linear)
  -l, --label <name>    Default label filter (e.g., Frontend, Backend)
  -f, --force           Overwrite existing config files
  -y, --yes             Non-interactive mode (use defaults/provided args)
  -h, --help            Show this help message

EXAMPLES:
  bun run init
  bun run init --user alice@example.com --label Frontend
  bun run init -k lin_api_xxx -y
`);
}

async function init() {
  const args = process.argv.slice(2);
  const options = parseArgs(args);
  const paths = getPaths();

  console.log('🚀 Linear-TOON Initialization\n');

  // Check existing files
  const configExists = await fileExists(paths.configPath);
  const localExists = await fileExists(paths.localPath);

  if ((configExists || localExists) && !options.force) {
    console.log('Existing configuration found:');
    if (configExists) console.log(`  ✓ ${paths.configPath}`);
    if (localExists) console.log(`  ✓ ${paths.localPath}`);

    if (options.interactive) {
      const { proceed } = await prompts({
        type: 'confirm',
        name: 'proceed',
        message: 'Update existing configuration?',
        initial: true
      });
      if (!proceed) {
        console.log('Cancelled.');
        process.exit(0);
      }
    } else {
      console.log('Use --force to overwrite existing files.');
      process.exit(1);
    }
  }

  // Get API key
  let apiKey = options.apiKey || process.env.LINEAR_API_KEY;
  if (!apiKey && options.interactive) {
    const response = await prompts({
      type: 'password',
      name: 'apiKey',
      message: 'Enter your Linear API key:',
      validate: v => v.startsWith('lin_api_') ? true : 'API key should start with "lin_api_"'
    });
    apiKey = response.apiKey;
  }

  if (!apiKey) {
    console.error('Error: LINEAR_API_KEY is required.');
    console.error('Get your API key from: https://linear.app/settings/api');
    process.exit(1);
  }

  // Create Linear client
  const client = getLinearClient();

  console.log('\n📡 Fetching data from Linear...');

  // Fetch teams
  const teamsData = await client.teams();
  const teams = teamsData.nodes;

  if (teams.length === 0) {
    console.error('Error: No teams found in your Linear workspace.');
    process.exit(1);
  }

  // Select team
  let selectedTeam = teams[0];
  if (options.team) {
    const found = teams.find(t => t.name.toLowerCase() === options.team!.toLowerCase());
    if (found) selectedTeam = found;
  } else if (options.interactive && teams.length > 1) {
    const response = await prompts({
      type: 'select',
      name: 'teamId',
      message: 'Select your primary team:',
      choices: teams.map(t => ({ title: t.name, value: t.id }))
    });
    selectedTeam = teams.find(t => t.id === response.teamId) || teams[0];
  }

  console.log(`  Team: ${selectedTeam.name}`);

  // Fetch team members
  const members = await selectedTeam.members();
  const users = members.nodes;
  console.log(`  Users: ${users.length}`);

  // Fetch labels
  const labelsData = await client.issueLabels({
    filter: { team: { id: { eq: selectedTeam.id } } }
  });
  const labels = labelsData.nodes;
  console.log(`  Labels: ${labels.length}`);

  // Fetch workflow states
  const statesData = await client.workflowStates({
    filter: { team: { id: { eq: selectedTeam.id } } }
  });
  const states = statesData.nodes;

  // Fetch current cycle using activeCycle (direct and accurate)
  const currentCycle = await selectedTeam.activeCycle;

  // Select current user
  let currentUser = users[0];
  if (options.user) {
    const found = users.find(u =>
      u.email?.toLowerCase() === options.user!.toLowerCase() ||
      u.displayName?.toLowerCase() === options.user!.toLowerCase()
    );
    if (found) currentUser = found;
  } else if (options.interactive) {
    const response = await prompts({
      type: 'select',
      name: 'userId',
      message: 'Select yourself:',
      choices: users.map(u => ({
        title: `${u.displayName || u.name} (${u.email})`,
        value: u.id
      }))
    });
    currentUser = users.find(u => u.id === response.userId) || users[0];
  }

  // Select default label
  let defaultLabel = labels[0]?.name || 'Frontend';
  if (options.label) {
    defaultLabel = options.label;
  } else if (options.interactive && labels.length > 0) {
    const response = await prompts({
      type: 'select',
      name: 'label',
      message: 'Select default label filter:',
      choices: labels.map(l => ({ title: l.name, value: l.name }))
    });
    defaultLabel = response.label || defaultLabel;
  }

  // Build config
  const teamsConfig: Record<string, { id: string; name: string; icon?: string }> = {};
  for (const team of teams) {
    const key = team.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    teamsConfig[key] = {
      id: team.id,
      name: team.name,
      icon: team.icon || undefined
    };
  }

  const usersConfig: Record<string, { id: string; email: string; displayName: string; role?: string }> = {};
  for (const user of users) {
    const key = (user.displayName || user.name || user.email?.split('@')[0] || 'user')
      .toLowerCase()
      .replace(/[^a-z0-9]/g, '_');
    usersConfig[key] = {
      id: user.id,
      email: user.email || '',
      displayName: user.displayName || user.name || ''
    };
  }

  const labelsConfig: Record<string, { id: string; name: string; color?: string }> = {};
  for (const label of labels) {
    const key = label.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    labelsConfig[key] = {
      id: label.id,
      name: label.name,
      color: label.color || undefined
    };
  }

  const statusesConfig: Record<string, { name: string; type: string }> = {};
  for (const state of states) {
    const key = state.name.toLowerCase().replace(/[^a-z0-9]/g, '_');
    statusesConfig[key] = {
      name: state.name,
      type: state.type
    };
  }

  const config: Config = {
    teams: teamsConfig,
    users: usersConfig,
    labels: labelsConfig,
    priorities: {
      urgent: { value: 1, name: 'Urgent' },
      high: { value: 2, name: 'High' },
      medium: { value: 3, name: 'Medium' },
      low: { value: 4, name: 'Low' }
    },
    statuses: statusesConfig,
    status_transitions: {
      start_work: 'In Progress',
      complete: 'Done',
      need_review: 'In Review'
    },
    priority_order: ['urgent', 'high', 'medium', 'low', 'none'],
    current_cycle: currentCycle ? {
      id: currentCycle.id,
      name: currentCycle.name || `Cycle #${currentCycle.number}`,
      start_date: currentCycle.startsAt?.toISOString().split('T')[0] || '',
      end_date: currentCycle.endsAt?.toISOString().split('T')[0] || ''
    } : undefined,
    cycle_history: []
  };

  // Find current user key
  const currentUserKey = Object.entries(usersConfig).find(
    ([_, u]) => u.id === currentUser.id
  )?.[0] || 'user';

  // Find selected team key
  const selectedTeamKey = Object.entries(teamsConfig).find(
    ([_, t]) => t.id === selectedTeam.id
  )?.[0] || Object.keys(teamsConfig)[0];

  const localConfig: LocalConfig = {
    current_user: currentUserKey,
    team: selectedTeamKey,
    label: defaultLabel
  };

  // Write config files
  console.log('\n📝 Writing configuration files...');

  // Ensure directory exists
  await fs.mkdir(paths.baseDir, { recursive: true });

  // Merge with existing config if exists
  if (configExists && !options.force) {
    try {
      const existingContent = await fs.readFile(paths.configPath, 'utf-8');
      const existingConfig = decode(existingContent) as unknown as Config;

      // Merge: preserve existing custom fields
      config.status_transitions = {
        ...existingConfig.status_transitions,
        ...config.status_transitions
      };
      // Preserve cycle history
      if (existingConfig.cycle_history) {
        config.cycle_history = existingConfig.cycle_history;
      }
      // Preserve current_cycle if not fetched fresh
      if (!currentCycle && existingConfig.current_cycle) {
        config.current_cycle = existingConfig.current_cycle;
      }
      // Preserve priority_order if exists
      if (existingConfig.priority_order) {
        config.priority_order = existingConfig.priority_order;
      }
    } catch {
      // Ignore merge errors
    }
  }

  await fs.writeFile(paths.configPath, encode(config), 'utf-8');
  console.log(`  ✓ ${paths.configPath}`);

  // Merge local config
  if (localExists && !options.force) {
    try {
      const existingContent = await fs.readFile(paths.localPath, 'utf-8');
      const existingLocal = decode(existingContent) as unknown as LocalConfig;

      // Preserve existing values
      if (existingLocal.current_user) localConfig.current_user = existingLocal.current_user;
      if (existingLocal.team) localConfig.team = existingLocal.team;
      if (existingLocal.label) localConfig.label = existingLocal.label;
      if (existingLocal.exclude_assignees) localConfig.exclude_assignees = existingLocal.exclude_assignees;
    } catch {
      // Ignore merge errors
    }
  }

  await fs.writeFile(paths.localPath, encode(localConfig), 'utf-8');
  console.log(`  ✓ ${paths.localPath}`);

  // Summary
  console.log('\n✅ Initialization complete!\n');
  console.log('Configuration summary:');
  console.log(`  Team: ${selectedTeam.name}`);
  console.log(`  User: ${currentUser.displayName || currentUser.name} (${currentUser.email})`);
  console.log(`  Label: ${defaultLabel}`);
  if (currentCycle) {
    console.log(`  Cycle: ${currentCycle.name || `Cycle #${currentCycle.number}`}`);
  }

  console.log('\nNext steps:');
  console.log('  1. Set LINEAR_API_KEY in your shell profile:');
  console.log(`     export LINEAR_API_KEY="${apiKey}"`);
  console.log('  2. Run sync: bun run sync');
  console.log('  3. Start working: bun run work-on');
}

init().catch(console.error);
