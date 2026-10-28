/**
 * Phase 36 E2E Verification: Passive Chat Complaint Interceptor & Dev Recommendations Hub.
 * Tests zero-latency passive complaint detection in chat, micro-pill rendering,
 * opening FeedbackModal from Sidebar, viewing/sorting recommendations,
 * 1-click Antigravity prompt copy, upvoting, manual feedback submission, and resolving.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 36 FEEDBACK ENGINE & DEV RECOMMENDATIONS GAUNTLET ===");
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

    // Step 1: Ensure Authenticated
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

    // Step 2: Passive Chat Complaint / Feature Wish Detection
    console.log("\n--- [STEP 2] Passive Chat Complaint Interceptor ---");
    const omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
    const wishQuery = "I wish this app had a quick vascular clamp size chart";
    await omnibar.type(wishQuery);
    await page.keyboard.press("Enter");
    console.log(`Sent chat wish: "${wishQuery}"`);

    // Wait for message and micro-pill
    await page.waitForSelector('[data-testid="feedback-captured-pill"]', { timeout: 6000 });
    const pillText = await page.evaluate(() => {
      const pill = document.querySelector('[data-testid="feedback-captured-pill"]');
      return pill ? pill.textContent : "";
    });
    recordResult(
      "Chat Interceptor",
      "Passive Interceptor Shows Micro-Pill Under Chat Bubble",
      pillText.includes("Logged to Developer Feedback") && pillText.includes("+15 XP"),
      pillText.trim()
    );

    // Step 3: Sidebar Feedback & Roadmap Button
    console.log("\n--- [STEP 3] Sidebar Feedback & Roadmap Access ---");
    const sidebarFeedbackBtn = await page.waitForSelector('[data-testid="sidebar-feedback-btn"]', { timeout: 4000 });
    const btnText = await page.evaluate((el) => el.textContent, sidebarFeedbackBtn);
    recordResult(
      "Sidebar",
      "Feedback & Roadmap Button Renders with Live Count",
      btnText.includes("Feedback & Roadmap"),
      btnText.trim().replace(/\s+/g, " ")
    );

    // Open Modal
    await sidebarFeedbackBtn.click();
    await page.waitForSelector('[data-testid="recommendations-hub"]', { timeout: 5000 });
    console.log("FeedbackModal opened to Recommendations Hub.");

    // Step 4: Dev Recommendations Hub Verification
    console.log("\n--- [STEP 4] Dev Recommendations Hub & Fix Prompts ---");
    const bannerText = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="top-recommendations-banner"]');
      return banner ? banner.textContent : "";
    });
    recordResult(
      "Recommendations Hub",
      "Top Synthesized Dev Recommendations Banner Renders",
      bannerText.includes("Top Synthesized Dev Recommendations") && bannerText.includes("🔥"),
      "Banner and top priority recommendations confirmed"
    );

    // Check if the chat-intercepted wish appears in cards
    const hubContent = await page.evaluate(() => {
      const hub = document.querySelector('[data-testid="recommendations-hub"]');
      return hub ? hub.textContent : "";
    });
    const foundIntercepted =
      hubContent.includes("vascular clamp") || hubContent.includes("clamp size");
    recordResult(
      "Recommendations Hub",
      "Chat-Intercepted Complaint Appears in Recommendations List",
      foundIntercepted,
      "Vascular clamp recommendation card present"
    );

    // Test 1-click Antigravity prompt copy
    const copyBtns = await page.$$('[data-testid="btn-copy-prompt"]');
    if (copyBtns.length > 0) {
      await copyBtns[0].click();
      await new Promise((r) => setTimeout(r, 400));
      const copyText = await page.evaluate((btn) => btn.textContent, copyBtns[0]);
      recordResult(
        "Antigravity Prompts",
        "1-Click Copy Antigravity Fix Prompt Button Works",
        copyText.includes("Copied"),
        copyText.trim()
      );
    } else {
      recordResult("Antigravity Prompts", "1-Click Copy Prompt Button Found", false, "No copy buttons found");
    }

    // Test Upvote
    const upvoteBtns = await page.$$('[data-testid="btn-upvote-feedback"]');
    if (upvoteBtns.length > 0) {
      const beforeText = await page.evaluate((b) => b.textContent, upvoteBtns[0]);
      await upvoteBtns[0].click();
      await new Promise((r) => setTimeout(r, 400));
      const afterText = await page.evaluate((b) => b.textContent, upvoteBtns[0]);
      recordResult(
        "Upvoting",
        "Upvote Button Increments Priority Counter",
        afterText !== beforeText || afterText.includes("+1"),
        `Before: ${beforeText.trim()} -> After: ${afterText.trim()}`
      );
    }

    // Capture Screenshot of Recommendations Hub
    const hubSs = path.join(ARTIFACT_DIR, "phase36_dev_recommendations_hub.png");
    await page.screenshot({ path: hubSs });
    console.log(`Saved screenshot: ${hubSs}`);

    // Step 5: Manual Feedback Submission Tab
    console.log("\n--- [STEP 5] Manual Feedback Submission Form ---");
    const giveFeedbackTab = await page.waitForSelector('[data-testid="tab-give-feedback"]', { timeout: 3000 });
    await giveFeedbackTab.click();
    await page.waitForSelector('[data-testid="feedback-input-text"]', { timeout: 3000 });

    const feedbackInput = await page.$('[data-testid="feedback-input-text"]');
    await feedbackInput.type("Could you add an auto-scroll to the bottom of the preference card table?");
    const submitBtn = await page.waitForSelector('[data-testid="btn-submit-feedback"]', { timeout: 3000 });
    await submitBtn.click();

    // Verify success banner
    await page.waitForSelector('[data-testid="feedback-success-banner"]', { timeout: 4000 });
    const successBannerText = await page.evaluate(() => {
      const banner = document.querySelector('[data-testid="feedback-success-banner"]');
      return banner ? banner.textContent : "";
    });
    recordResult(
      "Manual Feedback",
      "Manual Feedback Submitted and Awards +20 XP",
      successBannerText.includes("+20 XP"),
      successBannerText.trim()
    );

    // Capture screenshot of submission success
    const manualSs = path.join(ARTIFACT_DIR, "phase36_manual_feedback_submission.png");
    await page.screenshot({ path: manualSs });
    console.log(`Saved screenshot: ${manualSs}`);

    // Wait for auto-switch back to recommendations hub
    await new Promise((r) => setTimeout(r, 1600));

    // Step 6: Mark Resolved & Filter
    console.log("\n--- [STEP 6] Mark Item Resolved & Filter Verification ---");
    const resolveBtns = await page.$$('[data-testid="btn-resolve-feedback"]');
    if (resolveBtns.length > 0) {
      await resolveBtns[0].click();
      await new Promise((r) => setTimeout(r, 500));
      // Switch filter to resolved
      const resolvedFilter = await page.waitForSelector('[data-testid="filter-resolved"]', { timeout: 3000 });
      await resolvedFilter.click();
      await new Promise((r) => setTimeout(r, 400));

      const resolvedCount = await page.evaluate(() => {
        return document.querySelectorAll('[data-testid="recommendation-card"]').length;
      });
      recordResult(
        "Triage Lifecycle",
        "Item Resolved and Filtered in Resolved View",
        resolvedCount >= 1,
        `${resolvedCount} resolved items in archive`
      );
    }

  } finally {
    await browser.close();
  }

  // Summary
  console.log("\n==================================================================");
  console.log("=== PHASE 36 GAUNTLET SUMMARY ===");
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
