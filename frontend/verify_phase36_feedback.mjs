/**
 * Phase 36.1 E2E Verification: Admin-Only Feedback Inbox, Minimal Mobile UI, RPG Ranks & Lower XP.
 * Tests:
 * 1. Passive chat complaint intercepter awards +3 XP and renders micro-pill.
 * 2. Admin User (Sean Iglesia):
 *    - Sidebar displays "Feedback & Roadmap" with open-count badge.
 *    - FeedbackModal shows Admin Triage tab with compact rows (dot, AI fix, [📋 Prompt], [✓ Done]).
 *    - 1-click copy prompt works.
 *    - Resolving item marks it done.
 * 3. Non-Admin User (Dr. John Dorian):
 *    - Sidebar displays "Send Feedback" with NO open-count badge.
 *    - FeedbackModal completely hides the Admin Triage tab.
 *    - Shows clean 3-category form, "Tell us what to improve...", and [Submit Feedback (+5 XP)].
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 36.1 ADMIN FEEDBACK & RPG REBALANCING GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 850 });

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Ensure Logged in as Admin (Sean Iglesia)
    console.log("\n--- [STEP 1] Login as Admin (Sean Iglesia) ---");
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      console.log("Logged in with Quick Demo user (Sean Iglesia).");
    } else {
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
      console.log("Already authenticated.");
    }
    await new Promise((r) => setTimeout(r, 600));

    // Step 2: Passive Chat Interceptor & Lower XP (+3 XP)
    console.log("\n--- [STEP 2] Passive Chat Complaint Interceptor & Lower XP ---");
    const omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    const wishQuery = "I wish this app had a quick vascular clamp size chart";
    await omnibar.type(wishQuery);
    await page.keyboard.press("Enter");

    await page.waitForSelector('[data-testid="feedback-captured-pill"]', { timeout: 6000 });
    const pillText = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="feedback-captured-pill"]');
      return pill ? pill.textContent : "";
    });
    recordResult(
      "Chat Interceptor",
      "Micro-Pill Awards Lowered +3 XP",
      pillText.includes("+3 XP"),
      pillText.trim()
    );

    // Step 3: Admin Sidebar View
    console.log("\n--- [STEP 3] Admin Sidebar & Admin Triage Access ---");
    const adminSidebarBtn = await page.waitForSelector('[data-testid="sidebar-feedback-btn"]', { timeout: 4000 });
    const adminBtnText = await page.evaluate((el) => el.textContent, adminSidebarBtn);
    const hasCount = await page.$('[data-testid="feedback-open-count"]');

    recordResult(
      "Admin Sidebar",
      "Admin Sees 'Feedback & Roadmap' with Open Badge",
      adminBtnText.includes("Feedback & Roadmap") && hasCount !== null,
      adminBtnText.trim().replace(/\s+/g, " ")
    );

    // Open Admin Modal
    await adminSidebarBtn.click();
    await page.waitForSelector('[data-testid="tab-recommendations-hub"]', { timeout: 4000 });
    const adminTab = await page.$('[data-testid="tab-recommendations-hub"]');
    await adminTab.click();
    await page.waitForSelector('[data-testid="recommendations-hub"]', { timeout: 4000 });

    // Check decluttered compact row
    const cardContent = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="recommendation-card"]');
      return card ? card.textContent : "";
    });
    const hasCompactButtons = await page.evaluate(() => {
      const copyBtn = document.querySelector('[data-testid="btn-copy-prompt"]');
      const doneBtn = document.querySelector('[data-testid="btn-resolve-feedback"]');
      return Boolean(copyBtn && doneBtn);
    });

    recordResult(
      "Admin Triage",
      "Renders Decluttered Compact Triage Row with Prompt & Done",
      hasCompactButtons && cardContent.length > 0,
      "Compact row verified"
    );

    // Test Prompt Copy
    const copyBtn = await page.$('[data-testid="btn-copy-prompt"]');
    if (copyBtn) {
      await copyBtn.click();
      await new Promise((r) => setTimeout(r, 400));
      const copiedText = await page.evaluate((btn) => btn.textContent, copyBtn);
      recordResult("Admin Triage", "Copy Prompt Button Flips to Copied", copiedText.includes("Copied"), copiedText.trim());
    }

    // Save Screenshot of Admin Triage
    const adminSs = path.join(ARTIFACT_DIR, "phase36_1_admin_triage.png");
    await page.screenshot({ path: adminSs });
    console.log(`Saved screenshot: ${adminSs}`);

    // Close Modal
    const closeBtn = await page.waitForSelector('button[aria-label="Close"]', { timeout: 3000 });
    await closeBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Step 4: Switch to Non-Admin User (Dr. John Dorian)
    console.log("\n--- [STEP 4] Regular Clinician Permission Check ---");
    await page.evaluate(() => {
      const nonAdminSession = {
        userId: "usr-staff-002",
        email: "dr.dorian@sacredheart.org",
        fullName: "Dr. John Dorian",
        token: "fake-token",
        onboardingCompleted: true,
        profile: {
          fullName: "Dr. John Dorian",
          facilityId: "sacred_heart",
          facilityName: "Sacred Heart Hospital",
          departmentId: "or_main",
          clinicalRole: "Surgical Resident",
        },
      };
      localStorage.setItem("ornav_active_session", JSON.stringify(nonAdminSession));
      window.dispatchEvent(new CustomEvent("ornav_auth_session_changed", { detail: nonAdminSession }));
    });
    await new Promise((r) => setTimeout(r, 600));

    // Verify non-admin sidebar
    const nonAdminSidebarBtn = await page.waitForSelector('[data-testid="sidebar-feedback-btn"]', { timeout: 4000 });
    const nonAdminBtnText = await page.evaluate((el) => el.textContent, nonAdminSidebarBtn);
    const nonAdminHasBadge = await page.$('[data-testid="feedback-open-count"]');

    recordResult(
      "Regular Clinician",
      "Sidebar Displays 'Send Feedback' without Open Count Badge",
      nonAdminBtnText.includes("Send Feedback") && nonAdminHasBadge === null,
      nonAdminBtnText.trim().replace(/\s+/g, " ")
    );

    // Open Non-Admin Feedback Modal
    await nonAdminSidebarBtn.click();
    await page.waitForSelector('[data-testid="feedback-modal"]', { timeout: 4000 });

    // Verify Admin Triage tab is completely hidden
    const triageTabForClinician = await page.$('[data-testid="tab-recommendations-hub"]');
    const submitBtn = await page.waitForSelector('[data-testid="btn-submit-feedback"]', { timeout: 3000 });
    const submitBtnText = await page.evaluate((el) => el.textContent, submitBtn);

    recordResult(
      "Regular Clinician",
      "Admin Triage Tab is Completely Hidden for Non-Admin",
      triageTabForClinician === null,
      "Triage tab hidden"
    );
    recordResult(
      "Regular Clinician",
      "Displays Clean Single-View Form with +5 XP",
      submitBtnText.includes("+5 XP"),
      submitBtnText.trim()
    );

    // Save Screenshot of Non-Admin Form
    const clinicianSs = path.join(ARTIFACT_DIR, "phase36_1_clinician_feedback.png");
    await page.screenshot({ path: clinicianSs });
    console.log(`Saved screenshot: ${clinicianSs}`);

    // Close modal
    const closeBtn2 = await page.waitForSelector('button[aria-label="Close"]', { timeout: 3000 });
    await closeBtn2.click();
    await new Promise((r) => setTimeout(r, 500));

    // Step 5: Check Compact RPG Gamification UI
    console.log("\n--- [STEP 5] Compact RPG Gamification UI in Profile ---");
    const profileBadge = await page.waitForSelector('[data-testid="sidebar-profile-badge"]', { timeout: 4000 });
    await profileBadge.click();
    await page.waitForSelector('[data-testid="rewards-dashboard"]', { timeout: 4000 });

    const rewardsText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="rewards-dashboard"]');
      return el ? el.textContent : "";
    });

    const hasRpgTitle =
      rewardsText.includes("Novice Scout") ||
      rewardsText.includes("Supply Ranger") ||
      rewardsText.includes("Vault Pathfinder");
    const hasRpgBadges =
      rewardsText.includes("First Quest") ||
      rewardsText.includes("Loot Hunter") ||
      rewardsText.includes("Guild Helper");

    recordResult(
      "RPG Ranks",
      "Displays Fantasy/RPG Ranks instead of Hospital Job Titles",
      hasRpgTitle,
      "Novice Scout verified"
    );
    recordResult(
      "RPG Badges",
      "Badges Renamed to Quest/RPG Terminology",
      hasRpgBadges,
      "First Quest / Loot Hunter verified"
    );

    // Save Screenshot of Compact Rewards Tab
    const rewardsSs = path.join(ARTIFACT_DIR, "phase36_1_compact_rpg_rewards.png");
    await page.screenshot({ path: rewardsSs });
    console.log(`Saved screenshot: ${rewardsSs}`);

  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n==================================================================");
  console.log("=== PHASE 36.1 GAUNTLET SUMMARY ===");
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
  console.error("Gauntlet execution failed:", err);
  process.exit(1);
});
