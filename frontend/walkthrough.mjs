import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH = "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

async function runWalkthrough() {
  console.log("Launching Chrome for Testing...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    const page = await browser.newPage();
    console.log("Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });

    // Ensure page loaded
    await page.waitForSelector("aside", { timeout: 10000 });
    console.log("Dashboard loaded successfully.");
    await new Promise((r) => setTimeout(r, 1000));

    // =========================================================================
    // Smoke Test A: Click "Where is 3-0 Silk?" starter chip
    // =========================================================================
    console.log("Executing Step A: Starter chip 'Where is 3-0 Silk?'...");
    const chipSelector = "button";
    const buttons = await page.$$(chipSelector);
    let clickedChip = false;
    for (const btn of buttons) {
      const text = await page.evaluate((el) => el.innerText, btn);
      if (text.includes("Where is 3-0 Silk?")) {
        await btn.click();
        clickedChip = true;
        break;
      }
    }

    if (!clickedChip) {
      throw new Error("Could not find 'Where is 3-0 Silk?' starter chip");
    }

    // Wait for the Coordinate Card to render with OR 21
    console.log("Waiting for CoordinateCard to appear...");
    await page.waitForFunction(
      () => document.body.innerText.includes("OR 21") && document.body.innerText.includes("3-0 Silk Suture"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1500));

    const shotA = path.join(ARTIFACT_DIR, "step_a_coordinate_card.png");
    await page.screenshot({ path: shotA, fullPage: false });
    console.log(`Step A screenshot saved: ${shotA}`);

    // =========================================================================
    // Smoke Test B: Submit PHI query in Omnibar
    // =========================================================================
    console.log("Executing Step B: Submit PHI query...");
    const textareaSelector = "textarea";
    await page.waitForSelector(textareaSelector);
    await page.type(textareaSelector, "Patient John Smith MRN 9384721 needs 4-0 prolene");

    // Click submit button (Send icon)
    await page.keyboard.press("Enter");

    // Wait for assistant response with AMBIENT PHI SCRUBBED badge
    console.log("Waiting for PHI scrubbed response...");
    await page.waitForFunction(
      () => document.body.innerText.includes("AMBIENT PHI SCRUBBED") && document.body.innerText.includes("4-0 Prolene Suture"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1500));

    const shotB = path.join(ARTIFACT_DIR, "step_b_phi_scrubbed.png");
    await page.screenshot({ path: shotB, fullPage: false });
    console.log(`Step B screenshot saved: ${shotB}`);

    // =========================================================================
    // Smoke Test C: Natural language move + verify button clicks (1/3 -> 2/3 -> 3/3)
    // =========================================================================
    console.log("Executing Step C: Relocation and verification consensus...");
    await page.type(textareaSelector, "The 3-0 silk moved to OR 21 C 4 B");
    await page.keyboard.press("Enter");

    // Wait for Move widget to appear
    console.log("Waiting for MoveVerifyWidget (1/3)...");
    await page.waitForFunction(
      () => document.body.innerText.includes("Verify Move (1/3)") || document.body.innerText.includes("Crowdsourced Relocation Protocol"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1000));

    // Click Verify Move button (1/3 -> 2/3)
    console.log("Clicking Verify Move (1/3 -> 2/3)...");
    const clickVerifyBtn = async () => {
      const allBtns = await page.$$("button");
      for (const b of allBtns) {
        const txt = await page.evaluate((el) => el.innerText, b);
        if (txt.includes("Verify Move")) {
          await b.click();
          return true;
        }
      }
      return false;
    };

    await clickVerifyBtn();
    await new Promise((r) => setTimeout(r, 1200));

    // Click Verify Move button (2/3 -> 3/3 committed)
    console.log("Clicking Verify Move (2/3 -> 3/3 auto-commit)...");
    await clickVerifyBtn();

    // Wait for "Location Committed to Master CSV" badge
    console.log("Waiting for committed badge...");
    await page.waitForFunction(
      () => document.body.innerText.includes("Location Committed to Master CSV"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1500));

    const shotC = path.join(ARTIFACT_DIR, "step_c_move_committed.png");
    await page.screenshot({ path: shotC, fullPage: false });
    console.log(`Step C screenshot saved: ${shotC}`);

    // Full overview shot
    const shotOverview = path.join(ARTIFACT_DIR, "step_d_full_workspace.png");
    await page.screenshot({ path: shotOverview, fullPage: false });
    console.log(`Full overview screenshot saved: ${shotOverview}`);

    console.log("All visual smoke tests completed successfully!");
  } finally {
    await browser.close();
  }
}

runWalkthrough().catch((err) => {
  console.error("Walkthrough failed:", err);
  process.exit(1);
});
