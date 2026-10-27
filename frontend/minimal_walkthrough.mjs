import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH = "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

async function runMinimalWalkthrough() {
  console.log("Launching Chrome for Testing...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    // =========================================================================
    // 1. Screenshot 1: Clean Empty State (Desktop 1440x900)
    // =========================================================================
    console.log("1. Capturing Clean Empty State on http://localhost:3000...");
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1440, height: 920 });
    await desktopPage.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await desktopPage.waitForSelector("aside", { timeout: 10000 });
    await desktopPage.waitForFunction(
      () => document.body.innerText.includes("What do you need for this case?"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1000));

    const shot1 = path.join(ARTIFACT_DIR, "minimal_clean_empty_state.png");
    await desktopPage.screenshot({ path: shot1, fullPage: false });
    console.log(`Screenshot 1 saved: ${shot1}`);

    // =========================================================================
    // 2. Screenshot 2: Minimalist Coordinate Card Collapsed (Desktop 1440x900)
    // =========================================================================
    console.log("2. Querying 'where is 3-0 silk' on desktop...");
    // Click the first starter button
    const starterBtn = await desktopPage.$("button");
    const clicked = await desktopPage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find((btn) => btn.innerText.includes("Where is 3-0 Silk?"));
      if (b) {
        b.click();
        return true;
      }
      return false;
    });

    if (!clicked) {
      const input = await desktopPage.waitForSelector("input[type='text']");
      await input.type("where is 3-0 silk");
      await desktopPage.keyboard.press("Enter");
    }

    console.log("Waiting for minimalist CoordinateCard...");
    await desktopPage.waitForFunction(
      () => document.body.innerText.includes("OR 21") && document.body.innerText.includes("Surgeon notes & relocation options"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1200));

    const shot2 = path.join(ARTIFACT_DIR, "minimal_coordinate_card_collapsed.png");
    await desktopPage.screenshot({ path: shot2, fullPage: false });
    console.log(`Screenshot 2 saved: ${shot2}`);

    // =========================================================================
    // 3. Screenshot 3: Mobile View (390x844 on http://192.168.1.217:3000) with Expanded Details
    // =========================================================================
    console.log("3. Emulating iPhone 14 Pro on http://192.168.1.217:3000...");
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

    // Click starter button on mobile
    console.log("Clicking 'Where is 3-0 Silk?' on mobile...");
    await mobilePage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const b = btns.find((btn) => btn.innerText.includes("Where is 3-0 Silk?"));
      if (b) b.click();
    });

    console.log("Waiting for CoordinateCard to appear on mobile...");
    await mobilePage.waitForFunction(
      () => document.body.innerText.includes("OR 21") && document.body.innerText.includes("Surgeon notes"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1000));

    // Expand the progressive disclosure details toggle
    console.log("Expanding progressive disclosure toggle on mobile...");
    await mobilePage.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const toggle = btns.find((btn) => btn.innerText.includes("Surgeon notes"));
      if (toggle) toggle.click();
    });

    console.log("Waiting for surgeon note to expand...");
    await mobilePage.waitForFunction(
      () => document.body.innerText.includes("Dr. Chen") || document.body.innerText.includes("Surgeon Note"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1200));

    const shot3 = path.join(ARTIFACT_DIR, "minimal_coordinate_card_mobile_expanded.png");
    await mobilePage.screenshot({ path: shot3, fullPage: false });
    console.log(`Screenshot 3 saved: ${shot3}`);

    console.log("All minimalist walkthrough screenshots captured successfully!");
  } finally {
    await browser.close();
  }
}

runMinimalWalkthrough().catch((err) => {
  console.error("Minimal walkthrough failed:", err);
  process.exit(1);
});
