import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH = "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

async function runTelemetryWalkthrough() {
  console.log("Launching Chrome for Testing...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    // =========================================================================
    // 1. Desktop Telemetry Walkthrough (1440x900)
    // =========================================================================
    console.log("1. Loading Desktop view on http://localhost:3000...");
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1440, height: 920 });
    await desktopPage.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await desktopPage.waitForSelector("aside", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Submit "where is 3-0 silk"
    console.log("Querying 'where is 3-0 silk'...");
    const textarea = await desktopPage.waitForSelector("textarea", { timeout: 10000 });
    await textarea.type("where is 3-0 silk");
    await desktopPage.keyboard.press("Enter");

    // Wait for the hardware telemetry CoordinateCard
    console.log("Waiting for hardware telemetry CoordinateCard...");
    await desktopPage.waitForFunction(
      () => document.body.innerText.includes("SURGICAL STORAGE COORDINATES") && document.body.innerText.includes("OR 21"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1200));

    const shot1 = path.join(ARTIFACT_DIR, "telemetry_desktop_coordinate_card.png");
    await desktopPage.screenshot({ path: shot1, fullPage: false });
    console.log(`Screenshot 1 saved: ${shot1}`);

    // =========================================================================
    // 2. Mobile Handheld Badge View (390x844 on http://192.168.1.217:3000)
    // =========================================================================
    console.log("2. Loading Mobile View (390x844) over LAN IP http://192.168.1.217:3000...");
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await mobilePage.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
    );
    await mobilePage.goto("http://192.168.1.217:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await mobilePage.waitForSelector("header", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Tap the mobile quick starter chip on the horizontal swipeable ribbon
    console.log("Tapping mobile quick-action chip on horizontal ribbon...");
    const chipClicked = await mobilePage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const chip = btns.find((b) => b.innerText.includes("Where is 3-0 Silk?"));
      if (chip) {
        chip.click();
        return true;
      }
      return false;
    });

    if (!chipClicked) {
      console.log("Chip not clicked via evaluate, typing in Omnibar...");
      const mText = await mobilePage.waitForSelector("textarea");
      await mText.type("where is 3-0 silk");
      await mobilePage.keyboard.press("Enter");
    }

    console.log("Waiting for mobile coordinate grid to render...");
    await mobilePage.waitForFunction(
      () => document.body.innerText.includes("OR 21") && document.body.innerText.includes("3-0 Silk"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1500));

    const shot2 = path.join(ARTIFACT_DIR, "telemetry_mobile_handheld_badge.png");
    await mobilePage.screenshot({ path: shot2, fullPage: false });
    console.log(`Screenshot 2 saved: ${shot2}`);

    // =========================================================================
    // 3. Active PTT State + Segmented Move Widget
    // =========================================================================
    console.log("3. Testing Active PTT State & Segmented Move Widget...");
    // Click the sidebar chip "Report Move: 3-0 Silk"
    console.log("Clicking sidebar starter chip 'Report Move: 3-0 Silk'...");
    const moveChipClicked = await desktopPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("aside button"));
      const chip = btns.find((b) => b.innerText.includes("Report Move: 3-0 Silk"));
      if (chip) {
        chip.click();
        return true;
      }
      return false;
    });

    if (!moveChipClicked) {
      console.log("Sidebar chip not clicked via evaluate, clicking via querySelector...");
      const allBtns = await desktopPage.$$("aside button");
      for (const btn of allBtns) {
        const text = await desktopPage.evaluate((el) => el.innerText, btn);
        if (text.includes("Report Move")) {
          await btn.click();
          break;
        }
      }
    }

    console.log("Waiting for MoveVerifyWidget...");
    await desktopPage.waitForFunction(
      () => document.body.innerText.includes("Crowdsourced Relocation Protocol") || document.body.innerText.includes("Consensus Target"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1200));

    // Click verify move once to show 1/3 progress
    console.log("Clicking verify move to show 1/3 progress...");
    await desktopPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const vBtn = btns.find((b) => b.innerText.includes("Verify Move"));
      if (vBtn) vBtn.click();
    });
    await new Promise((r) => setTimeout(r, 1200));

    // Trigger PTT mouse down on desktop
    console.log("Holding down PTT mic button to activate pulsing recording state...");
    const micBtn = await desktopPage.$("button[title*='Hold to speak']");
    if (micBtn) {
      const box = await micBtn.boundingBox();
      if (box) {
        await desktopPage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await desktopPage.mouse.down();
      }
    }
    await new Promise((r) => setTimeout(r, 1000));

    const shot3 = path.join(ARTIFACT_DIR, "telemetry_active_ptt_and_move_widget.png");
    await desktopPage.screenshot({ path: shot3, fullPage: false });
    console.log(`Screenshot 3 saved: ${shot3}`);

    if (micBtn) {
      await desktopPage.mouse.up();
    }

    console.log("All telemetry walkthrough screenshots captured successfully!");
  } finally {
    await browser.close();
  }
}

runTelemetryWalkthrough().catch((err) => {
  console.error("Walkthrough failed:", err);
  process.exit(1);
});
