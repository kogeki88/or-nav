#!/usr/bin/env node
/**
 * 30-Minute Autonomous Jules Fleet Orchestrator & Local Sync Daemon
 *
 * Maintains exactly 15 concurrent active Jules tasks for kogeki88/or-nav.
 * Audits & unblocks waiting sessions, auto-verifies and merges clean PRs,
 * syncs local git workspace via rebase with autostash, and replenishes
 * the active pool from the prioritized high-impact backlog.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { processSessionCognitively } from './jules_cognitive_manager.mjs';

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

function logTelemetry(data) {
  const ts = new Date().toISOString();
  const entry = JSON.stringify({ timestamp: ts, ...data });
  const line = `[${ts}] [TELEMETRY] ${entry}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
  }
  fs.appendFileSync(LOG_FILE, line + '\n', 'utf8');
}

function getApiKey() {
  if (process.env.JULES_API_KEY) {
    return process.env.JULES_API_KEY.trim();
  }
  try {
    const key = execSync(
      'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'JULES_API_KEY\', \'User\')"',
      { encoding: 'utf8', timeout: 4000 }
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


function requeueTaskBySessionId(sessionId, sessionTitle) {
  if (!fs.existsSync(BACKLOG_PATH)) return;
  try {
    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    const item = backlog.find(t => 
      (t.sessionId && String(t.sessionId) === String(sessionId)) || 
      (sessionTitle && t.title && t.title.toLowerCase().trim() === sessionTitle.toLowerCase().trim())
    );
    if (item && item.status !== 'completed') {
      item.status = 'pending';
      delete item.sessionId;
      delete item.dispatchedAt;
      fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2), 'utf8');
      log(`Re-queued backlog task [${item.id}] '${item.title}'`);
    }
  } catch (err) {
    log(`Failed to requeue task for session ${sessionId}: ${err.message}`);
  }
}

function markTaskCompletedBySessionId(sessionId, sessionTitle) {
  if (!fs.existsSync(BACKLOG_PATH)) return;
  try {
    const backlog = JSON.parse(fs.readFileSync(BACKLOG_PATH, 'utf8'));
    const item = backlog.find(t => 
      (t.sessionId && String(t.sessionId) === String(sessionId)) || 
      (sessionTitle && t.title && t.title.toLowerCase().trim() === sessionTitle.toLowerCase().trim())
    );
    if (item) {
      item.status = 'completed';
      item.completedAt = new Date().toISOString();
      fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2), 'utf8');
      log(`Marked backlog task [${item.id}] '${item.title}' as completed.`);
    }
  } catch (err) {
    log(`Failed to mark task completed for session ${sessionId}: ${err.message}`);
  }
}

// -----------------------------------------------------------------------------
// Step 1: Auto-Merge Completed Jules PRs & Sync Local Workspace
// -----------------------------------------------------------------------------
async function checkAndMergePRs(apiKey) {
  log('--- Step 1: Checking open Jules PRs for auto-verification and merge ---');
  let openPRs = [];
  try {
    const raw = execSync(
      `${GH_PATH} pr list --repo ${REPO_NAME} --limit 100 --json number,title,headRefName,url,isDraft,mergeable,mergeStateStatus`,
      { encoding: 'utf8', timeout: 15000 }
    );
    openPRs = JSON.parse(raw || '[]');
  } catch (err) {
    log(`Warning: Failed to query open PRs via gh: ${err.message}`);
    return { evaluated: 0, merged: 0, syncStatus: 'ERROR' };
  }

  log(`Found ${openPRs.length} open pull request(s) on ${REPO_NAME}`);
  let mergedCount = 0;
  let evaluatedCount = 0;

  for (const pr of openPRs) {
    if (pr.isDraft) continue;
    evaluatedCount++;

    try {
      let mergeableStatus = pr.mergeable;
      let mergeState = pr.mergeStateStatus;

      // If status is UNKNOWN, fetch explicit view from GitHub to trigger computation (with retry for async calculation)
      if (mergeableStatus === 'UNKNOWN' || !mergeableStatus) {
        for (let attempt = 0; attempt < 2; attempt++) {
          if (attempt > 0) {
            await new Promise(r => setTimeout(r, 1500));
          }
          try {
            const detailRaw = execSync(
              `${GH_PATH} pr view ${pr.number} --repo ${REPO_NAME} --json mergeable,mergeStateStatus`,
              { encoding: 'utf8', timeout: 10000 }
            );
            const detail = JSON.parse(detailRaw || '{}');
            mergeableStatus = detail.mergeable || mergeableStatus;
            mergeState = detail.mergeStateStatus || mergeState;
            if (mergeableStatus && mergeableStatus !== 'UNKNOWN') break;
          } catch (viewErr) {
            log(`[PR #${pr.number}] Warning: Could not refresh mergeable status: ${viewErr.message}`);
          }
        }
      }

      // Check if PR is conflicting or dirty; if so, attempt a rebase update from base branch
      if (mergeableStatus === 'CONFLICTING' || mergeState === 'DIRTY') {
        log(`[PR #${pr.number}] CONFLICTING/DIRTY: Attempting 'gh pr update-branch --rebase'...`);
        try {
          execSync(`${GH_PATH} pr update-branch ${pr.number} --rebase --repo ${REPO_NAME}`, {
            encoding: 'utf8',
            timeout: 20000
          });
          log(`[PR #${pr.number}] Rebase update succeeded.`);
          mergeableStatus = 'MERGEABLE';
        } catch (updateErr) {
          log(`[PR #${pr.number}] SKIPPED: Cannot merge due to unresolved merge conflicts with main.`);
          continue;
        }
      }

      if (mergeableStatus !== 'MERGEABLE') {
        log(`[PR #${pr.number}] SKIPPED: PR mergeable status is ${mergeableStatus} (${mergeState}).`);
        continue;
      }

      const diff = execSync(
        `${GH_PATH} pr diff ${pr.number} --repo ${REPO_NAME}`,
        { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, timeout: 15000 }
      );

      // Invariant 1: Never bundle APK binaries into web assets or commit .apk/.exe/.bin files
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
          { encoding: 'utf8', timeout: 20000 }
        );
        log(`[PR #${pr.number}] SUCCESS: Merged into main and deleted branch.`);
        mergedCount++;
        const sessionMatch = pr.headRefName?.match(/([0-9]{17,20})/);
        if (sessionMatch) {
          const prSessionId = sessionMatch[1];
          if (apiKey) {
            try {
              await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${prSessionId}`, apiKey, { method: 'DELETE' });
              log(`[PR #${pr.number}] Closed completed Jules session ${prSessionId}.`);
            } catch (e) {}
          }
          markTaskCompletedBySessionId(prSessionId, pr.title);
        }
      } catch (mergeErr) {
        log(`[PR #${pr.number}] Merge command output: ${mergeErr.message.trim()}`);
      }
    } catch (err) {
      log(`[PR #${pr.number}] Error evaluating diff: ${err.message}`);
    }
  }

  // Step 1b: Sync local workspace with autostash
  let syncStatus = 'SUCCESS';
  try {
    log('Syncing local workspace with origin/main via rebase with autostash...');
    execSync('git fetch origin main', { cwd: ROOT_DIR, encoding: 'utf8', timeout: 25000 });
    execSync('git rebase --autostash origin/main', { cwd: ROOT_DIR, encoding: 'utf8', timeout: 25000 });
    log('Local workspace successfully synchronized.');
  } catch (syncErr) {
    syncStatus = 'FAILED';
    log(`Local git sync note: ${syncErr.message.trim()}`);
  }

  return { evaluated: evaluatedCount, merged: mergedCount, syncStatus };
}

// -----------------------------------------------------------------------------
// Step 2: Audit & Unblock Waiting Sessions
// -----------------------------------------------------------------------------
async function auditAndUnblockSessions(apiKey) {
  log('--- Step 2: Auditing and unblocking active Jules sessions ---');
  let sessions = [];
  try {
    const data = await julesFetch('https://jules.googleapis.com/v1alpha/sessions', apiKey);
    sessions = data.sessions || [];
  } catch (err) {
    log(`Failed to fetch sessions from Jules API: ${err.message}`);
    return { activeCount: 0, unblockedCount: 0, closedCount: 0 };
  }

  const approvalPrompt =
    'Approved. Proceed with implementation and PR creation. Enforce OR-Nav architectural invariants: ' +
    '(1) Zero regressions on existing pytest/Playwright suites, ' +
    '(2) Strict multi-tenant isolation (facility_id::dept_id), ' +
    '(3) Offline-first Dexie + FastAPI parity, ' +
    '(4) Preserve spoken clinician preferences in the lexicon, and ' +
    '(5) Never bundle APK binaries into web assets. Create the PR immediately upon verification.';

  let activeCount = 0;
  let unblockedCount = 0;
  let closedCount = 0;

  const nowMs = Date.now();

  for (const s of sessions) {
    const isOrNav = s.sourceContext?.source === REPO_SOURCE || 
                    s.sourceContext?.source?.includes('or-nav') ||
                    (s.title && s.title.toLowerCase().includes('or-nav')) ||
                    s.sourceContext?.source?.includes('kogeki88/or-nav');
    if (!isOrNav) {
      continue;
    }

    const title = (s.title || 'Untitled').split('\n')[0];
    const updateTimeMs = s.updateTime ? new Date(s.updateTime).getTime() : 0;
    const ageHours = updateTimeMs ? (nowMs - updateTimeMs) / (1000 * 60 * 60) : 0;

    // Condition A: Clean up completed sessions
    if (s.state === 'COMPLETED') {
      log(`[Session ${s.id}] COMPLETED ('${title}'). Deleting to clear slot...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, { method: 'DELETE' });
        closedCount++;
      } catch (err) {
        log(`Failed to delete session ${s.id}: ${err.message}`);
      }
      markTaskCompletedBySessionId(s.id, title);
      continue;
    }

    // Condition B: Clean up failed sessions
    if (s.state === 'FAILED') {
      log(`[Session ${s.id}] FAILED ('${title}'). Deleting failed slot to free concurrency...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, { method: 'DELETE' });
        closedCount++;
      } catch (err) {}
      requeueTaskBySessionId(s.id, title);
      continue;
    }

    // Condition C: Check for stalled IN_PROGRESS session (inactive > 8 hours)
    if (s.state === 'IN_PROGRESS' && ageHours > 8) {
      log(`[Session ${s.id}] STALLED IN_PROGRESS (Inactive for ${ageHours.toFixed(1)}h: '${title}'). Reclaiming slot...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, { method: 'DELETE' });
        closedCount++;
      } catch (err) {}
      requeueTaskBySessionId(s.id, title);
      continue;
    }

    // Condition D: Handle AWAITING_USER_FEEDBACK / AWAITING_PLAN_APPROVAL / PAUSED
    if (s.state === 'AWAITING_USER_FEEDBACK' || s.state === 'AWAITING_PLAN_APPROVAL' || s.state === 'PAUSED' || s.state === 'WAITING_FOR_INPUT') {
      // Check if session has been stalled in waiting state with repeated unprogressed prompts
      let isStalled = false;
      try {
        const actRes = await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}/activities`, apiKey);
        const acts = actRes.activities || [];
        const userCount = acts.filter(a => a.originator === 'user').length;
        if (userCount >= 4 && ageHours > 2) {
          isStalled = true;
        }
      } catch (e) {}

      if (isStalled) {
        log(`[Session ${s.id}] STALLED FEEDBACK: Session unresponsive after multiple unblock messages. Reclaiming slot...`);
        try {
          await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, { method: 'DELETE' });
          closedCount++;
        } catch (err) {}
        requeueTaskBySessionId(s.id, title);
        continue;
      }

      log(`[Session ${s.id}] ${s.state} ('${title}'). Activating Cognitive Pipeline...`);
      try {
        const result = await processSessionCognitively(s.id, apiKey);
        if (result.success) {
          unblockedCount++;
          log(`[Session ${s.id}] UNBLOCKED via Cognitive Strategy: [${result.intent} -> ${result.strategy}]`);
        } else {
          log(`[Session ${s.id}] Cognitive unblock response status: ${result.status}`);
          // Fallback to direct architectural approval
          if (s.state === 'AWAITING_PLAN_APPROVAL') {
            await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}:approvePlan`, apiKey, {
              method: 'POST',
              body: JSON.stringify({})
            }).catch(() => {});
          }
          await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}:sendMessage`, apiKey, {
            method: 'POST',
            body: JSON.stringify({ prompt: approvalPrompt })
          }).catch(() => {});
          unblockedCount++;
        }
        activeCount++;
      } catch (err) {
        log(`Failed to unblock session ${s.id}: ${err.message}`);
        activeCount++;
      }
      continue;
    }

    // Normal active session
    if (s.state === 'IN_PROGRESS' || s.state === 'QUEUED' || s.state === 'PLANNING') {
      activeCount++;
    }
  }

  log(`Audit complete: ${unblockedCount} unblocked, ${closedCount} sessions closed, ${activeCount} active sessions.`);
  return { activeCount, unblockedCount, closedCount };
}

// -----------------------------------------------------------------------------
// Step 3: Concurrency Pool Enforcement & High-Impact Replenishment
// -----------------------------------------------------------------------------
const HIGH_IMPACT_CATALOG = [
  // Security
  {
    category: 'Security',
    title: 'Sentinel: AuthScreen JWT Refresh & Expiry Tests',
    prompt: '# 🛡️ Sentinel Security Task: AuthScreen JWT Refresh & Expiry\n\n**File:** `frontend/src/components/AuthScreen.test.tsx`\n**Issue:** Add unit tests validating JWT refresh token rotation and rejection of expired authentication credentials.\n\n**Objective:**\n1. Create `frontend/src/components/AuthScreen.test.tsx` using Vitest / Testing Library.\n2. Verify expired token redirects to login prompt.\n3. Verify valid credentials store access tokens in secure session storage.\n4. Ensure zero new regressions on existing tests and submit PR immediately upon verification.'
  },
  {
    category: 'Security',
    title: 'Sentinel: Prevent SQL & Query Injection in Dexie Full-Text Search',
    prompt: '# 🛡️ Sentinel Security Task: Prevent Query Injection in Dexie Search\n\n**File:** `frontend/src/lib/standaloneEngine.test.ts`\n**Issue:** Ensure clinical full-text search sanitizes regex metacharacters and prevents ReDoS or Dexie query injection.\n\n**Objective:**\n1. Update `frontend/src/lib/standaloneEngine.test.ts` with adversarial query inputs (e.g. `.*`, `[a-z]+(a+)+$`, quotes, SQL fragments).\n2. Verify search returns safely without freezing or crashing the worker.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Security',
    title: 'Sentinel: Strict Tenant Isolation on Preference Card Mutations',
    prompt: '# 🛡️ Sentinel Security Task: Preference Card Tenant Isolation\n\n**File:** `backend/tests/test_preference_card_tenant_isolation.py`\n**Issue:** Verify that preference card updates cannot leak or overwrite cards across `facility_id::dept_id` boundaries.\n\n**Objective:**\n1. Create `backend/tests/test_preference_card_tenant_isolation.py`.\n2. Attempt cross-tenant preference card update and verify HTTP 403 / 404 response.\n3. Verify multi-tenant database isolation invariant.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Security',
    title: 'Sentinel: Enforce Content-Security-Policy & Media Frame Protection',
    prompt: '# 🛡️ Sentinel Security Task: CSP and Camera Media Protection\n\n**File:** `backend/tests/test_csp_media_policy.py`\n**Issue:** Verify backend security headers restrict camera, microphone, and WebRTC origins to authorized hostnames.\n\n**Objective:**\n1. Create `backend/tests/test_csp_media_policy.py`.\n2. Test that response headers include Content-Security-Policy with strict media-src and frame-ancestors.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Security',
    title: 'Sentinel: User Profile Modal Role Switching Audit Tests',
    prompt: '# 🛡️ Sentinel Security Task: UserProfileModal Role Switching\n\n**File:** `frontend/src/components/UserProfileModal.test.tsx`\n**Issue:** Test clinical role switching in UserProfileModal to ensure unauthenticated privilege escalation is blocked.\n\n**Objective:**\n1. Create `frontend/src/components/UserProfileModal.test.tsx`.\n2. Verify role switching dispatches audit events and persists only authorized permissions.\n3. Submit PR immediately upon verification.'
  },

  // Performance
  {
    category: 'Performance',
    title: 'Bolt: ClinicalGraph Traversal Performance & Cycle Benchmarks',
    prompt: '# ⚡ Bolt Performance Task: ClinicalGraph Traversal Benchmarks\n\n**File:** `frontend/src/lib/clinicalGraph.test.ts`\n**Issue:** Add performance benchmarks for graph pathfinding across 1,000+ items, rooms, and surgeons.\n\n**Objective:**\n1. Add benchmark tests in `frontend/src/lib/clinicalGraph.test.ts` verifying shortest-path queries resolve in < 5ms.\n2. Verify cycle detection handles malformed relation graphs without infinite loops.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Performance',
    title: 'Bolt: ClinicalQueryPlanner Heavy Multi-Clause Execution Benchmarks',
    prompt: '# ⚡ Bolt Performance Task: ClinicalQueryPlanner Multi-Clause Benchmarks\n\n**File:** `frontend/src/lib/clinicalQueryPlanner.test.ts`\n**Issue:** Verify ClinicalQueryPlanner resolves complex multi-clause compound queries within 10ms.\n\n**Objective:**\n1. Create `frontend/src/lib/clinicalQueryPlanner.test.ts`.\n2. Benchmark 5-clause compound sentences (e.g. "Find laparoscope in room 4, check mesh in cart 2, and page scrub nurse").\n3. Verify parser execution time remains under 10ms with zero memory leaks.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Performance',
    title: 'Bolt: LiveKit WebRTC Audio Visualizer Canvas Memory Leak Tests',
    prompt: '# ⚡ Bolt Performance Task: Audio Visualizer Canvas Cleanup\n\n**File:** `frontend/src/lib/livekitClient.test.ts`\n**Issue:** Ensure WebRTC audio visualizer canvas context and event listeners are properly disposed on unmount.\n\n**Objective:**\n1. Create unit tests in `frontend/src/lib/livekitClient.test.ts` validating audio track disconnect and canvas requestAnimationFrame cleanup.\n2. Ensure zero lingering intervals or listeners.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Performance',
    title: 'Bolt: Dexie Bulk Seed Hydration Batch Optimization Benchmarks',
    prompt: '# ⚡ Bolt Performance Task: Seed Hydration Batching Benchmarks\n\n**File:** `frontend/src/lib/seedHydrationBench.test.ts`\n**Issue:** Benchmark Dexie bulkPut vs sequential put for 5,000 inventory items.\n\n**Objective:**\n1. Create `frontend/src/lib/seedHydrationBench.test.ts`.\n2. Assert bulkPut batches items in chunks of 500 to keep IndexedDB lock duration under 50ms.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Performance',
    title: 'Bolt: Compress & Cache Surgical Ontology Synonym Resolution',
    prompt: '# ⚡ Bolt Performance Task: Surgical Ontology Cache\n\n**File:** `frontend/src/lib/surgicalOntology.test.ts`\n**Issue:** Optimize surgical synonym lookups by caching canonical gauge and instrument mappings.\n\n**Objective:**\n1. Create unit tests in `frontend/src/lib/surgicalOntology.test.ts` testing 10,000 rapid lookup iterations.\n2. Verify cache hit rate > 95% on repetitive clinical terms.\n3. Submit PR immediately upon verification.'
  },

  // Code Health
  {
    category: 'Code Health',
    title: 'Code Health: CoordinateCard Component Rendering & A11y Tests',
    prompt: '# 🧹 Code Health Task: CoordinateCard Component Tests\n\n**File:** `frontend/src/components/CoordinateCard.test.tsx`\n**Issue:** Add component unit tests for CoordinateCard verifying Room, Cart, Shelf, Bin badge rendering and accessibility.\n\n**Objective:**\n1. Create `frontend/src/components/CoordinateCard.test.tsx`.\n2. Test rendering with full coordinates and partial coordinates.\n3. Verify accessible aria labels on coordinate indicators.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: QRPairModal Device Pairing Flow Unit Tests',
    prompt: '# 🧹 Code Health Task: QRPairModal Unit Tests\n\n**File:** `frontend/src/components/QRPairModal.test.tsx`\n**Issue:** Add unit tests for QRPairModal verifying QR rendering, pairing secret generation, and expiration timer.\n\n**Objective:**\n1. Create `frontend/src/components/QRPairModal.test.tsx`.\n2. Verify modal opens, displays pairing code, and handles dismiss actions.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: ResourceManagerModal Package Import & Export Tests',
    prompt: '# 🧹 Code Health Task: ResourceManagerModal Package Tests\n\n**File:** `frontend/src/components/ResourceManagerModal.test.tsx`\n**Issue:** Test clinical resource pack import, export, and checksum verification in ResourceManagerModal.\n\n**Objective:**\n1. Create `frontend/src/components/ResourceManagerModal.test.tsx`.\n2. Test uploading valid and invalid JSON resource packs.\n3. Ensure proper error banners display on malformed schemas.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: Lexicon Learning Feedback Loop Type Narrowing',
    prompt: '# 🧹 Code Health Task: Lexicon Learning Type Narrowing\n\n**File:** `frontend/src/lib/lexiconLearning.test.ts`\n**Issue:** Ensure adaptive feedback loop in lexiconLearning enforces strict TypeScript narrowing on clinician corrections.\n\n**Objective:**\n1. Create `frontend/src/lib/lexiconLearning.test.ts`.\n2. Test recording phonetic corrections and verify storage format.\n3. Assert zero null pointer errors on unseeded terms.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: Speech Synthesis Queue & Audio Context State Tests',
    prompt: '# 🧹 Code Health Task: Speech Synthesis Queue Tests\n\n**File:** `frontend/src/lib/speechSynthesis.test.ts`\n**Issue:** Add unit tests for speech synthesis voice queue, interruption handling, and mute persistence.\n\n**Objective:**\n1. Create `frontend/src/lib/speechSynthesis.test.ts`.\n2. Test queue prioritization of urgent clinical alerts over regular queries.\n3. Verify mute state prevents utterance execution.\n4. Submit PR immediately upon verification.'
  },

  // Testing
  {
    category: 'Testing',
    title: 'Testing: ChatCanvas Multi-Item Clinical Display Component Tests',
    prompt: '# 🧪 Testing Task: ChatCanvas Multi-Item Display Tests\n\n**File:** `frontend/src/components/ChatCanvas.test.tsx`\n**Issue:** Add unit tests for ChatCanvas verifying rendering of message bubbles, preference card carousels, and action buttons.\n\n**Objective:**\n1. Create `frontend/src/components/ChatCanvas.test.tsx`.\n2. Test empty state, user message, agent clinical response, and structured card list rendering.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Backend Clinical Graph Service Relationship Query Tests',
    prompt: '# 🧪 Testing Task: Clinical Graph Service Tests\n\n**File:** `backend/tests/test_clinical_graph_service.py`\n**Issue:** Add unit tests for `backend/app/services/clinical_graph.py` verifying multi-tenant relationship queries.\n\n**Objective:**\n1. Create `backend/tests/test_clinical_graph_service.py`.\n2. Test node addition, edge connections, and BFS path queries.\n3. Verify isolation between different facility graphs.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Clinical Query Planner Ambiguous Gauge & Size Resolution',
    prompt: '# 🧪 Testing Task: Clinical Query Planner Gauge Resolution\n\n**File:** `backend/tests/test_planner_gauge_resolution.py`\n**Issue:** Test clinical query planner disambiguation between needle gauge (e.g. 22G), suture size (e.g. 2-0, 3-0), and catheter Fr.\n\n**Objective:**\n1. Create `backend/tests/test_planner_gauge_resolution.py`.\n2. Test queries like "22 gauge spinal needle vs 2-0 prolene vs 16 Fr foley".\n3. Verify extraction maps correctly to item attributes.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Offline Outbox Replay Idempotency After Network Drop',
    prompt: '# 🧪 Testing Task: Offline Outbox Replay Idempotency\n\n**File:** `frontend/src/lib/outboxReplay.test.ts`\n**Issue:** Ensure offline outbox actions (e.g. move item, mark verified) are idempotent when replayed multiple times.\n\n**Objective:**\n1. Create `frontend/src/lib/outboxReplay.test.ts`.\n2. Simulate duplicate mutation replay and assert final state matches single application.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Hospital Manifest Validation & Department Hierarchy Tests',
    prompt: '# 🧪 Testing Task: Hospital Manifest Validation\n\n**File:** `backend/tests/test_manifest_validation.py`\n**Issue:** Test hospital manifest.json parsing and department schema integrity.\n\n**Objective:**\n1. Create `backend/tests/test_manifest_validation.py`.\n2. Verify loading all configured hospitals (County General, Memorial, etc.) without missing key errors.\n3. Submit PR immediately upon verification.'
  },

  // Additional Security
  {
    category: 'Security',
    title: 'Sentinel: Rate Limiter Middleware and IP Throttling Tests',
    prompt: '# 🛡️ Sentinel Security Task: Rate Limiter Middleware\n\n**File:** `backend/tests/test_rate_limiter_service.py`\n**Issue:** Verify rate limiting middleware on `/api/chat` and `/api/voice/token` returns HTTP 429 when thresholds are exceeded.\n\n**Objective:**\n1. Create `backend/tests/test_rate_limiter_service.py`.\n2. Simulate rapid consecutive requests exceeding limits and assert HTTP 429 Too Many Requests response.\n3. Verify Retry-After header presence.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Security',
    title: 'Sentinel: OTA Package Cryptographic Checksum Verification Tests',
    prompt: '# 🛡️ Sentinel Security Task: OTA Cryptographic Verification\n\n**File:** `backend/tests/test_ota_crypto_verification.py`\n**Issue:** Verify that over-the-air package installation verifies SHA-256 checksums and rejects corrupted payloads.\n\n**Objective:**\n1. Create `backend/tests/test_ota_crypto_verification.py`.\n2. Test OTA bundle verification with valid checksum and mismatched hash.\n3. Assert invalid packages are immediately rejected without touching filesystem.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Security',
    title: 'Sentinel: Strict Tenant Boundary Isolation on Inventory CSV Import',
    prompt: '# 🛡️ Sentinel Security Task: Inventory CSV Tenant Boundary\n\n**File:** `backend/tests/test_inventory_tenant_boundary.py`\n**Issue:** Ensure CSV inventory imports cannot overwrite or inject records into other hospital facility tenants.\n\n**Objective:**\n1. Create `backend/tests/test_inventory_tenant_boundary.py`.\n2. Test importing CSV records with cross-facility IDs and assert rejection.\n3. Verify tenant isolation invariant is preserved.\n4. Submit PR immediately upon verification.'
  },

  // Additional Performance
  {
    category: 'Performance',
    title: 'Bolt: Dexie Compound Index Query Latency Benchmarks',
    prompt: '# ⚡ Bolt Performance Task: Dexie Compound Index Latency\n\n**File:** `frontend/src/lib/dexieIndexBench.test.ts`\n**Issue:** Benchmark compound queries on IndexedDB [facility_id+dept_id] ensuring queries complete in < 2ms.\n\n**Objective:**\n1. Create `frontend/src/lib/dexieIndexBench.test.ts`.\n2. Benchmark 2,000 indexed queries against Dexie database.\n3. Assert average lookup latency remains under 2ms.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Performance',
    title: 'Bolt: Offline Delta Sync Payload Compression Benchmarks',
    prompt: '# ⚡ Bolt Performance Task: Delta Sync Payload Sizing\n\n**File:** `frontend/src/lib/deltaSyncPayload.test.ts`\n**Issue:** Benchmark offline delta sync payload compression and compact representation for low-bandwidth OR networks.\n\n**Objective:**\n1. Create `frontend/src/lib/deltaSyncPayload.test.ts`.\n2. Verify compact JSON serializes 50 offline mutations into < 10KB.\n3. Verify deserialization restores 100% of mutation records.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Performance',
    title: 'Bolt: Client-Side PHI Scrubber High-Throughput Benchmarks',
    prompt: '# ⚡ Bolt Performance Task: PHI Scrubber High-Throughput Benchmark\n\n**File:** `frontend/src/lib/scrubBenchmark.test.ts`\n**Issue:** Benchmark client-side PHI scrubber across 10,000 words of clinical dictation.\n\n**Objective:**\n1. Create `frontend/src/lib/scrubBenchmark.test.ts`.\n2. Benchmark redaction of MRNs, clinician names, and dates of birth in < 15ms.\n3. Verify zero memory leaks across 500 benchmark iterations.\n4. Submit PR immediately upon verification.'
  },

  // Additional Code Health & A11y
  {
    category: 'Code Health',
    title: 'Code Health: MoveVerifyWidget Drag and Drop Interaction Tests',
    prompt: '# 🧹 Code Health Task: MoveVerifyWidget Interaction Tests\n\n**File:** `frontend/src/components/MoveVerifyWidget.test.tsx`\n**Issue:** Add unit tests for MoveVerifyWidget verifying drag-and-drop state transitions, target drop zone validation, and item move confirmation.\n\n**Objective:**\n1. Create `frontend/src/components/MoveVerifyWidget.test.tsx`.\n2. Test drag start, hover over valid target shelf, drop event, and cancel action.\n3. Verify ARIA attributes on draggable items.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: Sidebar Responsive Navigation and Collapse Tests',
    prompt: '# 🧹 Code Health Task: Sidebar Navigation Tests\n\n**File:** `frontend/src/components/Sidebar.test.tsx`\n**Issue:** Add unit tests for Sidebar component verifying drawer collapse, active link highlighting, and keyboard focus.\n\n**Objective:**\n1. Create `frontend/src/components/Sidebar.test.tsx`.\n2. Test expanding/collapsing sidebar and active route state.\n3. Verify accessible role="navigation" and aria-expanded attributes.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: FeedbackModal Submission & Telemetry Tests',
    prompt: '# 🧹 Code Health Task: FeedbackModal Submission Tests\n\n**File:** `frontend/src/components/FeedbackModal.test.tsx`\n**Issue:** Add unit tests for FeedbackModal verifying star rating selection, comment limits, and offline queueing.\n\n**Objective:**\n1. Create `frontend/src/components/FeedbackModal.test.tsx`.\n2. Test submitting feedback with and without network connectivity.\n3. Verify error and success banners render properly.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: QuestionsDrawer Filter & Search Tests',
    prompt: '# 🧹 Code Health Task: QuestionsDrawer Filter Tests\n\n**File:** `frontend/src/components/QuestionsDrawer.test.tsx`\n**Issue:** Add unit tests for QuestionsDrawer verifying unanswered question filtering and surgeon tag matching.\n\n**Objective:**\n1. Create `frontend/src/components/QuestionsDrawer.test.tsx`.\n2. Test filtering by department, search term input, and empty state display.\n3. Verify keyboard accessibility.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: Modal Dialog Keyboard Focus Trapping & ESC Tests',
    prompt: '# 🧹 Code Health Task: Modal Keyboard Focus Trapping\n\n**File:** `frontend/src/components/ModalA11yFocus.test.tsx`\n**Issue:** Ensure clinical dialog modals trap keyboard focus within modal boundaries and dismiss on Escape key press.\n\n**Objective:**\n1. Create `frontend/src/components/ModalA11yFocus.test.tsx`.\n2. Test Tab cycle stays within modal and Shift+Tab wraps to last focusable element.\n3. Test pressing Escape closes modal.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: Gamification Mastery Engine Progression Tests',
    prompt: '# 🧹 Code Health Task: Gamification Mastery Progression\n\n**File:** `frontend/src/lib/gamification.test.ts`\n**Issue:** Test clinical mastery gamification engine for XP calculation, level-up triggers, and streak tracking.\n\n**Objective:**\n1. Create `frontend/src/lib/gamification.test.ts`.\n2. Test awarding points on item verification, streak increments, and badge achievements.\n3. Verify serialization to Dexie storage.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: FeedbackEngine Offline Queue & Sentiment Tests',
    prompt: '# 🧹 Code Health Task: FeedbackEngine Offline Queue\n\n**File:** `frontend/src/lib/feedbackEngine.test.ts`\n**Issue:** Test FeedbackEngine offline queueing, retry with exponential backoff, and sentiment scoring.\n\n**Objective:**\n1. Create `frontend/src/lib/feedbackEngine.test.ts`.\n2. Test enqueueing feedback while offline, persisting to storage, and draining queue on reconnect.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Code Health',
    title: 'Code Health: VeoMotion Animation Transitions and Fallback Tests',
    prompt: '# 🧹 Code Health Task: VeoMotion Animation Fallbacks\n\n**File:** `frontend/src/lib/veoMotion.test.ts`\n**Issue:** Add unit tests verifying VeoMotion graceful degradation when prefers-reduced-motion is enabled.\n\n**Objective:**\n1. Create `frontend/src/lib/veoMotion.test.ts`.\n2. Test reduced motion media query detection and fallback instant transitions.\n3. Submit PR immediately upon verification.'
  },

  // Additional Testing & Services
  {
    category: 'Testing',
    title: 'Testing: Governance Service Policy Enforcement Tests',
    prompt: '# 🧪 Testing Task: Governance Service Policy Enforcement\n\n**File:** `backend/tests/test_governance_service.py`\n**Issue:** Add unit tests for `backend/app/services/governance.py` verifying clinical policy verification and audit trails.\n\n**Objective:**\n1. Create `backend/tests/test_governance_service.py`.\n2. Test policy enforcement on critical surgeon preference updates and inventory adjustments.\n3. Assert audit records are created with timestamp and facility ID.\n4. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Peer QnA Service Message Routing & Persistence Tests',
    prompt: '# 🧪 Testing Task: Peer QnA Service Message Routing\n\n**File:** `backend/tests/test_peer_qna_service.py`\n**Issue:** Add unit tests for `backend/app/peer_qna.py` testing question broadcast, answer threading, and tenant scoping.\n\n**Objective:**\n1. Create `backend/tests/test_peer_qna_service.py`.\n2. Test posting a question, adding an answer, and asserting isolation across departments.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Cloudflare Tunnel Service Status & Health Tests',
    prompt: '# 🧪 Testing Task: Cloudflare Tunnel Service Resilience\n\n**File:** `backend/tests/test_tunnel_service.py`\n**Issue:** Add unit tests for `backend/app/services/tunnel.py` testing tunnel healthcheck, retry, and URL retrieval.\n\n**Objective:**\n1. Create `backend/tests/test_tunnel_service.py`.\n2. Test tunnel URL extraction and graceful fallback when tunnel daemon is unavailable.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: RAG Fallback Service Cache & Scoring Tests',
    prompt: '# 🧪 Testing Task: RAG Fallback Service Cache\n\n**File:** `backend/tests/test_rag_fallback_service.py`\n**Issue:** Add unit tests for `backend/app/services/rag_fallback.py` testing semantic cache hits and relevance scoring.\n\n**Objective:**\n1. Create `backend/tests/test_rag_fallback_service.py`.\n2. Test query caching, similarity threshold checks, and empty fallback handling.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Clinical Inventory Parity Tests for pacu_periop',
    prompt: '# 🧪 Testing Task: Inventory Parity for pacu_periop\n\n**File:** `backend/tests/test_parity_pacu_periop.py`\n**Issue:** Validate CSV inventory structure and preference card mappings for tenant `pacu_periop`.\n\n**Objective:**\n1. Create `backend/tests/test_parity_pacu_periop.py`.\n2. Assert all items referenced in preference cards exist in `hospitals/pacu_periop/inventory.csv`.\n3. Submit PR immediately upon verification.'
  },
  {
    category: 'Testing',
    title: 'Testing: Clinical Inventory Parity Tests for sacred_heart',
    prompt: '# 🧪 Testing Task: Inventory Parity for sacred_heart\n\n**File:** `backend/tests/test_parity_sacred_heart.py`\n**Issue:** Validate CSV inventory structure and preference card mappings for tenant `sacred_heart`.\n\n**Objective:**\n1. Create `backend/tests/test_parity_sacred_heart.py`.\n2. Assert all items referenced in preference cards exist in `hospitals/sacred_heart/inventory.csv`.\n3. Submit PR immediately upon verification.'
  }
];

function ensureBacklogCapacity(backlog, needed) {
  const pendingCount = backlog.filter(t => t.status !== 'dispatched').length;
  if (pendingCount >= needed + 5) {
    return backlog;
  }

  log(`Backlog capacity low (${pendingCount} pending, needed: ${needed}). Stocking high-impact catalog tasks...`);
  const existingTitles = new Set(backlog.map(t => t.title.toLowerCase().trim()));

  let nextId = backlog.length + 1;
  for (const catTask of HIGH_IMPACT_CATALOG) {
    if (!existingTitles.has(catTask.title.toLowerCase().trim())) {
      const paddedId = String(nextId++).padStart(3, '0');
      backlog.push({
        id: `backlog-${paddedId}`,
        title: catTask.title,
        category: catTask.category,
        status: 'pending',
        prompt: catTask.prompt
      });
      existingTitles.add(catTask.title.toLowerCase().trim());
    }
  }

  // Infinite synthesizer: dynamically generate specialized tasks if still below needed + 5
  if (backlog.filter(t => t.status !== 'dispatched').length < needed + 5) {
    const modules = [
      { name: 'DirectGemini', path: 'frontend/src/lib/directGemini.test.ts', cat: 'Testing' },
      { name: 'SemanticParser', path: 'frontend/src/lib/semanticParser.test.ts', cat: 'Bolt' },
      { name: 'AppSettings', path: 'frontend/src/lib/appSettings.test.ts', cat: 'Code Health' },
      { name: 'HospitalMapping', path: 'frontend/src/lib/hospitalMapping.test.ts', cat: 'Testing' },
      { name: 'CoordinateParser', path: 'frontend/src/lib/coordinateParser.test.ts', cat: 'Bolt' },
      { name: 'MoveDebouncer', path: 'frontend/src/lib/moveDebouncer.test.ts', cat: 'Bolt' },
      { name: 'OfflineDb', path: 'frontend/src/lib/offlineDbBench.test.ts', cat: 'Performance' },
      { name: 'DeltaSync', path: 'frontend/src/lib/deltaSync.test.ts', cat: 'Testing' },
      { name: 'AuthTokenRotation', path: 'backend/tests/test_auth_token_rotation.py', cat: 'Sentinel' },
      { name: 'FeedbackPipeline', path: 'backend/tests/test_feedback_pipeline.py', cat: 'Testing' },
      { name: 'IntentParser', path: 'backend/tests/test_intent_parser.py', cat: 'Testing' },
      { name: 'InventorySearch', path: 'backend/tests/test_inventory_search.py', cat: 'Bolt' },
      { name: 'LexiconLearningService', path: 'backend/tests/test_lexicon_service.py', cat: 'Code Health' },
      { name: 'VoiceWorker', path: 'backend/tests/test_voice_worker.py', cat: 'Testing' },
      { name: 'PushToTalkHook', path: 'frontend/src/hooks/usePushToTalk.test.ts', cat: 'Testing' },
      { name: 'WakeLockHook', path: 'frontend/src/hooks/useWakeLock.test.ts', cat: 'Code Health' },
      { name: 'UserProfileHook', path: 'frontend/src/hooks/useUserProfile.test.ts', cat: 'Testing' },
      { name: 'AutoUpdateModal', path: 'frontend/src/components/AutoUpdateModal.test.tsx', cat: 'Code Health' },
      { name: 'OmnibarSearch', path: 'frontend/src/components/Omnibar.test.tsx', cat: 'Bolt' },
      { name: 'PeerQnAPanel', path: 'frontend/src/components/PeerQnAPanel.test.tsx', cat: 'Testing' },
      { name: 'SyncEngineOutbox', path: 'frontend/src/lib/syncEngine.test.ts', cat: 'Performance' },
      { name: 'ResourceManagerChecksum', path: 'frontend/src/lib/resourceManager.test.ts', cat: 'Sentinel' },
      { name: 'ClinicalQueryPlannerService', path: 'backend/tests/test_clinical_query_planner.py', cat: 'Bolt' },
      { name: 'SurgicalOntologyService', path: 'backend/tests/test_surgical_ontology.py', cat: 'Bolt' },
      { name: 'ScrubberService', path: 'backend/tests/test_scrubber_service.py', cat: 'Sentinel' },
      { name: 'ChatRouterMultiTenant', path: 'backend/tests/test_chat_router.py', cat: 'Sentinel' },
      { name: 'VoiceRouterLiveKit', path: 'backend/tests/test_voice_router.py', cat: 'Testing' },
      { name: 'LimiterConcurrencyThrottling', path: 'backend/tests/test_limiter_concurrency.py', cat: 'Sentinel' }
    ];

    const phases = [
      { tag: 'Phase 1', suffix: 'Rigorous Unit & Regression Tests', desc: 'unit tests verifying core logic and contract invariants' },
      { tag: 'Phase 2', suffix: 'Invariant, Fuzzing & Boundary Hardening', desc: 'fuzzing, boundary inputs, malformed payload resilience, and strict schema validation' },
      { tag: 'Phase 3', suffix: 'High-Concurrency & Stress Benchmarks', desc: 'concurrent burst execution, race condition resistance, and latency benchmarks' },
      { tag: 'Phase 4', suffix: 'Offline Partition & Multi-Tenant Isolation Verification', desc: 'multi-tenant boundary enforcement (facility_id::dept_id) and offline mutation replay idempotency' }
    ];

    for (const phase of phases) {
      if (backlog.filter(t => t.status !== 'dispatched').length >= needed + 5) break;

      for (const m of modules) {
        if (backlog.filter(t => t.status !== 'dispatched').length >= needed + 5) break;

        const title = `${m.cat}: ${phase.suffix} for ${m.name}`;
        if (!existingTitles.has(title.toLowerCase().trim())) {
          const paddedId = String(nextId++).padStart(3, '0');
          backlog.push({
            id: `backlog-${paddedId}`,
            title: title,
            category: m.cat === 'Sentinel' ? 'Security' : m.cat === 'Bolt' ? 'Performance' : m.cat,
            status: 'pending',
            prompt: `# 🚀 ${m.cat} Task (${phase.tag}): ${phase.suffix} for ${m.name}\n\n**File:** \`${m.path}\`\n**Objective:**\n1. Create or extend ${phase.desc} in \`${m.path}\`.\n2. Ensure zero regressions on existing test suites.\n3. Enforce multi-tenant isolation and offline-first invariants.\n4. Submit PR immediately upon verification.`
          });
          existingTitles.add(title.toLowerCase().trim());
        }
      }
    }
  }

  return backlog;
}

async function replenishPool(apiKey, currentActive) {
  log(`--- Step 3: Checking concurrency pool (Current: ${currentActive} / Target: ${TARGET_CONCURRENCY}) ---`);
  const needed = TARGET_CONCURRENCY - currentActive;
  if (needed <= 0) {
    log(`Concurrency pool is full (${currentActive}/${TARGET_CONCURRENCY}). No replenishment needed.`);
    return 0;
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

  backlog = ensureBacklogCapacity(backlog, needed);

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
      if (err.message.includes('FAILED_PRECONDITION') || err.message.includes('429') || err.message.includes('Quota')) {
        log(`Jules API dispatch capacity or daily task quota reached. Halting replenishment for this cycle.`);
        break;
      }
    }
  }

  fs.writeFileSync(BACKLOG_PATH, JSON.stringify(backlog, null, 2), 'utf8');
  log(`Replenished ${launched} task(s). Total active pool is now ${currentActive + launched} / ${TARGET_CONCURRENCY}.`);
  return launched;
}

// -----------------------------------------------------------------------------
// Main Orchestration Entry Point
// -----------------------------------------------------------------------------
async function run() {
  log('========================================================================');
  log('   30-MINUTE AUTONOMOUS JULES FLEET ORCHESTRATOR & LOCAL SYNC DAEMON    ');
  log('========================================================================');

  const startTime = Date.now();
  let prResults = { evaluated: 0, merged: 0, syncStatus: 'SKIPPED' };
  let auditResults = { activeCount: 0, unblockedCount: 0, closedCount: 0 };
  let launchedCount = 0;

  try {
    const apiKey = getApiKey();

    // Step 1: Check PRs & Sync Local Git
    prResults = await checkAndMergePRs(apiKey);

    // Step 2: Audit & Unblock Sessions
    auditResults = await auditAndUnblockSessions(apiKey);

    // Step 3: Enforce Target Concurrency Pool
    launchedCount = await replenishPool(apiKey, auditResults.activeCount);

    const finalPool = auditResults.activeCount + launchedCount;

    // Step 4: Structured Telemetry Logging
    logTelemetry({
      intervalMinutes: 30,
      targetConcurrency: TARGET_CONCURRENCY,
      activePool: `${finalPool}/${TARGET_CONCURRENCY}`,
      sessionsAudited: auditResults.activeCount,
      sessionsUnblocked: auditResults.unblockedCount,
      sessionsClosed: auditResults.closedCount,
      prsEvaluated: prResults.evaluated,
      prsMerged: prResults.merged,
      tasksDispatched: launchedCount,
      localSyncStatus: prResults.syncStatus,
      durationMs: Date.now() - startTime
    });

    log(`30-minute run finished successfully in ${((Date.now() - startTime) / 1000).toFixed(2)}s.`);
  } catch (err) {
    log(`ORCHESTRATOR FATAL ERROR: ${err.stack || err.message}`);
    logTelemetry({
      status: 'FATAL_ERROR',
      error: err.message,
      durationMs: Date.now() - startTime
    });
  }
}

const args = process.argv.slice(2);
const isDaemon = args.includes('--daemon');
const intervalArgIndex = args.indexOf('--interval');
const intervalMinutes = intervalArgIndex !== -1 && args[intervalArgIndex + 1] 
  ? parseInt(args[intervalArgIndex + 1], 10) 
  : 30;

if (isDaemon) {
  log(`Starting Orchestrator in Autonomous Daemon mode (cadence: every ${intervalMinutes} minutes)...`);
  run().then(() => {
    setInterval(run, intervalMinutes * 60 * 1000);
  });
} else {
  run();
}
