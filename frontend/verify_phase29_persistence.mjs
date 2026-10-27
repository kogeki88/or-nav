import puppeteer from "puppeteer-core";
import path from "path";
import fs from "fs";

const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";
const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";

async function run() {
  console.log("=== PHASE 29.1 PERSISTENCE & MULTI-SESSION GAUNTLET ===");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });

    console.log("Step 1: Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 15000 });

    // Ensure clean state for test
    await page.evaluate(() => {
      localStorage.removeItem("ornav_active_case_or_main");
      localStorage.removeItem("ornav_active_session_id_or_main");
      localStorage.removeItem("ornav_chat_sessions_index_or_main");
    });
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise(r => setTimeout(r, 800));

    // Verify initial Recent Cases toggle exists
    const recentCasesToggle = await page.$('[data-testid="recent-cases-toggle"]');
    if (!recentCasesToggle) {
      throw new Error("Recent Cases toggle not found in Sidebar!");
    }
    console.log("✓ Recent Cases toggle verified in Sidebar.");

    // Step 2: Send Message 1 in Case 1
    console.log("Step 2: Sending query 'Find DeBakey Forceps in OR 4'...");
    const omnibar = await page.$('[data-testid="omnibar-input"]');
    if (!omnibar) throw new Error("Omnibar input not found");

    await omnibar.type("Find DeBakey Forceps in OR 4");
    await page.keyboard.press("Enter");

    // Wait for response message
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="chat-message-bubble"], .rounded-2xl').length > 0,
      { timeout: 8000 }
    );
    await new Promise(r => setTimeout(r, 1200));

    // Verify localStorage has persisted active case
    const storedCase1 = await page.evaluate(() => {
      return localStorage.getItem("ornav_active_case_or_main");
    });
    console.log("Stored Active Case in localStorage:", storedCase1 ? "EXISTS (" + storedCase1.length + " bytes)" : "MISSING!");
    if (!storedCase1) throw new Error("Active case failed to save to localStorage!");

    const parsedCase1 = JSON.parse(storedCase1);
    if (!Array.isArray(parsedCase1) || parsedCase1.length === 0) {
      throw new Error("Active case JSON in localStorage is not an array or is empty!");
    }
    console.log(`✓ Active case saved ${parsedCase1.length} message(s) to localStorage.`);

    // Verify Recent Cases section displays the session
    const caseItemsCount = await page.$$eval('[data-testid^="recent-case-item-"]', els => els.length);
    console.log(`Recent Cases list contains ${caseItemsCount} session(s).`);
    if (caseItemsCount === 0) {
      throw new Error("Recent Cases list did not display active session!");
    }

    // Capture screenshot of Active Case 1
    const ss1Path = path.join(ARTIFACT_DIR, "phase29_1_active_case.png");
    await page.screenshot({ path: ss1Path });
    console.log(`✓ Saved screenshot: ${ss1Path}`);

    // Step 3: SIMULATE COMPLETE APP EXIT & RESTART
    console.log("Step 3: Simulating app exit & restart (navigating to about:blank then returning)...");
    await page.goto("about:blank");
    await new Promise(r => setTimeout(r, 500));

    console.log("Reopening app at http://localhost:3000...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 15000 });
    await new Promise(r => setTimeout(r, 1000));

    // Verify messages were restored from localStorage and NOT wiped by initial render
    const restoredText = await page.evaluate(() => {
      const texts = Array.from(document.querySelectorAll("body *")).map(el => el.textContent || "");
      return texts.some(t => t.includes("DeBakey Forceps"));
    });
    console.log("Messages restored after restart:", restoredText);
    if (!restoredText) {
      throw new Error("CHAT DISAPPEARED ON RESTART! localStorage hydration failed!");
    }
    console.log("✓ SUCCESS: Active case messages persisted and restored across app restart!");

    const ss2Path = path.join(ARTIFACT_DIR, "phase29_1_restored_after_restart.png");
    await page.screenshot({ path: ss2Path });
    console.log(`✓ Saved screenshot: ${ss2Path}`);

    // Step 4: Click + New Case
    console.log("Step 4: Clicking '+ New Case' button...");
    const newCaseBtn = await page.$('[data-testid="sidebar-new-case-btn"]');
    if (!newCaseBtn) throw new Error("+ New Case button not found");
    await newCaseBtn.click();
    await new Promise(r => setTimeout(r, 800));

    // Verify canvas is now empty
    const activeCaseAfterNew = await page.evaluate(() => {
      return localStorage.getItem("ornav_active_case_or_main");
    });
    console.log("Active case in localStorage after + New Case:", activeCaseAfterNew);
    if (activeCaseAfterNew) {
      throw new Error("Active case was not cleared on + New Case!");
    }

    // Verify past session is still in Recent Cases list
    const pastCasesCount = await page.$$eval('[data-testid^="recent-case-item-"]', els => els.length);
    console.log(`Recent Cases list after + New Case: ${pastCasesCount} session(s).`);
    if (pastCasesCount < 1) {
      throw new Error("Past case was lost when clicking + New Case!");
    }
    console.log("✓ Past case was safely archived into Recent Cases.");

    // Step 5: Send a message in Case 2
    console.log("Step 5: Sending query in Case 2: 'Locate 3-0 Prolene Suture'...");
    const omnibar2 = await page.$('[data-testid="omnibar-input"]');
    await omnibar2.type("Locate 3-0 Prolene Suture");
    await page.keyboard.press("Enter");
    await new Promise(r => setTimeout(r, 1500));

    const totalSessions = await page.$$eval('[data-testid^="recent-case-item-"]', els => els.length);
    console.log(`Total sessions in Recent Cases now: ${totalSessions}`);

    // Step 6: Click back to Case 1 in Recent Cases list
    console.log("Step 6: Switching back to Case 1 from Recent Cases list...");
    const sessionItems = await page.$$('[data-testid^="recent-case-item-"]');
    // Click the second session (the older DeBakey one)
    if (sessionItems.length >= 2) {
      await sessionItems[1].click();
      await new Promise(r => setTimeout(r, 800));

      const hasDeBakeyAgain = await page.evaluate(() => {
        return document.body.textContent?.includes("DeBakey Forceps");
      });
      console.log("DeBakey Forceps restored to canvas after clicking past case:", hasDeBakeyAgain);
      if (!hasDeBakeyAgain) {
        throw new Error("Failed to restore past case messages to canvas on session switch!");
      }
      console.log("✓ SUCCESS: Switching between past cases works seamlessly!");
    }

    const ss3Path = path.join(ARTIFACT_DIR, "phase29_1_case_switcher.png");
    await page.screenshot({ path: ss3Path });
    console.log(`✓ Saved screenshot: ${ss3Path}`);

    console.log("\n=======================================================");
    console.log("🎉 ALL PHASE 29.1 PERSISTENCE GAUNTLET CHECKS PASSED!");
    console.log("=======================================================");
  } finally {
    await browser.close();
  }
}

run().catch((err) => {
  console.error("❌ Verification failed:", err);
  process.exit(1);
});
