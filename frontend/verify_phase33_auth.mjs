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
  console.log("=== PHASE 33 AUTHENTICATION & FIRST-TIME ONBOARDING GAUNTLET ===");
  console.log("==================================================================\n");

  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 850 });

    console.log("Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000", { waitUntil: "networkidle0", timeout: 15000 });

    // Step 1: Ensure clean logged-out state
    console.log("\n--- [STEP 1] Logged-Out State & AuthScreen Rendering ---");
    await page.evaluate(() => {
      localStorage.removeItem("ornav_active_session");
    });
    await page.reload({ waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 600));

    const loginEmailInput = await page.waitForSelector('[data-testid="input-login-email"]', { timeout: 5000 });
    const authScreenVisible = Boolean(loginEmailInput);
    recordResult("Auth UI", "AuthScreen Displays on Logged-Out Visit", authScreenVisible, "Sign In form rendered");

    // Step 2: Switch to Register Mode & Create New Account
    console.log("\n--- [STEP 2] Create Account Flow ---");
    const linkRegister = await page.waitForSelector('[data-testid="link-register"]', { timeout: 4000 });
    await linkRegister.click();
    await new Promise((r) => setTimeout(r, 400));

    const testEmail = `dr.dorian.${Date.now()}@sacredheart.org`;
    const testFullName = "Dr. John Dorian, MD";
    const initialPassword = "eagletime123";

    await page.type('[data-testid="input-register-fullname"]', testFullName);
    await page.type('[data-testid="input-register-email"]', testEmail);
    await page.type('[data-testid="input-register-password"]', initialPassword);
    await page.type('[data-testid="input-register-confirm"]', initialPassword);

    const btnRegister = await page.waitForSelector('[data-testid="btn-register-submit"]', { timeout: 4000 });
    await btnRegister.click();
    await new Promise((r) => setTimeout(r, 1200));

    // Step 3: First-Time Login Onboarding Profile Modal Auto-Popup
    console.log("\n--- [STEP 3] First-Time Profile Onboarding Auto-Popup ---");
    const profileModalTitle = await page.waitForSelector("#profile-modal-title", { timeout: 6000 });
    const modalText = await page.evaluate(() => document.body.innerText);
    const onboardingPopupVisible = modalText.includes("Profile Setup") || modalText.includes("Profile");
    const isFirstTimeBadge = modalText.includes("First-Time");

    recordResult(
      "Onboarding",
      "Profile Modal Auto-Pops on First Login",
      onboardingPopupVisible,
      isFirstTimeBadge ? "First-Time Setup badge verified" : "Modal rendered"
    );

    // Verify prefilled name matches registered name
    const prefilledName = await page.$eval('[data-testid="input-fullname"]', (el) => el.value);
    const nameMatches = prefilledName === testFullName;
    recordResult("Onboarding", "Full Name Prefilled from Registration", nameMatches, prefilledName);

    // Step 4: Complete Profile Setup (Select Facility, Department, Role)
    console.log("\n--- [STEP 4] Complete First-Time Clinical Assignment ---");
    await page.select('[data-testid="select-facility"]', "princeton_plainsboro");
    await new Promise((r) => setTimeout(r, 200));
    await page.select('[data-testid="select-department"]', "icu_critical_care");
    await new Promise((r) => setTimeout(r, 200));
    await page.select('[data-testid="select-role"]', "ICU RN");
    await new Promise((r) => setTimeout(r, 200));

    const saveBtn = await page.waitForSelector('[data-testid="button-save-profile"]', { timeout: 4000 });
    await saveBtn.click();
    await new Promise((r) => setTimeout(r, 1200));

    // Verify modal is closed and workspace is active
    const modalClosed = await page.evaluate(() => document.querySelector("#profile-modal-title") === null);
    const omnibarActive = await page.evaluate(() => document.querySelector('[data-testid="omnibar-input"]') !== null);
    const headerBadgeText = await page.$eval('[data-testid="header-profile-badge"]', (el) => el.textContent || "");
    const headerUpdated = headerBadgeText.includes("Dr. John Dorian") && headerBadgeText.includes("ICU");

    recordResult(
      "Onboarding",
      "Onboarding Completed & Workspace Unlocked",
      modalClosed && omnibarActive && headerUpdated,
      headerBadgeText.trim()
    );

    // Step 5: Sign Out
    console.log("\n--- [STEP 5] Sign Out Action ---");
    const signoutBtn = await page.waitForSelector('[data-testid="sidebar-signout-btn"]', { timeout: 5000 });
    await signoutBtn.click();
    await new Promise((r) => setTimeout(r, 800));

    const backOnAuth = await page.evaluate(() => document.querySelector('[data-testid="input-login-email"]') !== null);
    recordResult("Auth Lifecycle", "Sign Out Clears Session & Returns to AuthScreen", backOnAuth, "AuthScreen displayed");

    // Step 6: Forgot Password Flow
    console.log("\n--- [STEP 6] Forgot Password & Credential Reset ---");
    const forgotLink = await page.waitForSelector('[data-testid="link-forgot-password"]', { timeout: 4000 });
    await forgotLink.click();
    await new Promise((r) => setTimeout(r, 400));

    const newPassword = "brandnewpassword777";
    await page.type('[data-testid="input-forgot-email"]', testEmail);
    await page.type('[data-testid="input-forgot-password"]', newPassword);
    await page.type('[data-testid="input-forgot-confirm"]', newPassword);

    const btnReset = await page.waitForSelector('[data-testid="btn-forgot-submit"]', { timeout: 4000 });
    await btnReset.click();
    await new Promise((r) => setTimeout(r, 1500));

    const resetSuccess = await page.evaluate(() => document.body.innerText.includes("Password updated"));
    recordResult("Auth Lifecycle", "Forgot Password Resets Credentials", resetSuccess, "Success notification rendered");

    // Switch back to login if not auto-switched
    await new Promise((r) => setTimeout(r, 600));
    const isLoginView = await page.$('[data-testid="input-login-password"]');
    if (!isLoginView) {
      const returnBtn = await page.$('[data-testid="link-back-to-login-from-forgot"]');
      if (returnBtn) await returnBtn.click();
      await new Promise((r) => setTimeout(r, 600));
    }

    // Step 7: Second Login (Subsequent Login) with New Password
    console.log("\n--- [STEP 7] Subsequent Login: Direct Entry (No Profile Popup) ---");
    // Clear and set values with native setter to ensure React state updates
    await page.evaluate((emailVal, passVal) => {
      const setVal = (selector, val) => {
        const el = document.querySelector(selector);
        if (el) {
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
          if (setter) setter.call(el, val);
          el.dispatchEvent(new Event("input", { bubbles: true }));
        }
      };
      setVal('[data-testid="input-login-email"]', emailVal);
      setVal('[data-testid="input-login-password"]', passVal);
    }, testEmail, newPassword);

    await new Promise((r) => setTimeout(r, 300));
    const currentInputVals = await page.evaluate(() => ({
      email: document.querySelector('[data-testid="input-login-email"]')?.value,
      pwLen: document.querySelector('[data-testid="input-login-password"]')?.value?.length,
    }));
    console.log("Submitting login credentials:", currentInputVals);

    const btnLogin = await page.waitForSelector('[data-testid="btn-login-submit"]', { timeout: 4000 });
    await btnLogin.click();
    
    try {
      await page.waitForSelector('[data-testid="header-profile-badge"]', { timeout: 6000 });
    } catch (e) {
      const pageText = await page.evaluate(() => document.body.innerText);
      console.error("Login failed! Visible page text excerpt:\n", pageText.slice(0, 500));
      throw e;
    }
    await new Promise((r) => setTimeout(r, 600));

    // Crucial check: Profile modal must NOT pop up on returning user with onboardingCompleted: true!
    const modalPoppedAgain = await page.evaluate(() => document.querySelector("#profile-modal-title") !== null);
    const directWorkspaceEntry = !modalPoppedAgain;
    const restoredBadge = await page.$eval('[data-testid="header-profile-badge"]', (el) => el.textContent || "");
    const restoredCorrectly = restoredBadge.includes("Dr. John Dorian") && restoredBadge.includes("ICU");

    recordResult(
      "Returning User",
      "Subsequent Login Drops Directly to Workspace (Zero Popup)",
      directWorkspaceEntry && restoredCorrectly,
      restoredBadge.trim()
    );

    // Step 8: Pre-Seeded Demo Login Quick Test
    console.log("\n--- [STEP 8] Quick Demo Login Shortcut ---");
    const signoutBtn2 = await page.waitForSelector('[data-testid="sidebar-signout-btn"]', { timeout: 5000 });
    await signoutBtn2.click();
    await new Promise((r) => setTimeout(r, 600));

    const demoBtn = await page.waitForSelector('[data-testid="btn-quick-demo-login"]', { timeout: 4000 });
    await demoBtn.click();
    await new Promise((r) => setTimeout(r, 1200));

    const demoBadge = await page.$eval('[data-testid="header-profile-badge"]', (el) => el.textContent || "");
    const demoSuccess = demoBadge.includes("Sean Iglesia") && demoBadge.includes("OR");
    const demoNoModal = await page.evaluate(() => document.querySelector("#profile-modal-title") === null);

    recordResult(
      "Demo Access",
      "Quick Demo Login Enters Workspace Directly",
      demoSuccess && demoNoModal,
      demoBadge.trim()
    );

    // Capture screenshot of authenticated workspace
    const ssPath = path.join(ARTIFACT_DIR, "phase33_auth_onboarding_completed.png");
    await page.screenshot({ path: ssPath });
    console.log(`\nScreenshot captured: ${ssPath}`);

  } finally {
    await browser.close();
  }

  // Summary Table
  console.log("\n==================================================================");
  console.log("=== PHASE 33 AUTHENTICATION & ONBOARDING SUMMARY ===");
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
  console.error("FATAL PHASE 33 GAUNTLET ERROR:", err);
  process.exit(1);
});
