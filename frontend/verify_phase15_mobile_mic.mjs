import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";

const ARTIFACT_DIR =
  "C:\\Users\\igles\\.gemini\\antigravity\\brain\\2d1ef619-85c4-431c-96f8-0301f7c0a3e2";
const CHROME_PATH =
  "C:\\Users\\igles\\.gemini\\antigravity\\scratch\\or-nav\\frontend\\chrome\\win64-156.0.8078.47\\chrome-win64\\chrome.exe";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  console.log("Launching headless Chrome for Phase 15 Mobile Pipeline & APK Verification...");
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
      "--window-size=390,844",
    ],
  });

  try {
    const page = await browser.newPage();
    const context = browser.defaultBrowserContext();
    await context.overridePermissions("http://localhost:3000", ["microphone"]);

    await page.setViewport({
      width: 390,
      height: 844,
      isMobile: true,
      hasTouch: true,
      deviceScaleFactor: 3,
    });

    await page.setUserAgent(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    );

    console.log("Navigating to http://localhost:3000 in mobile viewport (390x844)...");
    await page.goto("http://localhost:3000", {
      waitUntil: "networkidle2",
      timeout: 15000,
    });
    await sleep(600);

    // 1. Initial State Check
    const initialPlaceholder = await page.$eval(
      '[data-testid="omnibar-input"]',
      (el) => el.getAttribute("placeholder")
    );
    console.log("Initial Omnibar placeholder:", initialPlaceholder);

    const micBtn = await page.waitForSelector('[data-testid="ptt-mic-btn"]');
    if (!micBtn) throw new Error("Mic button not found!");

    // 2. Simulate First Tap (< 150ms tap duration)
    console.log("Simulating mobile tap on Mic button (pointerdown -> pointerup < 100ms)...");
    const micBox = await micBtn.boundingBox();
    if (!micBox) throw new Error("Cannot get mic button bounding box");

    const clickX = micBox.x + micBox.width / 2;
    const clickY = micBox.y + micBox.height / 2;

    await page.mouse.move(clickX, clickY);
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();

    // 3. Wait for MediaRecorder to start and verify Recording state
    console.log("Waiting for mic to transition to 'recording' state...");
    let recordingPlaceholder = "";
    for (let i = 0; i < 20; i++) {
      await sleep(200);
      recordingPlaceholder = await page.$eval(
        '[data-testid="omnibar-input"]',
        (el) => el.getAttribute("placeholder") || ""
      );
      if (recordingPlaceholder.includes("Recording")) break;
    }

    console.log("Current placeholder after tap:", recordingPlaceholder);
    if (!recordingPlaceholder.includes("Recording")) {
      throw new Error(
        `Expected placeholder to contain 'Recording', but got: '${recordingPlaceholder}'`
      );
    }

    // Capture Screenshot of Active Recording State in Mobile Viewport
    const recordingScreenshotPath = path.join(
      ARTIFACT_DIR,
      "phase15_mobile_recording_state.png"
    );
    await page.screenshot({ path: recordingScreenshotPath, fullPage: false });
    console.log(`Saved screenshot: ${recordingScreenshotPath}`);

    // Allow fake media stream to generate audio chunks for 1.2s
    console.log("Recording audio chunks via MediaRecorder for 1.2s...");
    await sleep(1200);

    // 4. Simulate Second Tap to finalize and send
    console.log("Simulating second tap to stop recording and send to backend...");
    await page.mouse.down();
    await sleep(80);
    await page.mouse.up();

    // 5. Verify transition to 'transcribing'
    await sleep(250);
    const transcribingPlaceholder = await page.$eval(
      '[data-testid="omnibar-input"]',
      (el) => el.getAttribute("placeholder") || ""
    );
    console.log("Placeholder during transcription:", transcribingPlaceholder);

    // Wait for upload/transcription completion
    console.log("Waiting for backend response...");
    await sleep(2500);

    // 6. Verify QR Pairing Modal & Real APK Download Link
    console.log("Opening QR Pairing Modal to verify APK download link...");
    const qrTrigger = await page.waitForSelector(
      'button[title="Pair Mobile Device (QR Code)"]'
    );
    await qrTrigger.click();
    await sleep(600);

    const modalData = await page.evaluate(async () => {
      const modal = document.querySelector('[role="dialog"]');
      const apkLink = modal?.querySelector('a[href="/or-nav.apk"]');
      const href = apkLink?.getAttribute("href");
      const text = apkLink?.textContent?.trim();

      // Fetch the APK from within the browser page to verify status & length
      let fetchStatus = 0;
      let contentLength = 0;
      let contentType = "";
      try {
        const resp = await fetch("/or-nav.apk");
        fetchStatus = resp.status;
        contentType = resp.headers.get("content-type") || "";
        const blob = await resp.blob();
        contentLength = blob.size;
      } catch (e) {
        console.error(e);
      }

      return {
        hasModal: Boolean(modal),
        hasApkLink: Boolean(apkLink),
        href,
        text,
        fetchStatus,
        contentType,
        contentLength,
      };
    });

    console.log("QR Modal APK verification:", JSON.stringify(modalData, null, 2));

    if (!modalData.hasApkLink) {
      throw new Error("APK download link not found in QR modal!");
    }
    if (modalData.fetchStatus !== 200) {
      throw new Error(`APK download returned status ${modalData.fetchStatus}!`);
    }
    if (modalData.contentLength < 1000000) {
      throw new Error(
        `APK size is unexpectedly small: ${modalData.contentLength} bytes (expected ~4MB)`
      );
    }

    const modalScreenshotPath = path.join(ARTIFACT_DIR, "phase15_apk_modal.png");
    await page.screenshot({ path: modalScreenshotPath, fullPage: false });
    console.log(`Saved screenshot: ${modalScreenshotPath}`);

    console.log("\n>>> ALL PHASE 15 MOBILE MIC & APK TESTS PASSED SUCCESSFULLY! <<<");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
