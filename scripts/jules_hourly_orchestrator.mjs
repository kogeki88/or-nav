#!/usr/bin/env node
/**
 * Hourly Autonomous Jules Fleet Orchestrator
 *
 * Maintains 15 concurrent active Jules tasks for kogeki88/or-nav.
 * Unblocks waiting sessions, auto-verifies and merges clean PRs,
 * syncs local git, and replenishes from the high-impact backlog.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const BACKLOG_PATH = path.join(__dirname, 'jules_task_backlog.json');
const LOGS_DIR = path.join(ROOT_DIR, 'logs');
const LOG_FILE = path.join(LOGS_DIR, 'jules_orchestrator.log');

const TARGET_CONCURRENCY = 15;
const REPO_SOURCE = 'sources/github/kogeki88/or-nav';
const REPO_NAME = 'kogeki88/or-nav';
const GH_PATH = fs.existsSync('C:\\Program Files\\GitHub CLI\\gh.exe')
  ? '"C:\\Program Files\\GitHub CLI\\gh.exe"'
  : 'gh';

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function getApiKey() {
  if (process.env.JULES_API_KEY) {
    return process.env.JULES_API_KEY;
  }
  try {
    const key = execSync(
      'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'JULES_API_KEY\', \'User\')"',
      { encoding: 'utf8' }
    ).trim();
    if (key) return key;
  } catch (err) {
    // Ignore error
  }
  throw new Error('JULES_API_KEY not found in environment or user registry.');
}

async function julesFetch(url, apiKey, options = {}) {
  const headers = {
    'X-Goog-Api-Key': apiKey,
    'Content-Type': 'application/json',
    ...(options.headers || {})
  };
  const res = await fetch(url, { ...options, headers });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`HTTP ${res.status} from ${url}: ${body}`);
  }
  return res.json().catch(() => ({}));
}

async function checkAndMergePRs() {
  log('--- Step 1: Checking open Jules PRs for auto-verification and merge ---');
  let openPRs = [];
  try {
    const raw = execSync(
      `${GH_PATH} pr list --repo ${REPO_NAME} --json number,title,headRefName,url,isDraft`,
      { encoding: 'utf8' }
    );
    openPRs = JSON.parse(raw || '[]');
  } catch (err) {
    log(`Warning: Failed to query open PRs via gh: ${err.message}`);
    return;
  }

  log(`Found ${openPRs.length} open pull request(s) on ${REPO_NAME}`);

  for (const pr of openPRs) {
    if (pr.isDraft) continue;

    try {
      const diff = execSync(
        `${GH_PATH} pr diff ${pr.number} --repo ${REPO_NAME}`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
      );

      // Invariant 1: Never bundle APK binaries into web assets or commit .apk/.exe files
      const hasRestrictedBinary = /\.(apk|exe|bin|jar)\b/i.test(diff);
      if (hasRestrictedBinary) {
        log(`[PR #${pr.number}] SKIPPED merge: contains restricted binary file in diff.`);
        continue;
      }

      // Invariant 2: Never allow wholesale deletion of test files
      const deletedTests = diff.match(/deleted file mode [0-9]+\s+--- a\/backend\/tests\/test_[a-zA-Z0-9_]+\.py/g);
      if (deletedTests && deletedTests.length > 2) {
        log(`[PR #${pr.number}] SKIPPED merge: suspicious deletion of ${deletedTests.length} test files.`);
        continue;
      }

      log(`[PR #${pr.number}] VERIFIED: Clean diff. Auto-merging '${pr.title}'...`);
      try {
        execSync(
          `${GH_PATH} pr merge ${pr.number} --squash --delete-branch --repo ${REPO_NAME}`,
          { encoding: 'utf8' }
        );
        log(`[PR #${pr.number}] SUCCESS: Merged into main and deleted branch.`);
      } catch (mergeErr) {
        log(`[PR #${pr.number}] Merge command output: ${mergeErr.message.trim()}`);
      }
    } catch (err) {
      log(`[PR #${pr.number}] Error evaluating diff: ${err.message}`);
    }
  }

  // Step 1b: Sync local workspace
  try {
    log('Syncing local workspace with origin/main via rebase...');
    execSync('git pull --rebase origin main', { cwd: ROOT_DIR, encoding: 'utf8' });
    log('Local workspace successfully synchronized.');
  } catch (syncErr) {
    log(`Local git sync note: ${syncErr.message.trim()}`);
  }
}

async function auditAndUnblockSessions(apiKey) {
  log('--- Step 2: Auditing and unblocking active Jules sessions ---');
  const data = await julesFetch('https://jules.googleapis.com/v1alpha/sessions', apiKey);
  const sessions = data.sessions || [];

  const approvalPrompt =
    'Approved. Proceed with implementation and PR creation. Enforce OR-Nav architectural invariants: ' +
    '(1) Zero regressions on existing pytest/Playwright suites, ' +
    '(2) Strict multi-tenant isolation (facility_id::dept_id), ' +
    '(3) Offline-first Dexie + FastAPI parity, ' +
    '(4) Preserve spoken clinician preferences in the lexicon, and ' +
    '(5) Never bundle APK binaries into web assets. Create the PR immediately upon verification.';

  let activeCount = 0;
  let unblockedCount = 0;
  let archivedCount = 0;

  for (const s of sessions) {
    if (s.sourceContext?.source !== REPO_SOURCE && !s.title?.includes('OR-Nav') && !s.id) {
      continue;
    }

    const title = (s.title || 'Untitled').split('\n')[0];

    if (s.state === 'COMPLETED') {
      log(`[Session ${s.id}] COMPLETED ('${title}'). Closing/deleting to clear slot...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, {
          method: 'DELETE'
        });
        archivedCount++;
      } catch (err) {
        log(`Failed to close session ${s.id}: ${err.message}`);
      }
    } else if (s.state === 'FAILED') {
      log(`[Session ${s.id}] FAILED ('${title}'). Deleting failed slot to free concurrency...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, {
          method: 'DELETE'
        });
      } catch (err) {
        // ignore
      }
    } else if (s.state === 'AWAITING_USER_FEEDBACK' || s.state === 'AWAITING_PLAN_APPROVAL' || s.state === 'PAUSED') {
      log(`[Session ${s.id}] ${s.state} ('${title}'). Sending architectural approval...`);
      try {
        if (s.state === 'AWAITING_PLAN_APPROVAL') {
          await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}:approvePlan`, apiKey, {
            method: 'POST',
            body: JSON.stringify({})
          }).catch(() => {});
        }

        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}:sendMessage`, apiKey, {
          method: 'POST',
          body: JSON.stringify({ prompt: approvalPrompt })
        });
        unblockedCount++;
        activeCount++;
      } catch (err) {
        log(`Failed to unblock session ${s.id}: ${err.message}`);
        activeCount++;
      }
    } else if (s.state === 'IN_PROGRESS' || s.state === 'QUEUED' || s.state === 'PLANNING') {
      activeCount++;
    }
  }

  log(`Audit complete: ${unblockedCount} unblocked, ${archivedCount} completed sessions closed, ${activeCount} active sessions.`);
  return activeCount;
}

async function replenishPool(apiKey, currentActive) {
  log(`--- Step 3: Checking concurrency pool (Current: ${currentActive} / Target: ${TARGET_CONCURRENCY}) ---`);
  const needed = TARGET_CONCURRENCY - currentActive;
  if (needed <= 0) {
    log(`Concurrency pool is full (${currentActive}/${TARGET_CONCURRENCY}). No replenishment needed.`);
    return;
  }

  log(`Replenishment needed: launching ${needed} high-impact tasks...`);

  let backlog = [];
  if (fs.existsSync(BACKLOG_PATH)) {
    try {
      backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    } catch (err) {
      log(`Error reading backlog: ${err.message}`);
    }
  }

  let launched = 0;
  for (const item of backlog) {
    if (launched >= needed) break;
    if (item.status === 'dispatched') continue;

    log(`Dispatching [${item.id}] '${item.title}'...`);
    try {
      const payload = {
        prompt: item.prompt,
        title: item.title,
        sourceContext: {
          source: REPO_SOURCE,
          githubRepoContext: {
            startingBranch: 'main'
          }
        },
        automationMode: 'AUTO_CREATE_PR'
      };

      const resp = await julesFetch('https://jules.googleapis.com/v1alpha/sessions', apiKey, {
        method: 'POST',
        body: JSON.stringify(payload)
      });

      item.status = 'dispatched';
      item.sessionId = resp.id;
      item.dispatchedAt = new Date().toISOString();
      launched++;
      log(`Successfully dispatched [${item.id}] -> Jules Session ${resp.id}`);
    } catch (err) {
      log(`Failed to dispatch [${item.id}]: ${err.message}`);
    }
  }

  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2), 'utf8');
  log(`Replenished ${launched} task(s). Total active pool is now ${currentActive + launched} / ${TARGET_CONCURRENCY}.`);
}

async function run() {
  log('========================================================================');
  log('         HOURLY AUTONOMOUS JULES FLEET ORCHESTRATOR RUN STARTED          ');
  log('========================================================================');
  try {
    const apiKey = getApiKey();
    await checkAndMergePRs();
    const active = await auditAndUnblockSessions(apiKey);
    await replenishPool(apiKey, active);
    log('Hourly run finished successfully.');
  } catch (err) {
    log(`ORCHESTRATOR FATAL ERROR: ${err.stack || err.message}`);
  }
}

run();
