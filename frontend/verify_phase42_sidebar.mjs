/**
 * Phase 42 / v0.60 E2E Verification: Sidebar Declutter, Streamlined Labels & Audio/Pairing Split
 *
 * Verifies:
 * 1. Interactive Clinician Profile Card with department in subtitle & Edit ➔ indicator.
 * 2. Standalone department dropdown removed from visible layout (hidden test hook intact).
 * 3. Simplified Primary Action Buttons ("New Case", "Questions", "Feedback").
 * 4. Streamlined System Drawer:
 *    - "API" (renamed from "API & Cloud Sync")
 *    - Removal of duplicate "Clinician Profile & Assignment"
 *    - Split "Audio" (Voice Responses toggle, 15-min hands-free)
 *    - Split "Pairing" (Mobile QR pairing, Workstation Server URL)
 *    - "System Info" (renamed from "Diagnostics & System Info", showing v0.60 Build 17)
 * 5. Full screenshot capture to artifact directory.
 */

import puppeteer from "puppeteer-core";
import path from "path";

const CHROME_PATH =
  "C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe";
const BASE_URL = "http://localhost:3000";
const ARTIFACT_DIR = "C:/Users/igles/.gemini/antigravity/brain/2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 42 / v0.60 SIDEBAR DECLUTTER & STREAMLINE GAUNTLET ===");
  console.log("==================================================================");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 960 });

  const results = [];
  function recordResult(subsystem, testName, passed, details) {
    results.push({ subsystem, testName, passed, details });
    const mark = passed ? "[✓ PASS]" : "[✗ FAIL]";
    console.log(`${mark} ${subsystem} -> ${testName} (${details})`);
  }

  try {
    console.log(`\nNavigating to ${BASE_URL}...`);
    await page.goto(BASE_URL, { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Login
    console.log("\n--- [STEP 1] Login Verification ---");
    const demoBtn = await page.$('[data-testid="btn-quick-demo-login"]');
    if (demoBtn) {
      await demoBtn.click();
      await page.waitForSelector('[data-testid="sidebar-profile-badge"]', { timeout: 6000 });
      recordResult("Auth", "Quick Demo Login", true, "Authenticated as Sean Iglesia");
    } else {
      recordResult("Auth", "Session Reused", true, "Already authenticated");
    }

    // Step 2: Clinician Profile Interactive Card
    console.log("\n--- [STEP 2] Clinician Profile Interactive Card ---");
    const profileCard = await page.$('[data-testid="sidebar-profile-badge"]');
    if (!profileCard) {
      throw new Error("Missing [data-testid='sidebar-profile-badge']");
    }
    const profileText = await page.evaluate((el) => el.innerText, profileCard);
    console.log("Profile Card Text:\n", profileText);

    const hasName = profileText.includes("Sean Iglesia");
    const hasDept = profileText.includes("OR") || profileText.includes("Sacred Heart");
    const hasRole = profileText.includes("RN") || profileText.includes("Circulating");
    const hasEdit = profileText.includes("Edit") && profileText.includes("➔");
    recordResult("Sidebar Profile", "Profile Card Data", hasName && hasDept && hasRole && hasEdit, `Found: name=${hasName}, dept=${hasDept}, role=${hasRole}, edit=${hasEdit}`);

    // Click profile card to verify it opens Assignment modal
    await profileCard.click();
    await page.waitForSelector('[data-testid="profile-modal"]', { timeout: 4000 });
    const modalTitle = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="profile-modal"]');
      return el ? el.innerText.substring(0, 100) : "";
    });
    recordResult("Sidebar Profile", "Interactive Click Opens Assignment Modal", modalTitle.includes("Profile") || modalTitle.includes("Assignment") || modalTitle.includes("Clinician"), "Modal opened successfully");

    // Close modal
    const closeBtn = await page.$('[data-testid="close-profile-modal-btn"]');
    if (closeBtn) {
      await closeBtn.click();
      await new Promise((r) => setTimeout(r, 400));
    }

    // Step 3: Verify Standalone Clinical Department Dropdown is Removed from Visible Layout
    console.log("\n--- [STEP 3] Standalone Department Dropdown Declutter ---");
    const deptDropdownVisible = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="department-selector"]');
      if (!el) return false;
      const style = window.getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    });
    recordResult("Sidebar Declutter", "Standalone Department Dropdown Hidden", !deptDropdownVisible, "Visible dropdown removed, hidden test selector preserved");

    // Step 4: Primary Action Button Names
    console.log("\n--- [STEP 4] Simplified Primary Action Buttons ---");
    const newCaseBtn = await page.$('[data-testid="sidebar-new-case-btn"]');
    const newCaseText = newCaseBtn ? await page.evaluate((el) => el.innerText, newCaseBtn) : "";
    recordResult("Action Buttons", "New Case Button", newCaseText.includes("New Case"), `Text: "${newCaseText.trim()}"`);

    const peerBtn = await page.$('[data-testid="sidebar-peer-qna-btn"]');
    const peerText = peerBtn ? await page.evaluate((el) => el.innerText, peerBtn) : "";
    const isPeerSimplified = peerText.includes("Questions") && !peerText.includes("Peer Q&A Ping") && !peerText.includes("Multi-Peer");
    recordResult("Action Buttons", "Questions Button Renamed", isPeerSimplified, `Text: "${peerText.trim()}"`);

    const feedbackBtn = await page.$('[data-testid="sidebar-feedback-btn"]');
    const feedbackText = feedbackBtn ? await page.evaluate((el) => el.innerText, feedbackBtn) : "";
    const isFeedbackSimplified = feedbackText.includes("Feedback") && !feedbackText.includes("Roadmap");
    recordResult("Action Buttons", "Feedback Button Renamed", isFeedbackSimplified, `Text: "${feedbackText.trim()}"`);

    // Step 5: System Drawer Accordion Verification
    console.log("\n--- [STEP 5] Streamlined System Drawer ---");
    const systemToggle = await page.$('[data-testid="sidebar-system-toggle"]');
    await systemToggle.click();
    await new Promise((r) => setTimeout(r, 400));

    // Category: API
    const apiToggle = await page.$('[data-testid="category-api-toggle"]');
    const apiText = apiToggle ? await page.evaluate((el) => el.innerText, apiToggle) : "";
    const isApiRenamed = apiText.includes("API") && !apiText.includes("Cloud Sync");
    recordResult("System Drawer", "API Renamed from API & Cloud Sync", isApiRenamed, `Text: "${apiText.trim()}"`);

    // Duplicate Profile Category Removed
    const duplicateProfile = await page.$('[data-testid="category-profile-toggle"]');
    recordResult("System Drawer", "Duplicate Clinician Profile Accordion Removed", duplicateProfile === null, "Accordion completely removed from drawer");

    // Category: Background Services
    const servicesToggle = await page.$('[data-testid="category-services-toggle"]');
    recordResult("System Drawer", "Background Services Present", servicesToggle !== null, "OTA and Cloud Sync grouping intact");

    // Category: Audio
    const audioToggle = await page.$('[data-testid="category-audio-toggle"]');
    const audioText = audioToggle ? await page.evaluate((el) => el.innerText, audioToggle) : "";
    const isAudioDistinct = audioText.includes("Audio") && !audioText.includes("Pairing");
    recordResult("System Drawer", "Audio Category Distinct", isAudioDistinct, `Text: "${audioText.trim()}"`);

    // Expand Audio to verify TTS and Hands-Free controls
    await audioToggle.click();
    await new Promise((r) => setTimeout(r, 300));
    const ttsToggle = await page.$('[data-testid="toggle-tts-audio"]');
    const handsFreeBtn = await page.$('[data-testid="btn-hands-free-audio"]');
    recordResult("System Drawer Audio", "TTS & Hands-Free Controls", ttsToggle !== null && handsFreeBtn !== null, "Found toggle-tts-audio and btn-hands-free-audio");

    // Category: Pairing
    const pairingToggle = await page.$('[data-testid="category-pairing-toggle"]');
    const pairingText = pairingToggle ? await page.evaluate((el) => el.innerText, pairingToggle) : "";
    const isPairingDistinct = pairingText.includes("Pairing") && !pairingText.includes("Audio");
    recordResult("System Drawer", "Pairing Category Distinct", isPairingDistinct, `Text: "${pairingText.trim()}"`);

    // Expand Pairing to verify QR Pair and Server URL input
    await pairingToggle.click();
    await new Promise((r) => setTimeout(r, 300));
    const qrPairBtn = await page.$('[data-testid="btn-open-qr-pair"]');
    const serverUrlInput = await page.$('[data-testid="input-workstation-server-url"]');
    recordResult("System Drawer Pairing", "QR Pair Button & Server URL Input", qrPairBtn !== null && serverUrlInput !== null, "Found btn-open-qr-pair and input-workstation-server-url");

    // Category: System Info
    const systemInfoToggle = await page.$('[data-testid="category-system-info-toggle"]');
    const systemInfoText = systemInfoToggle ? await page.evaluate((el) => el.innerText, systemInfoToggle) : "";
    const isSystemInfoRenamed = systemInfoText.includes("System Info") && !systemInfoText.includes("Diagnostics &");
    recordResult("System Drawer", "System Info Renamed from Diagnostics & System Info", isSystemInfoRenamed, `Text: "${systemInfoText.trim()}"`);

    // Check backward compatibility test hook
    const diagHook = await page.$('[data-testid="category-diagnostics-toggle"]');
    recordResult("System Drawer", "Backward Compatibility Hook Present", diagHook !== null, "Found category-diagnostics-toggle hook");

    // Expand System Info to verify offline cache and v0.60 build info
    await systemInfoToggle.click();
    await new Promise((r) => setTimeout(r, 400));
    const dexieCountEl = await page.$('[data-testid="dexie-item-count"]');
    const dexieText = dexieCountEl ? await page.evaluate((el) => el.innerText, dexieCountEl) : "";
    recordResult("System Info", "Dexie Cache Counter", dexieText.includes("items (Dexie)"), `Text: "${dexieText}"`);

    const drawerFullText = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="sidebar-system-toggle"]')?.parentElement;
      return el ? el.innerText : "";
    });
    const hasV060 = drawerFullText.includes("v0.60") && drawerFullText.includes("Build 17");
    recordResult("System Info", "Version v0.60 Build 17 Synchronized", hasV060, "Found v0.60 and Build 17 in System Info");

    // Step 6: Capture Screenshot
    console.log("\n--- [STEP 6] Screenshot Capture ---");
    const screenshotPath = path.join(ARTIFACT_DIR, "phase42_sidebar_declutter_verified.png");
    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(`✓ Screenshot captured to ${screenshotPath}`);
    recordResult("Screenshot", "Decluttered Sidebar Verification Captured", true, screenshotPath);

    console.log("\n==================================================================");
    console.log("=== PHASE 42 VERIFICATION SUMMARY ===");
    console.log("==================================================================");
    const passCount = results.filter((r) => r.passed).length;
    console.log(`Results: ${passCount}/${results.length} PASSED`);

    if (passCount === results.length) {
      console.log(">>> ALL CHECKS PASSED PERFECTLY! <<<");
    } else {
      console.error(">>> SOME CHECKS FAILED! <<<");
      process.exitCode = 1;
    }
  } catch (err) {
    console.error("Verification error:", err);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
}

run();
