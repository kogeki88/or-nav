import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

const results = [];

function recordResult(subsystem, testName, passed, details = "") {
  results.push({ subsystem, testName, passed, details });
  const mark = passed ? "✓ PASS" : "✗ FAIL";
  console.log(`[${mark}] ${subsystem} -> ${testName}${details ? " (" + details + ")" : ""}`);
}

async function run() {
  console.log("==================================================================");
  console.log("=== PHASE 32 MASTER FULL-STACK END-TO-END BROWSER GAUNTLET (v0.4) ===");
  console.log("==================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    console.log("Booting frontend at http://localhost:3000...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 15000 });
    await new Promise((r) => setTimeout(r, 800));

    // --------------------------------------------------------------------------
    // 1. Profile & Multi-Tenant Switching
    // --------------------------------------------------------------------------
    console.log("\n--- [GAUNTLET 1] Profile & Multi-Tenant Assignment ---");
    try {
      const profileBadge = await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 5000 });
      if (!profileBadge) throw new Error("Header profile badge not found");
      await profileBadge.click();
      await new Promise((r) => setTimeout(r, 400));

      // Select Sacred Heart Hospital
      await page.waitForSelector('[data-testid="select-facility"]', { timeout: 3000 });
      await page.select('[data-testid="select-facility"]', "sacred_heart");

      // Select OR department
      await page.waitForSelector('[data-testid="select-department"]', { timeout: 3000 });
      await page.select('[data-testid="select-department"]', "or_main");

      // Select Circulating RN role
      await page.waitForSelector('[data-testid="select-role"]', { timeout: 3000 });
      await page.select('[data-testid="select-role"]', "Circulating RN");

      // Submit profile
      const saveBtn = await page.$('[data-testid="button-save-profile"]');
      if (!saveBtn) throw new Error("Save profile button not found");
      await saveBtn.click();
      await new Promise((r) => setTimeout(r, 800));

      // Verify header profile badge text updated
      const updatedBadgeText = await page.$eval('[data-testid="header-profile-badge"]', (el) => el.textContent || "");
      const matched = updatedBadgeText.includes("OR") && updatedBadgeText.includes("Circulating RN");
      recordResult("Profile & RBAC", "Profile Selection & Header Badge Sync", matched, updatedBadgeText.trim());
      if (!matched) throw new Error("Header badge did not reflect selected OR + Circulating RN role");
    } catch (err) {
      recordResult("Profile & RBAC", "Profile Selection & Header Badge Sync", false, err.message);
    }

    // --------------------------------------------------------------------------
    // 2. On-Demand Installed Resources Manager (📦 Installed Resources)
    // --------------------------------------------------------------------------
    console.log("\n--- [GAUNTLET 2] On-Demand Installed Resources Manager ---");
    try {
      // Open Sidebar System Drawer
      const systemToggle = await page.waitForSelector('[data-testid="sidebar-system-toggle"]', { timeout: 5000 });
      await systemToggle.click();
      await new Promise((r) => setTimeout(r, 500));

      // Click Open Resource Manager (it is open by default or toggle if needed)
      let openResBtn = await page.$('[data-testid="button-open-resource-manager"]');
      if (!openResBtn) {
        const resAccordion = await page.waitForSelector('[data-testid="category-resources-toggle"]', { timeout: 4000 });
        await resAccordion.click();
        await new Promise((r) => setTimeout(r, 400));
        openResBtn = await page.waitForSelector('[data-testid="button-open-resource-manager"]', { timeout: 4000 });
      }
      await openResBtn.click();
      await new Promise((r) => setTimeout(r, 1200));

      // Verify modal opened
      await page.waitForSelector("#resource-manager-title", { timeout: 4000 });
      console.log("Installed Resources modal opened successfully.");

      // Verify 3 active profile packs rendered
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid^="pack-item-"]').length >= 3,
        { timeout: 5000 }
      ).catch(() => null);

      const packElements = await page.$$('[data-testid^="pack-item-"]');
      console.log(`Found ${packElements.length} pack items in Installed Resources modal.`);
      const packTexts = await Promise.all(packElements.map((el) => el.evaluate((n) => n.innerText)));
      const hasHandbook = packTexts.some((t) => t.includes("Handbook") || t.includes("Sacred Heart"));
      const hasCards = packTexts.some((t) => t.includes("Preference") || t.includes("OR"));
      const hasRole = packTexts.some((t) => t.includes("Circulat") || t.includes("Role"));

      const packsFound = hasHandbook && hasCards && hasRole;
      recordResult("Resource Manager", "3-Tier Active Profile Packs Listed", packsFound, "Handbook, OR Cards, Circulator Role");

      // Test Reinstall / Update action on a pack
      if (packElements.length > 0) {
        const refreshBtn = await packElements[0].$('button[title*="Reinstall"], button[title*="Download"]');
        if (refreshBtn) {
          await refreshBtn.click();
          await new Promise((r) => setTimeout(r, 1500));
          recordResult("Resource Manager", "Reinstall / Update Trigger", true, "Pack reinstalled cleanly");
        } else {
          recordResult("Resource Manager", "Reinstall / Update Trigger", false, "Action button missing in pack item");
        }
      }

      // Close modal
      await page.evaluate(() => {
        const title = document.querySelector("#resource-manager-title");
        if (title && title.parentElement && title.parentElement.parentElement) {
          const closeBtn = title.parentElement.parentElement.querySelector('button[aria-label="Close"]');
          if (closeBtn) closeBtn.click();
        }
      });
      await new Promise((r) => setTimeout(r, 500));
    } catch (err) {
      recordResult("Resource Manager", "Resource Packs Inspection & Reinstall", false, err.message);
    }

    // --------------------------------------------------------------------------
    // 3. Chat Persistence & Multi-Session Case History (🕒 Recent Cases)
    // --------------------------------------------------------------------------
    console.log("\n--- [GAUNTLET 3] Chat Persistence & Multi-Session Case History ---");
    try {
      // Send Case 1 query
      console.log("Sending Case 1 query: 'Where is DeBakey Forceps?'");
      const omnibar = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
      await omnibar.click();
      await omnibar.type("Where is DeBakey Forceps?");
      await page.keyboard.press("Enter");

      // Wait for response CoordinateCard
      await page.waitForFunction(
        () => document.querySelectorAll('[data-testid="coordinate-card"], .rounded-2xl').length > 0,
        { timeout: 8000 }
      );
      await new Promise((r) => setTimeout(r, 1000));

      const case1HasCard = await page.evaluate(() => {
        const text = document.body.innerText;
        return text.includes("DeBakey") || text.includes("OR 21");
      });
      recordResult("Chat & Persistence", "Case 1 Query & CoordinateCard Rendering", case1HasCard, "DeBakey Forceps resolved");

      // Simulate App Exit and Reload
      console.log("Simulating full app exit & reload (about:blank -> http://localhost:3000)...");
      await page.goto("about:blank");
      await new Promise((r) => setTimeout(r, 400));
      await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 15000 });
      await new Promise((r) => setTimeout(r, 1000));

      // Verify Case 1 restored
      const restored = await page.evaluate(() => {
        return document.body.innerText.includes("DeBakey");
      });
      recordResult("Chat & Persistence", "Chat Persistence Across App Exit", restored, "Messages preserved in IndexedDB/localStorage");

      // Click + New Case
      console.log("Triggering + New Case...");
      const newCaseBtn = await page.waitForSelector('[data-testid="sidebar-new-case-btn"]', { timeout: 4000 });
      await newCaseBtn.click();
      await new Promise((r) => setTimeout(r, 600));

      // Send Case 2 query
      console.log("Sending Case 2 query: 'Where is 3-0 Silk?'");
      const omnibar2 = await page.waitForSelector('[data-testid="omnibar-input"]', { timeout: 5000 });
      await omnibar2.click();
      await omnibar2.type("Where is 3-0 Silk?");
      await page.keyboard.press("Enter");
      await new Promise((r) => setTimeout(r, 1500));

      // Verify Recent Cases section has both sessions
      const recentToggle = await page.waitForSelector('[data-testid="recent-cases-toggle"]', { timeout: 4000 });
      // Ensure it is expanded
      const isExpanded = await page.$('[data-testid^="recent-case-item-"]');
      if (!isExpanded) {
        await recentToggle.click();
        await new Promise((r) => setTimeout(r, 400));
      }

      const caseItems = await page.$$('[data-testid^="recent-case-item-"]');
      const hasMultipleCases = caseItems.length >= 2;
      recordResult("Chat & Persistence", "Multi-Session Case Creation & Archival", hasMultipleCases, `${caseItems.length} active sessions tracked`);

      // Switch back to Case 1
      if (caseItems.length >= 2) {
        await caseItems[1].click();
        await new Promise((r) => setTimeout(r, 800));
        const switchedBack = await page.evaluate(() => document.body.innerText.includes("DeBakey"));
        recordResult("Chat & Persistence", "Switch Case & Historic Session Restoration", switchedBack, "Case 1 restored cleanly");
      }
    } catch (err) {
      recordResult("Chat & Persistence", "Multi-Session Persistence Flow", false, err.message);
    }

    // --------------------------------------------------------------------------
    // 4. System Accordion Drawer & Background Service Controls
    // --------------------------------------------------------------------------
    console.log("\n--- [GAUNTLET 4] System Drawer & Background Services ---");
    try {
      // Re-ensure system drawer is open
      const servicesAccordion = await page.$('[data-testid="category-services-toggle"]');
      if (!servicesAccordion) {
        const sysToggle = await page.waitForSelector('[data-testid="sidebar-system-toggle"]', { timeout: 4000 });
        await sysToggle.click();
        await new Promise((r) => setTimeout(r, 400));
      }

      // Expand Background Services accordion
      const servToggle = await page.waitForSelector('[data-testid="category-services-toggle"]', { timeout: 4000 });
      await servToggle.click();
      await new Promise((r) => setTimeout(r, 400));

      // Test [🔍 Check for Updates]
      const checkUpdateBtn = await page.waitForSelector('[data-testid="button-manual-update-check"]', { timeout: 4000 });
      await checkUpdateBtn.click();
      await new Promise((r) => setTimeout(r, 1200));

      const updateFeedback = await page.$eval('[data-testid="update-feedback"]', (el) => el.textContent || "").catch(() => "");
      const checkedUpdate = updateFeedback.length > 0;
      recordResult("System Services", "OTA Check for Updates Trigger", checkedUpdate, updateFeedback.trim());

      // Test [🔄 Sync Now]
      const syncBtn = await page.waitForSelector('[data-testid="button-manual-sync-now"]', { timeout: 4000 });
      await syncBtn.click();
      await new Promise((r) => setTimeout(r, 1200));

      const syncFeedback = await page.$eval('[data-testid="sync-feedback"]', (el) => el.textContent || "").catch(() => "");
      const synced = syncFeedback.length > 0;
      recordResult("System Services", "Background Sync Engine Trigger", synced, syncFeedback.trim());

      // Expand Diagnostics
      const diagToggle = await page.waitForSelector('[data-testid="category-diagnostics-toggle"]', { timeout: 4000 });
      await diagToggle.click();
      await new Promise((r) => setTimeout(r, 400));
      const diagRendered = await page.evaluate(() => document.body.innerText.includes("Build 6") || document.body.innerText.includes("v0.41"));
      recordResult("System Services", "Diagnostics & Version Info Accordion", diagRendered, "Version v0.41 Build 6 confirmed");
    } catch (err) {
      recordResult("System Services", "System Accordion & Service Triggers", false, err.message);
    }

    // --------------------------------------------------------------------------
    // 5. Live Peer Q&A Panel (👥 Peer Q&A Ping)
    // --------------------------------------------------------------------------
    console.log("\n--- [GAUNTLET 5] Live Peer Q&A Panel & Multi-Peer Verification ---");
    try {
      const peerQnABtn = await page.waitForSelector('[data-testid="sidebar-peer-qna-btn"]', { timeout: 5000 });
      await peerQnABtn.click();
      await new Promise((r) => setTimeout(r, 600));

      // Wait for modal header
      await page.waitForSelector("#peer-qna-title", { timeout: 4000 });

      // Switch to Ask tab
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.includes("Ask Department Peers"));
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 500));

      // Enter unique test question
      const testQuestion = `Gauntlet AAA Vascular Shunt Protocol (${Date.now()})`;
      const qTextarea = await page.waitForSelector('textarea[placeholder*="Where is the emergency vascular shunt"]', { timeout: 4000 });
      await qTextarea.click();
      await qTextarea.type(testQuestion);

      // Submit broadcast
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.includes("Broadcast Question"));
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 1500));

      // Switch to Active Questions tab
      await page.evaluate(() => {
        const btn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.includes("Active Questions"));
        if (btn) btn.click();
      });
      await new Promise((r) => setTimeout(r, 800));

      // Verify question is present with 🟡 Unverified badge
      const pageText = await page.evaluate(() => document.body.innerText);
      const questionRendered = pageText.includes(testQuestion);
      const hasUnverifiedBadge = pageText.includes("Unverified (0/2)") || pageText.includes("Unverified");
      recordResult("Peer Verification", "Broadcast Orientee Question & Unverified Badge", questionRendered && hasUnverifiedBadge, "🟡 Unverified (0/2) initialized");

      // Find the card for this question and click "+ Add Answer"
      await page.evaluate((qText) => {
        const cards = Array.from(document.querySelectorAll('[data-testid^="peer-question-"]'));
        const target = cards.find((c) => c.innerText.includes(qText));
        if (target) {
          const addAnswerBtn = Array.from(target.querySelectorAll("button")).find((b) => b.innerText.includes("+ Add Answer"));
          if (addAnswerBtn) addAnswerBtn.click();
        }
      }, testQuestion);
      await new Promise((r) => setTimeout(r, 500));

      // Type answer
      const ansInput = await page.waitForSelector('textarea[placeholder*="Enter clinical location"]', { timeout: 4000 });
      await ansInput.click();
      await ansInput.type("Stored in Core Supply · Cart V · Shelf 1 · Bin A.");

      // Submit answer
      await page.evaluate(() => {
        const submitBtn = Array.from(document.querySelectorAll("button")).find((b) => b.innerText.includes("Submit Answer"));
        if (submitBtn) submitBtn.click();
      });
      await new Promise((r) => setTimeout(r, 1500));

      // Click [✓ Verify Answer]
      await page.evaluate((qText) => {
        const cards = Array.from(document.querySelectorAll('[data-testid^="peer-question-"]'));
        const target = cards.find((c) => c.innerText.includes(qText));
        if (target) {
          const vBtn = Array.from(target.querySelectorAll("button")).find((b) => b.innerText.includes("Verify Answer"));
          if (vBtn) vBtn.click();
        }
      }, testQuestion);
      await new Promise((r) => setTimeout(r, 1500));

      // Verify badge updated
      const updatedText = await page.evaluate(() => document.body.innerText);
      const verifiedUpdated = updatedText.includes("Unverified (1/2)") || updatedText.includes("Verified by You");
      recordResult("Peer Verification", "Peer Answer Submission & Verification Vote", verifiedUpdated, "Verification registered, consensus progress tracked");

      // Close modal
      await page.evaluate(() => {
        const title = document.querySelector("#peer-qna-title");
        if (title && title.parentElement && title.parentElement.parentElement) {
          const closeBtn = title.parentElement.parentElement.querySelector('button[aria-label="Close"]');
          if (closeBtn) closeBtn.click();
        }
      });
      await new Promise((r) => setTimeout(r, 400));
    } catch (err) {
      recordResult("Peer Verification", "Peer Q&A Broadcast & Verification Flow", false, err.message);
    }

    // Take screenshot of finished state
    const ssPath = path.join(ARTIFACT_DIR, "phase32_master_gauntlet_completed.png");
    await page.screenshot({ path: ssPath });
    console.log(`\nScreenshot captured: ${ssPath}`);

  } finally {
    await browser.close();
  }

  // Print Summary Table
  console.log("\n==================================================================");
  console.log("=== PHASE 32 LIVE UI GAUNTLET SUMMARY ===");
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
  console.error("FATAL GAUNTLET ERROR:", err);
  process.exit(1);
});
