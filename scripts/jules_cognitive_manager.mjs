#!/usr/bin/env node
/**
 * Jules Cognitive Manager Orchestrator
 *
 * Implements the 4-Step Cognitive Pipeline:
 * Step 1: Read & Extract (Semantic ingestion of agent query)
 * Step 2: Context Evaluation (Cross-reference active state, files, invariants)
 * Step 3: Intent & Action Decision (Classify operational pathway & resolve choices)
 * Step 4: Targeted Execution (Deliver tailored, non-generic instructions)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(__dirname, '..');
const JULES_API_URL = 'https://jules.googleapis.com/v1alpha/sessions';
const REPO_NAME = 'kogeki88/or-nav';

export function getApiKey() {
  if (process.env.JULES_API_KEY) return process.env.JULES_API_KEY.trim();
  try {
    const key = execSync(
      'powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable(\'JULES_API_KEY\', \'User\')"',
      { encoding: 'utf8', timeout: 3000 }
    ).trim();
    if (key) return key;
  } catch {}
  throw new Error('JULES_API_KEY not found in environment or user registry.');
}

/**
 * Step 1: Read & Extract
 * Ingest the incoming session and its activities history from Jules API.
 */
export async function readAndExtractSession(sessionId, apiKey) {
  const headers = { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' };

  // 1. Fetch Session metadata
  const sessionRes = await fetch(`${JULES_API_URL}/${sessionId}`, { headers });
  if (!sessionRes.ok) {
    throw new Error(`Failed to fetch session ${sessionId}: HTTP ${sessionRes.status}`);
  }
  const session = await sessionRes.json();

  // 2. Fetch Session Activities (with pagination)
  let activities = [];
  try {
    let pageToken = '';
    let pages = 0;
    while (pages < 5) {
      const url = pageToken
        ? `${JULES_API_URL}/${sessionId}/activities?pageSize=100&pageToken=${encodeURIComponent(pageToken)}`
        : `${JULES_API_URL}/${sessionId}/activities?pageSize=100`;
      const actRes = await fetch(url, { headers });
      if (!actRes.ok) break;
      const actData = await actRes.json();
      if (actData.activities) {
        activities.push(...actData.activities);
      }
      if (!actData.nextPageToken) break;
      pageToken = actData.nextPageToken;
      pages++;
    }
  } catch (err) {
    console.warn(`[Jules Manager] Activities fetch warning: ${err.message}`);
  }

  // 3. Extract latest agent message / query
  let latestAgentQuery = null;
  let latestAgentActivity = null;
  for (let i = activities.length - 1; i >= 0; i--) {
    const act = activities[i];
    if (act.originator === 'agent' && act.agentMessaged?.agentMessage) {
      latestAgentQuery = act.agentMessaged.agentMessage.trim();
      latestAgentActivity = act;
      break;
    }
  }

  // Extract mentioned files or modules in query or title
  const textToScan = `${session.title || ''} ${latestAgentQuery || ''} ${session.prompt || ''}`;
  const fileMatches = textToScan.match(/[a-zA-Z0-9_\-\./]+\.(py|ts|tsx|js|mjs|json|css|md)\b/g) || [];
  const uniqueFiles = Array.from(new Set(fileMatches));

  return {
    sessionId,
    title: session.title || 'Untitled Session',
    state: session.state,
    prompt: session.prompt || '',
    latestAgentQuery,
    latestAgentActivity,
    mentionedFiles: uniqueFiles,
    activitiesCount: activities.length,
    rawSession: session
  };
}

/**
 * Step 2: Context Evaluation
 * Cross-references query against active workspace, files, and invariants.
 */
export function evaluateContext(extracted) {
  const { title, state, latestAgentQuery, mentionedFiles } = extracted;
  const q = (latestAgentQuery || '').toLowerCase();
  const t = (title || '').toLowerCase();

  // Inspect files on disk
  const inspectedFiles = [];
  for (const relPath of mentionedFiles) {
    const absPath = path.resolve(ROOT_DIR, relPath);
    const exists = fs.existsSync(absPath);
    let size = 0;
    if (exists) {
      try {
        size = fs.statSync(absPath).size;
      } catch {}
    }
    inspectedFiles.push({ path: relPath, exists, size });
  }

  // Detect pre-existing test failure questions vs scope discipline
  const asksAboutPreExistingTests =
    /pre-existing|already fail|failing tests?|failures? on `?main`?|independent of the changes|should i attempt to fix|should i:?\s*a\)|scope to fix/i.test(q);

  // Detect option choices (A vs B)
  const offersOptions = /should i:?\s*(option\s*)?a\)|or would you prefer|proceed with creating the pull request|shall i open the pr|do you want me to|open the pr/i.test(q);

  // Detect technical questions about code or imports
  const asksTechnicalCode =
    /how should i import|where is|undefined variable|syntax error|type error|cannot find module|interface/i.test(q);

  // Detect plan approval request
  const isPlanApproval =
    state === 'AWAITING_PLAN_APPROVAL' ||
    /approve\s*plan|plan\s*approval|here is my plan|proposed plan|here's what i plan to do/i.test(q);

  // Detect ambiguity
  const isAmbiguous =
    /unclear|conflicting|which file|which tenant|which department/i.test(q);

  // Detect inquiries about missing features or unrequested scope expansion
  const asksAboutMissingFeature =
    /should I add|can you advise|how should I|does not exist|doesn't explicitly exist|not present in|should I implement/i.test(q);

  return {
    ...extracted,
    inspectedFiles,
    asksAboutPreExistingTests,
    offersOptions,
    asksTechnicalCode,
    isPlanApproval,
    isAmbiguous,
    asksAboutMissingFeature,
    hasRecentQuery: !!latestAgentQuery
  };
}

/**
 * Step 3: Intent & Action Decision
 * Eliminates generic fallbacks. Determines the exact operational pathway.
 */
export function decideAction(evaluated) {
  const { title, latestAgentQuery, asksAboutPreExistingTests, asksAboutMissingFeature, offersOptions, asksTechnicalCode, isPlanApproval, isAmbiguous, inspectedFiles } = evaluated;
  const targetFile = inspectedFiles[0]?.path || 'the modified codebase files';

  // Branch 1: Pre-existing test failures on main vs PR scope
  if (asksAboutPreExistingTests || (offersOptions && /pre-existing|main/i.test(latestAgentQuery || ''))) {
    const decisionText =
      `Proceed with Option A: create the pull request for ${targetFile} now. ` +
      `Do not expand scope to fix unrelated pre-existing test failures that already fail on 'main'. ` +
      `OR-Nav invariant rule: As long as your changes introduce zero new regressions compared to the 'main' branch, ` +
      `keep the PR strictly scoped to this task's objective and submit the pull request immediately.`;

    return {
      intent: 'TEST_REGRESSION_VS_SCOPE_QUERY',
      strategy: 'ENFORCE_SCOPED_PR_ZERO_NEW_REGRESSIONS',
      responsePayload: decisionText,
      needsApprovePlan: evaluated.state === 'AWAITING_PLAN_APPROVAL'
    };
  }

  // Branch 1b: Missing feature or scope clarification
  if (asksAboutMissingFeature) {
    const decisionText =
      `Clarification for '${title}': Do not implement new unrequested UI mechanisms if not already present in ${targetFile}. ` +
      `Stick strictly to verifying the existing features, exports, and functions in ${targetFile}. ` +
      `Ensure unit tests pass with zero new regressions compared to 'main', and submit the pull request immediately.`;

    return {
      intent: 'FEATURE_SCOPE_CLARIFICATION',
      strategy: 'PRUNE_EXTRA_SCOPE_AND_SUBMIT',
      responsePayload: decisionText,
      needsApprovePlan: evaluated.state === 'AWAITING_PLAN_APPROVAL'
    };
  }

  // Branch 2: Technical code or state inquiry
  if (asksTechnicalCode) {
    let extraContext = '';
    if (inspectedFiles.length > 0 && inspectedFiles[0].exists) {
      extraContext = ` The target file '${targetFile}' is verified present on disk (${inspectedFiles[0].size} bytes).`;
    }
    const decisionText =
      `Confirmed.${extraContext} For '${title}': use scoped, local imports and preserve existing module contracts. ` +
      `Ensure multi-tenant isolation ('facility_id::dept_id') and offline-first Dexie parity are preserved. ` +
      `Run focused unit tests on '${targetFile}' and open the PR once verified.`;

    return {
      intent: 'CODE_OR_STATE_TECHNICAL_QUERY',
      strategy: 'INSPECTED_CODEBASE_TECHNICAL_GUIDANCE',
      responsePayload: decisionText,
      needsApprovePlan: evaluated.state === 'AWAITING_PLAN_APPROVAL'
    };
  }

  // Branch 3: Plan Approval
  if (isPlanApproval) {
    const decisionText =
      `Plan approved for '${title}'. Proceed with implementation across ${targetFile}. ` +
      `Invariants: (1) Zero regressions on existing suites, (2) Strict multi-tenant isolation, ` +
      `(3) Offline-first Dexie + FastAPI parity, (4) No APK binaries in assets. ` +
      `Execute implementation and submit the pull request immediately upon verification.`;

    return {
      intent: 'PLAN_APPROVAL_REQUEST',
      strategy: 'APPROVE_PLAN_AND_DISPATCH',
      responsePayload: decisionText,
      needsApprovePlan: true
    };
  }

  // Branch 4: Ambiguous data mismatch
  if (isAmbiguous) {
    const decisionText =
      `Clarification for '${title}': Follow default general_memorial_cvor tenant conventions with offline Dexie outbox synchronization. ` +
      `Keep changes minimal and isolated to ${targetFile}. Proceed with PR creation.`;

    return {
      intent: 'AMBIGUITY_RESOLUTION',
      strategy: 'TARGETED_DOMAIN_DEFAULT_ALIGNMENT',
      responsePayload: decisionText,
      needsApprovePlan: false
    };
  }

  // Branch 5: Default tailored progression (No generic filler!)
  const decisionText =
    `Review of '${title}' verified. Proceed with implementation for ${targetFile}. ` +
    `Ensure changes satisfy task verification requirements with zero new regressions compared to main. ` +
    `Finalize and submit the pull request.`;

  return {
    intent: 'PROGRESSION_DIRECTIVE',
    strategy: 'TAILORED_TASK_PROGRESSION',
    responsePayload: decisionText,
    needsApprovePlan: evaluated.state === 'AWAITING_PLAN_APPROVAL'
  };
}

/**
 * Step 4: Targeted Execution & Orchestration Logging
 */
export async function executeDecision(sessionId, evaluated, decision, apiKey) {
  const headers = { 'X-Goog-Api-Key': apiKey, 'Content-Type': 'application/json' };

  // Log Trace: Step 1 (Read Query)
  console.log(`[Jules Manager] Read Query -> Session: ${sessionId} ("${evaluated.title}")`);
  if (evaluated.latestAgentQuery) {
    console.log(`  Agent Query Excerpt: "${evaluated.latestAgentQuery.slice(0, 140).replace(/\n/g, ' ')}..."`);
  } else {
    console.log(`  Session State: ${evaluated.state} (No agent message, evaluating plan prompt)`);
  }

  // Log Trace: Step 2 (Evaluated Context)
  console.log(`[Jules Manager] Evaluated Context -> Mentioned Files: [${evaluated.mentionedFiles.join(', ') || 'none'}] | Invariants: [Zero New Regressions, Multi-Tenant] | Activities: ${evaluated.activitiesCount}`);

  // Log Trace: Step 3 (Decided Action)
  console.log(`[Jules Manager] Decided Action -> Intent: [${decision.intent}] | Strategy: [${decision.strategy}]`);

  // Step 4: Execute downstream requests
  let planApproved = false;
  if (decision.needsApprovePlan) {
    try {
      const pRes = await fetch(`${JULES_API_URL}/${sessionId}:approvePlan`, {
        method: 'POST',
        headers,
        body: JSON.stringify({})
      });
      planApproved = pRes.ok;
    } catch {}
  }

  // Send tailored context-aware response
  console.log(`[Jules Manager] Executing Response -> Payload: "${decision.responsePayload.slice(0, 120)}..."`);

  const msgRes = await fetch(`${JULES_API_URL}/${sessionId}:sendMessage`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ prompt: decision.responsePayload })
  });

  const success = msgRes.ok;
  console.log(`[Jules Manager] Execution Finished -> HTTP ${msgRes.status} ${success ? 'OK (Unblocked)' : 'FAILED'}`);

  return {
    success,
    status: msgRes.status,
    sessionId,
    intent: decision.intent,
    strategy: decision.strategy,
    planApproved,
    responsePayload: decision.responsePayload
  };
}

/**
 * End-to-end cognitive run for a single session
 */
export async function processSessionCognitively(sessionId, apiKey = getApiKey()) {
  const extracted = await readAndExtractSession(sessionId, apiKey);
  const evaluated = evaluateContext(extracted);
  const decision = decideAction(evaluated);
  return await executeDecision(sessionId, evaluated, decision, apiKey);
}

// CLI Direct Execution Support
if (process.argv[1] && process.argv[1].endsWith('jules_cognitive_manager.mjs')) {
  const targetId = process.argv[2] || '18189642773123328552';
  console.log('========================================================================');
  console.log(`     RUNNING COGNITIVE JULES ORCHESTRATOR FOR SESSION: ${targetId}     `);
  console.log('========================================================================');
  processSessionCognitively(targetId)
    .then((res) => {
      console.log('Cognitive orchestration completed successfully:', res.intent);
      process.exit(0);
    })
    .catch((err) => {
      console.error('Cognitive orchestrator error:', err);
      process.exit(1);
    });
}
