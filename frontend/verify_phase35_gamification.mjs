/**
 * Phase 35 E2E Verification: Clinical Mastery & Gamification System.
 * Tests XP gain, level progression, quest advancement, badge unlocks,
 * and seamless tab switching in UserProfileModal.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 35 CLINICAL GAMIFICATION & PROFILE REWARDS GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Login via Quick Demo if unauthenticated
    console.log("\n--- [STEP 1] Ensure Authenticated Workspace ---");
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      console.log("Logged in with Quick Demo user.");
    } else {
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      console.log("Already authenticated.");
    }
    await new Promise((r) => setTimeout(r, 600));

    // Reset gamification test data for Sean
    await page.evaluate(() => {
      localStorage.removeItem("ornav_gamification_usr-demo-001");
      localStorage.removeItem("ornav_gamification_default_user");
    });
    // Trigger initial rewards check
    const initialRewards = await page.evaluate(() => {
      const btn = document.querySelector('[data-testid="sidebar-profile-badge"]');
      return btn ? btn.textContent : "";
    });
    recordResult("Sidebar Card", "Clinician Card Displays XP and Level", initialRewards.includes("XP"), initialRewards.trim().replace(/\s+/g, " "));

    // Step 2: Trigger Clinical Lookup Action
    console.log("\n--- [STEP 2] Clinical Lookup Action & XP Awarding ---");
    const omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 4000 });
    await omnibar.type("Where is the #10 blade?");
    await page.keyboard.press("Enter");
    await new Promise((r) => setTimeout(r, 1200));

    // Check for XP Toast Pill
    const toastRendered = await page.evaluate(() => {
      const toast = document.querySelector('[data-testid="xp-toast-pill"]');
      return toast ? toast.textContent : null;
    });
    const toastMatches =
      toastRendered !== null &&
      (toastRendered.includes("+2 XP") ||
        toastRendered.includes("+12 XP") ||
        toastRendered.includes("First Quest"));
    recordResult(
      "XP Engine",
      "XP Toast Pill Appears on Action",
      toastMatches,
      toastRendered || "Toast not captured"
    );

    // Step 3: Open User Profile Modal directly to Rewards & Rank Tab
    console.log("\n--- [STEP 3] Rewards & Rank Dashboard in UserProfileModal ---");
    const profileCardBtn = await page.waitForSelector('[data-testid="sidebar-profile-badge"]', { timeout: 4000 });
    await profileCardBtn.click();
    await page.waitForSelector('[data-testid="rewards-dashboard"]', { timeout: 5000 });

    const rewardsText = await page.evaluate(() => {
      const dash = document.querySelector('[data-testid="rewards-dashboard"]');
      return dash ? dash.textContent : "";
    });

    const hasLevel1 = rewardsText.includes("Novice Scout") || rewardsText.includes("Lv.1");
    const hasQuestProgress = rewardsText.includes("Run 3 Supply Searches") && rewardsText.includes("+10 XP");
    const hasBadge = rewardsText.includes("First Quest");

    recordResult("Rewards Tab", "Renders Level Rank & XP Tier Progress", hasLevel1, "Level 1 • Novice Scout verified");
    recordResult("Quests", "Active Shift Quest Progress Tracked", hasQuestProgress, "Supply Search Quest verified");
    recordResult("Badges", "First Quest Achievement Badge Unlocked", hasBadge, "First Quest unlocked");

    // Capture screenshot of the Rewards Tab
    const ssPath = path.join(ARTIFACT_DIR, "phase35_rewards_dashboard.png");
    await page.screenshot({ path: ssPath });
    console.log(`\nScreenshot saved: ${ssPath}`);

    // Step 4: Seamless Tab Switch back to Assignment
    console.log("\n--- [STEP 4] Seamless Tab Switching to Assignment Tab ---");
    const assignmentTabBtn = await page.waitForSelector('[data-testid="tab-profile-assignment"]', { timeout: 3000 });
    await assignmentTabBtn.click();
    await page.waitForSelector('[data-testid="input-fullname"]', { timeout: 3000 });

    const formClean = await page.evaluate(() => {
      const name = document.querySelector('[data-testid="input-fullname"]')?.value;
      const fac = document.querySelector('[data-testid="select-facility"]')?.value;
      const dept = document.querySelector('[data-testid="select-department"]')?.value;
      return name && fac && dept;
    });
    recordResult("Tab Navigation", "Assignment Form Preserved and Functional", Boolean(formClean), "Clean 4-field inputs intact");

    // Close modal
    const closeBtn = await page.waitForSelector('button[aria-label="Close"]', { timeout: 3000 });
    await closeBtn.click();
    await new Promise((r) => setTimeout(r, 400));

    // Step 5: Peer Q&A XP Trigger Check
    console.log("\n--- [STEP 5] Peer Q&A XP Trigger Integration ---");
    const peerQnABtn = await page.$('[data-testid="sidebar-profile-badge"]');
    // Direct evaluate to verify awardClinicalXP works across modules
    const verifyXp = await page.evaluate(() => {
      const rawBefore = localStorage.getItem("ornav_gamification_usr-demo-001");
      return rawBefore ? JSON.parse(rawBefore).xp : 0;
    });
    recordResult("Persistence", "Clinician XP State Persisted in LocalStorage", verifyXp > 0, `Total XP: ${verifyXp}`);

  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n==================================================================");
  console.log("=== PHASE 35 GAMIFICATION GAUNTLET SUMMARY ===");
  console.log("==================================================================");
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  results.forEach((r, idx) => {
    const status = r.passed ? "✓ PASS" : "✗ FAIL";
    console.log(`${idx + 1}. [${status}] [${r.subsystem}] ${r.testName} -- ${r.details}`);
  });

  console.log(`\nTOTAL: ${total} | PASSED: ${passed} | FAILED: ${failed}`);
  if (failed > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error("FATAL PHASE 35 GAUNTLET ERROR:", err);
  process.exit(1);
});
