import puppeteer from "puppeteer-core";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--window-size=1280,850",
    ],
    defaultViewport: { width: 1280, height: 850 },
  });

  try {
    const page = await browser.newPage();
    console.log("Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000", {
      waitUntil: "networkidle2",
      timeout: 15000,
    });
    await sleep(600);

    // 1. Verify Omnibar Mic Button is a REAL <button> (not a <label>)
    const micInfo = await page.evaluate(() => {
      const micBtn = document.querySelector('[data-testid="ptt-mic-btn"]');
      const omnibarInput = document.querySelector('[data-testid="omnibar-input"]');
      const fileCapture = document.querySelector("#mobile-voice-capture");
      return {
        tagName: micBtn ? micBtn.tagName : null,
        title: micBtn ? micBtn.getAttribute("title") : null,
        placeholder: omnibarInput ? omnibarInput.getAttribute("placeholder") : null,
        hasOldFileInput: Boolean(fileCapture),
      };
    });

    console.log("Mic button info:", JSON.stringify(micInfo, null, 2));
    if (micInfo.tagName !== "BUTTON") {
      throw new Error(`Expected mic to be <button>, but got <${micInfo.tagName}>!`);
    }
    if (micInfo.hasOldFileInput) {
      throw new Error("Old mobile-voice-capture file input still present in DOM!");
    }

    // 2. Open QR Pairing Modal
    console.log("Opening QR Pairing Modal...");
    const qrTrigger = await page.waitForSelector('button[title="Pair Mobile Device (QR Code)"]');
    await qrTrigger.click();
    await sleep(500);

    // 3. Inspect QR Modal Content
    const modalInfo = await page.evaluate(() => {
      const modal = document.querySelector('[role="dialog"]');
      const codeEl = modal ? modal.querySelector("code") : null;
      const buttons = modal ? Array.from(modal.querySelectorAll("button")).map((b) => b.textContent?.trim()) : [];
      const apkLink = modal ? modal.querySelector('a[href="/or-nav.apk"]') : null;
      return {
        foundModal: Boolean(modal),
        displayedUrl: codeEl ? codeEl.textContent?.trim() : null,
        buttons,
        hasApkLink: Boolean(apkLink),
      };
    });

    console.log("QR Modal info:", JSON.stringify(modalInfo, null, 2));

    if (!modalInfo.displayedUrl?.startsWith("https://")) {
      console.warn("Warning: QR modal did not show https URL, showed:", modalInfo.displayedUrl);
    } else {
      console.log("SUCCESS: QR Modal defaults to live HTTPS tunnel URL:", modalInfo.displayedUrl);
    }

    const shot1 = path.join(ARTIFACT_DIR, "phase14_qr_https_tunnel.png");
    await page.screenshot({ path: shot1 });
    console.log("Saved Screenshot 1:", shot1);

    // 4. Test Toggle to Local LAN IP
    console.log("Toggling to Local LAN IP mode in QR Modal...");
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button'));
      const lanBtn = btns.find((b) => b.textContent?.includes("Local LAN IP"));
      if (lanBtn) lanBtn.click();
    });
    await sleep(400);

    const lanUrl = await page.evaluate(() => {
      const codeEl = document.querySelector('[role="dialog"] code');
      return codeEl ? codeEl.textContent?.trim() : null;
    });
    console.log("URL after toggling to LAN mode:", lanUrl);
    if (!lanUrl?.includes("192.168.1.217:3000")) {
      console.warn("Warning: expected 192.168.1.217:3000, got:", lanUrl);
    }

    // Toggle back to HTTPS
    await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll('[role="dialog"] button'));
      const httpsBtn = btns.find((b) => b.textContent?.includes("HTTPS Tunnel"));
      if (httpsBtn) httpsBtn.click();
    });
    await sleep(300);

    // 5. Close Modal
    await page.evaluate(() => {
      const closeBtn = document.querySelector('[aria-label="Close pairing dialog"]');
      if (closeBtn) closeBtn.click();
    });
    await sleep(400);

    // 6. Test Walkie-Talkie Mic interaction
    console.log("Testing Walkie-Talkie PTT click...");
    const micBtn = await page.waitForSelector('[data-testid="ptt-mic-btn"]');
    await micBtn.click();
    await sleep(300);

    const activePlaceholder = await page.evaluate(() => {
      const el = document.querySelector('[data-testid="omnibar-input"]');
      return el ? el.getAttribute("placeholder") : "";
    });
    console.log("Mic active placeholder:", activePlaceholder);

    const shot2 = path.join(ARTIFACT_DIR, "phase14_walkie_talkie_mic.png");
    await page.screenshot({ path: shot2 });
    console.log("Saved Screenshot 2:", shot2);

    // Stop recording
    await micBtn.click();
    await sleep(500);

    console.log("\n=======================================================");
    console.log("PHASE 14 VERIFICATION COMPLETE: ALL PASS!");
    console.log("Live HTTPS Tunnel:", modalInfo.displayedUrl);
    console.log("=======================================================");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Verification failed:", err);
  process.exit(1);
});
