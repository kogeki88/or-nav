import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR = "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH = "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

async function runMobileWalkthrough() {
  console.log("Launching Chrome for Testing...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--window-size=1440,920"],
    defaultViewport: { width: 1440, height: 920 },
  });

  try {
    const desktopPage = await browser.newPage();
    console.log("1. Navigating to http://localhost:3000...");
    await desktopPage.goto("http://localhost:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await desktopPage.waitForSelector("header", { timeout: 10000 });
    await new Promise((r) => setTimeout(r, 1000));

    // Open QR Pairing Modal via Header "PAIR BADGE" button
    console.log("2. Opening QR Code Pairing Modal...");
    const headerBtns = await desktopPage.$$("header button");
    let pairBtnClicked = false;
    for (const btn of headerBtns) {
      const text = await desktopPage.evaluate((el) => el.innerText, btn);
      if (text.includes("PAIR")) {
        await btn.click();
        pairBtnClicked = true;
        break;
      }
    }

    if (!pairBtnClicked) {
      // Fallback: click from sidebar
      const sidebarBtns = await desktopPage.$$("aside button");
      for (const btn of sidebarBtns) {
        const text = await desktopPage.evaluate((el) => el.innerText, btn);
        if (text.includes("Mobile / Badge Pair")) {
          await btn.click();
          pairBtnClicked = true;
          break;
        }
      }
    }

    console.log("Waiting for QR Code image and LAN IP to render in dialog...");
    await desktopPage.waitForSelector("div[role='dialog'] img", { timeout: 10000 });
    await desktopPage.waitForFunction(
      () => document.body.innerText.includes("192.168.") || document.body.innerText.includes("Mobile / Badge"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1000));

    const shotE = path.join(ARTIFACT_DIR, "step_e_qr_pairing_modal.png");
    await desktopPage.screenshot({ path: shotE, fullPage: false });
    console.log(`Step E (QR Pairing Modal) screenshot saved: ${shotE}`);

    // =========================================================================
    // Mobile Emulation Test: iPhone 14 Pro over LAN IP (192.168.1.217:3000)
    // =========================================================================
    console.log("3. Emulating iPhone 14 Pro connecting over LAN IP...");
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({
      width: 393,
      height: 852,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 2,
    });
    await mobilePage.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1"
    );

    console.log("Connecting mobile viewport to http://192.168.1.217:3000...");
    await mobilePage.goto("http://192.168.1.217:3000", { waitUntil: "networkidle2", timeout: 15000 });
    await mobilePage.waitForSelector("header", { timeout: 10000 });
    console.log("Mobile page loaded successfully over LAN IP.");

    // Send query on mobile device
    console.log("Typing 'where is 3-0 silk' in mobile Omnibar...");
    const mobileTextarea = await mobilePage.waitForSelector("textarea", { timeout: 10000 });
    await mobileTextarea.type("where is 3-0 silk");

    // Click submit button on mobile
    const sendBtn = await mobilePage.$("form button[type='submit']");
    if (sendBtn) {
      await sendBtn.click();
    } else {
      await mobilePage.keyboard.press("Enter");
    }

    console.log("Waiting for CoordinateCard to render on mobile screen...");
    await mobilePage.waitForFunction(
      () => document.body.innerText.includes("OR 21") && document.body.innerText.includes("3-0 Silk Suture"),
      { timeout: 10000 }
    );
    await new Promise((r) => setTimeout(r, 1200));

    const shotF = path.join(ARTIFACT_DIR, "step_f_mobile_handheld_badge.png");
    await mobilePage.screenshot({ path: shotF, fullPage: false });
    console.log(`Step F (Mobile Handheld Badge) screenshot saved: ${shotF}`);

    // =========================================================================
    // Mobile Drawer Test: Open mobile navigation drawer
    // =========================================================================
    console.log("4. Opening mobile navigation drawer...");
    const hamburgerBtn = await mobilePage.$("header button");
    if (hamburgerBtn) {
      await hamburgerBtn.click();
      await new Promise((r) => setTimeout(r, 800));
      const shotG = path.join(ARTIFACT_DIR, "step_g_mobile_drawer.png");
      await mobilePage.screenshot({ path: shotG, fullPage: false });
      console.log(`Step G (Mobile Drawer) screenshot saved: ${shotG}`);
    }

    console.log("All mobile walkthrough tests completed successfully!");
  } finally {
    await browser.close();
  }
}

runMobileWalkthrough().catch((err) => {
  console.error("Mobile walkthrough failed:", err);
  process.exit(1);
});
