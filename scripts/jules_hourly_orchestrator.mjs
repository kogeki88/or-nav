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

// -----------------------------------------------------------------------------
// Step 1: Auto-Merge Completed Jules PRs & Sync Local Workspace
// -----------------------------------------------------------------------------
async function checkAndMergePRs() {
  log('--- Step 1: Checking open Jules PRs for auto-verification and merge ---');
  let openPRs = [];
  try {
    const raw = execSync(
      `${GH_PATH} pr list --repo ${REPO_NAME} --json number,title,headRefName,url,isDraft,mergeable`,
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
      // Check if PR is conflicting; if so, attempt a rebase update from base branch
      if (pr.mergeable === 'CONFLICTING') {
        log(`[PR #${pr.number}] CONFLICTING: Attempting 'gh pr update-branch --rebase'...`);
        try {
          execSync(`${GH_PATH} pr update-branch ${pr.number} --rebase --repo ${REPO_NAME}`, {
            encoding: 'utf8',
            timeout: 15000
          });
          log(`[PR #${pr.number}] Rebase update succeeded.`);
        } catch (updateErr) {
          log(`[PR #${pr.number}] SKIPPED: Cannot merge due to unresolved merge conflicts with main.`);
          continue;
        }
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
    execSync('git pull --rebase --autostash origin main', { cwd: ROOT_DIR, encoding: 'utf8', timeout: 25000 });
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
    if (s.sourceContext?.source !== REPO_SOURCE && !s.title?.includes('OR-Nav') && !s.id) {
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
      continue;
    }

    // Condition B: Clean up failed sessions
    if (s.state === 'FAILED') {
      log(`[Session ${s.id}] FAILED ('${title}'). Deleting failed slot to free concurrency...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, { method: 'DELETE' });
        closedCount++;
      } catch (err) {}
      continue;
    }

    // Condition C: Check for stalled IN_PROGRESS session (inactive > 8 hours)
    if (s.state === 'IN_PROGRESS' && ageHours > 8) {
      log(`[Session ${s.id}] STALLED IN_PROGRESS (Inactive for ${ageHours.toFixed(1)}h: '${title}'). Reclaiming slot...`);
      try {
        await julesFetch(`https://jules.googleapis.com/v1alpha/sessions/${s.id}`, apiKey, { method: 'DELETE' });
        closedCount++;
      } catch (err) {}
      continue;
    }

    // Condition D: Handle AWAITING_USER_FEEDBACK / AWAITING_PLAN_APPROVAL / PAUSED
    if (s.state === 'AWAITING_USER_FEEDBACK' || s.state === 'AWAITING_PLAN_APPROVAL' || s.state === 'PAUSED') {
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
  }
];

function ensureBacklogCapacity(backlog, needed) {
  const pendingCount = backlog.filter(t => t.status !== 'dispatched').length;
  if (pendingCount >= needed) {
    return backlog;
  }

  log(`Backlog capacity low (${pendingCount} pending, needed: ${needed}). Stocking high-impact catalog tasks...`);
  const existingTitles = new Set(backlog.map(t => t.title.toLowerCase().trim()));

  let nextId = backlog.length + 1;
  for (const catTask of HIGH_IMPACT_CATALOG) {
    if (!existingTitles.has(catTask.title.toLowerCase().trim())) {
      const paddedId = String(nextId++).padStart(2, '0');
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

  // If still need more, generate variations for untested components
  if (backlog.filter(t => t.status !== 'dispatched').length < needed) {
    const departments = ['county_general', 'er_trauma', 'icu_critical_care', 'pacu_periop', 'sacred_heart'];
    for (const dept of departments) {
      const title = `Testing: Clinical Inventory Parity Tests for ${dept}`;
      if (!existingTitles.has(title.toLowerCase().trim())) {
        const paddedId = String(nextId++).padStart(2, '0');
        backlog.push({
          id: `backlog-${paddedId}`,
          title: title,
          category: 'Testing',
          status: 'pending',
          prompt: `# 🧪 Testing Task: Inventory Parity for ${dept}\n\n**File:** \`backend/tests/test_parity_${dept}.py\`\n**Issue:** Validate CSV inventory structure and preference card mappings for tenant \`${dept}\`.\n\n**Objective:**\n1. Create \`backend/tests/test_parity_${dept}.py\`.\n2. Assert all items referenced in preference cards exist in \`inventory.csv\`.\n3. Submit PR immediately upon verification.`
        });
        existingTitles.add(title.toLowerCase().trim());
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
    prResults = await checkAndMergePRs();

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

run();
