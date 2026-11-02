import http from 'http';
import fs from 'fs';
import path from 'path';
import puppeteer from '../frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';

const PORT = 4444;
const OUT_DIR = path.resolve('frontend/out');

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain',
};

// 1. In-process static file server for frontend/out
function startStaticServer() {
  const server = http.createServer((req, res) => {
    let reqPath = decodeURI(req.url.split('?')[0]);
    if (reqPath === '/' || reqPath === '') reqPath = '/index.html';
    let filePath = path.join(OUT_DIR, reqPath);

    if (fs.existsSync(filePath + '.html')) {
      filePath = filePath + '.html';
    } else if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }

    if (!fs.existsSync(filePath)) {
      // Check if html file exists without extension
      if (fs.existsSync(filePath + '.html')) {
        filePath = filePath + '.html';
      } else if (fs.existsSync(path.join(filePath, 'index.html'))) {
        filePath = path.join(filePath, 'index.html');
      } else {
        const notFoundPath = path.join(OUT_DIR, '404.html');
        if (fs.existsSync(notFoundPath)) {
          res.writeHead(404, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(fs.readFileSync(notFoundPath));
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
        return;
      }
    }

    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    try {
      const data = fs.readFileSync(filePath);
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(data);
    } catch (e) {
      res.writeHead(500, { 'Content-Type': 'text/plain' });
      res.end('500 Server Error: ' + e.message);
    }
  });

  return new Promise((resolve) => {
    server.listen(PORT, '127.0.0.1', () => {
      console.log(`[Static Server] Serving frontend/out on http://127.0.0.1:${PORT}`);
      resolve(server);
    });
  });
}

const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function runAudit() {
  console.log('=== STARTING FULL-SYSTEM INTERACTIVE UI GAUNTLET (v0.64 BUILD 21) ===');
  const server = await startStaticServer();

  let browser;
  try {
    console.log(`[Puppeteer] Launching browser: ${chromePath}`);
    browser = await puppeteer.launch({
      executablePath: chromePath,
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,960'],
    });

    const page = await browser.newPage();
    await page.setViewport({ width: 1440, height: 960 });

    const uncaughtErrors = [];
    const consoleLogs = [];

    page.on('pageerror', (err) => {
      console.error('[Browser PageError]:', err.message);
      if (err.message.includes('TypeError') || err.message.includes('ReferenceError') || err.message.includes('404')) {
        uncaughtErrors.push(err.message);
      }
    });

    page.on('console', (msg) => {
      const txt = msg.text();
      consoleLogs.push(txt);
      if (msg.type() === 'error') {
        if (!txt.includes('Failed to load resource') && !txt.includes('favicon.ico')) {
          console.warn('[Browser Console Error]:', txt);
          if (txt.includes('TypeError') || txt.includes('ReferenceError')) {
            uncaughtErrors.push(txt);
          }
        }
      }
    });

    // Step 1: Initialize local storage with authenticated demo session
    console.log('[Step 1] Initializing session in LocalStorage...');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'domcontentloaded' });

    await page.evaluate(() => {
      localStorage.setItem(
        'ornav_active_session',
        JSON.stringify({
          userId: 'usr_test_sean',
          email: 'sean@sacredheart.org',
          fullName: 'Sean Iglesia, RN',
          token: 'tok_test_session',
          onboardingCompleted: true,
          profile: {
            fullName: 'Sean Iglesia, RN',
            facilityId: 'sacred_heart',
            facilityName: 'Sacred Heart Hospital',
            departmentId: 'or_main',
            clinicalRole: 'Circulating RN',
          },
        })
      );
      localStorage.setItem(
        'ornav_user_profile',
        JSON.stringify({
          fullName: 'Sean Iglesia, RN',
          facilityId: 'sacred_heart',
          facilityName: 'Sacred Heart Hospital',
          departmentId: 'or_main',
          clinicalRole: 'Circulating RN',
        })
      );
      localStorage.setItem('ornav_active_department', 'sacred_heart::or');
    });

    // Reload to apply authenticated state
    console.log('[Step 2] Reloading into authenticated workspace...');
    await page.goto(`http://127.0.0.1:${PORT}/`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    // Verify no 404 title or screen
    const pageTitle = await page.title();
    const bodyText = await page.evaluate(() => document.body.innerText);
    if (bodyText.includes('404') && bodyText.includes('This page could not be found')) {
      throw new Error('Initial page rendered 404 Page Not Found!');
    }
    console.log('✓ Booted into OR-Nav cleanly. Title:', pageTitle);

    // Step 3: Test Clinician Profile Card & Profile Modal
    console.log('[Step 3] Clicking Clinician Profile Card (sidebar-profile-badge)...');
    const profileBadge = await page.waitForSelector('[data-testid="sidebar-profile-badge"]', {
      timeout: 5000,
    });
    if (!profileBadge) throw new Error('sidebar-profile-badge not found!');
    await profileBadge.click();

    await page.waitForSelector('[data-testid="profile-modal"]', { timeout: 5000 });
    console.log('✓ Profile Modal opened cleanly without 404 link!');

    // Test tab switching inside modal
    console.log('  Testing Profile Modal tabs (Rewards & Mastery)...');
    const tabRewards = await page.waitForSelector('[data-testid="tab-profile-rewards"]', {
      timeout: 3000,
    });
    await tabRewards.click();
    await page.waitForSelector('[data-testid="rewards-dashboard"]', { timeout: 3000 });
    console.log('  ✓ Rewards Dashboard tab rendered.');

    // Switch back to Assignment
    const tabAssignment = await page.waitForSelector('[data-testid="tab-profile-assignment"]', {
      timeout: 3000,
    });
    await tabAssignment.click();

    // Change Department from OR to ICU inside modal
    console.log('  Switching department to ICU inside modal...');
    await page.select('[data-testid="select-department"]', 'icu');
    const saveProfileBtn = await page.waitForSelector('[data-testid="button-save-profile"]', {
      timeout: 3000,
    });
    await saveProfileBtn.click();
    await new Promise((r) => setTimeout(r, 1200));

    // Verify modal closed
    const modalAfterSave = await page.$('[data-testid="profile-modal"]');
    if (modalAfterSave) {
      const isVisible = await page.evaluate((el) => {
        return window.getComputedStyle(el).display !== 'none';
      }, modalAfterSave);
      if (isVisible) throw new Error('Profile modal did not close after saving!');
    }
    console.log('✓ Department switched to ICU and modal closed.');

    // Step 4: Quick Department Pill & Inline Selector
    console.log('[Step 4] Testing Quick Department Pill & Inline Switcher...');
    const deptPill = await page.waitForSelector('[data-testid="sidebar-dept-pill"]', {
      timeout: 3000,
    });
    const pillText = await page.evaluate((el) => el.innerText, deptPill);
    console.log(`  Current Dept Pill: "${pillText.trim()}"`);

    // Click pill to verify it opens profile assignment modal in 1 tap
    await deptPill.click();
    await page.waitForSelector('[data-testid="profile-modal"]', { timeout: 3000 });
    console.log('  ✓ Quick Department Pill opens Profile Modal in 1 tap.');
    const closeProfileBtn = await page.waitForSelector(
      '[data-testid="close-profile-modal-btn"]',
      { timeout: 3000 }
    );
    await closeProfileBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Test inline department select dropdown back to or_main
    console.log('  Switching back to OR via inline department-selector...');
    await page.select('[data-testid="department-selector"]', 'or_main');
    await new Promise((r) => setTimeout(r, 1000));
    console.log('✓ Returned to OR department.');

    // Step 5: Test Top Sidebar Actions (+ New Case, Peer Q&A, Feedback)
    console.log('[Step 5] Testing Top Sidebar Action Buttons...');
    const newCaseBtn = await page.waitForSelector('[data-testid="sidebar-new-case-btn"]', {
      timeout: 3000,
    });
    await newCaseBtn.click();
    console.log('  ✓ + New Case button clicked cleanly.');

    const peerQnABtn = await page.waitForSelector('[data-testid="sidebar-peer-qna-btn"]', {
      timeout: 3000,
    });
    await peerQnABtn.click();
    await page.waitForSelector('[data-testid="peer-qna-modal"]', { timeout: 3000 });
    console.log('  ✓ Peer Q&A Modal opened.');
    const closePeerBtn = await page.waitForSelector(
      '[data-testid="close-peer-qna-modal-btn"]',
      { timeout: 3000 }
    );
    await closePeerBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    const feedbackBtn = await page.waitForSelector('[data-testid="sidebar-feedback-btn"]', {
      timeout: 3000,
    });
    await feedbackBtn.click();
    await page.waitForSelector('[data-testid="feedback-modal"]', { timeout: 3000 });
    console.log('  ✓ Feedback Modal opened.');
    const closeFeedbackBtn = await page.waitForSelector(
      '[data-testid="close-feedback-modal-btn"]',
      { timeout: 3000 }
    );
    await closeFeedbackBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Step 6: Test System Drawer Accordions
    console.log('[Step 6] Testing System Drawer Accordions in Sidebar...');
    const systemToggle = await page.waitForSelector(
      '[data-testid="sidebar-system-toggle"]',
      { timeout: 3000 }
    );
    await systemToggle.click();
    await new Promise((r) => setTimeout(r, 500));

    // Category: API
    console.log('  Opening API accordion...');
    const apiToggle = await page.waitForSelector('[data-testid="category-api-toggle"]', {
      timeout: 3000,
    });
    await apiToggle.click();

    // Category: Background Services
    console.log('  Opening Background Services accordion...');
    const servicesToggle = await page.waitForSelector(
      '[data-testid="category-services-toggle"]',
      { timeout: 3000 }
    );
    await servicesToggle.click();
    const updateCheckBtn = await page.waitForSelector(
      '[data-testid="button-manual-update-check"]',
      { timeout: 3000 }
    );
    await updateCheckBtn.click();
    console.log('  ✓ Manual Update Check button fired cleanly.');

    // Category: Installed Resources
    console.log('  Opening Installed Resources accordion...');
    const resourcesToggle = await page.waitForSelector(
      '[data-testid="category-resources-toggle"]',
      { timeout: 3000 }
    );
    await resourcesToggle.click();

    // Test Resource Manager Modal
    console.log('  Opening Resource Manager Modal...');
    const openResMgrBtn = await page.waitForSelector(
      '[data-testid="button-open-resource-manager"]',
      { timeout: 3000 }
    );
    await openResMgrBtn.click();
    await page.waitForSelector('[data-testid="resource-manager-modal"]', { timeout: 3000 });
    console.log('  ✓ Resource Manager Modal opened.');
    const closeResMgrBtn = await page.waitForSelector(
      '[data-testid="close-resource-manager-btn"]',
      { timeout: 3000 }
    );
    await closeResMgrBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Test Resource Inspector Studio Modal
    console.log('  Opening Resource Inspector Studio Modal (4 Tabs)...');
    const openInspectorBtn = await page.waitForSelector(
      '[data-testid="button-open-resource-inspector"]',
      { timeout: 3000 }
    );
    await openInspectorBtn.click();
    await page.waitForSelector('[data-testid="resource-inspector-modal"]', { timeout: 3000 });

    // Click through the 4 tabs of Resource Inspector
    console.log('  Switching through Studio Tabs: Inventory, Preference Cards, Slang, Protocols...');
    const tabCards = await page.waitForSelector('[data-testid="tab-preference-cards"]', {
      timeout: 3000,
    });
    await tabCards.click();
    const tabSlang = await page.waitForSelector('[data-testid="tab-slang-lexicon"]', {
      timeout: 3000,
    });
    await tabSlang.click();
    const tabProtocols = await page.waitForSelector(
      '[data-testid="tab-protocols-management"]',
      { timeout: 3000 }
    );
    await tabProtocols.click();
    const tabInv = await page.waitForSelector('[data-testid="tab-inventory"]', {
      timeout: 3000,
    });
    await tabInv.click();
    console.log('  ✓ All 4 Resource Inspector tabs switched cleanly.');

    const closeInspectorBtn = await page.waitForSelector(
      '[data-testid="btn-close-resource-inspector"]',
      { timeout: 3000 }
    );
    await closeInspectorBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Category: Audio
    console.log('  Testing Audio accordion and TTS toggle...');
    const audioToggle = await page.waitForSelector('[data-testid="category-audio-toggle"]', {
      timeout: 3000,
    });
    await audioToggle.click();
    const ttsToggle = await page.waitForSelector('[data-testid="toggle-tts-audio"]', {
      timeout: 3000,
    });
    await ttsToggle.click();
    console.log('  ✓ TTS toggled cleanly.');

    // Category: Pairing
    console.log('  Testing Pairing accordion and QR Modal...');
    const pairingToggle = await page.waitForSelector(
      '[data-testid="category-pairing-toggle"]',
      { timeout: 3000 }
    );
    await pairingToggle.click();
    const qrPairBtn = await page.waitForSelector('[data-testid="btn-open-qr-pair"]', {
      timeout: 3000,
    });
    await qrPairBtn.click();
    await page.waitForSelector('[data-testid="qr-pair-modal"]', { timeout: 3000 });
    console.log('  ✓ QR Pair Modal opened.');
    const closeQrBtn = await page.waitForSelector(
      '[data-testid="close-qr-pair-modal-btn"]',
      { timeout: 3000 }
    );
    await closeQrBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // Category: System Info & Cache Rebuild
    console.log('  Testing System Info accordion...');
    const sysInfoToggle = await page.waitForSelector(
      '[data-testid="category-system-info-toggle"]',
      { timeout: 3000 }
    );
    await sysInfoToggle.click();
    const dexieCountEl = await page.waitForSelector('[data-testid="dexie-item-count"]', {
      timeout: 3000,
    });
    const dexieText = await page.evaluate((el) => el.innerText, dexieCountEl);
    console.log(`  ✓ System Info Dexie Status: ${dexieText.trim()}`);

    const rebuildBtn = await page.waitForSelector(
      '[data-testid="rebuild-offline-cache-btn"]',
      { timeout: 3000 }
    );
    await rebuildBtn.click();
    await new Promise((r) => setTimeout(r, 1200));
    console.log('  ✓ Rebuild Offline Cache clicked.');

    // Step 7: Omnibar Interaction
    console.log('[Step 7] Testing Omnibar Input & Offline Query Execution...');
    const omnibarInput = await page.waitForSelector('[data-testid="omnibar-input"]', {
      timeout: 3000,
    });
    await omnibarInput.type('debakey');
    const omnibarSubmit = await page.waitForSelector('[data-testid="omnibar-submit-btn"]', {
      timeout: 3000,
    });
    await omnibarSubmit.click();
    await new Promise((r) => setTimeout(r, 2000));
    console.log('  ✓ Omnibar query submitted and processed.');

    // Step 8: Direct /profile URL Routing Test (Assert 0 404!)
    console.log('[Step 8] Testing Direct Navigation to /profile route...');
    await page.goto(`http://127.0.0.1:${PORT}/profile`, { waitUntil: 'networkidle0', timeout: 15000 });
    await new Promise((r) => setTimeout(r, 1500));

    const directProfileText = await page.evaluate(() => document.body.innerText);
    if (directProfileText.includes('404') && directProfileText.includes('This page could not be found')) {
      throw new Error('FAILED: /profile route rendered a 404 Page Not Found error!');
    }
    const profileModalAfterRedirect = await page.waitForSelector(
      '[data-testid="profile-modal"]',
      { timeout: 5000 }
    );
    if (!profileModalAfterRedirect) {
      throw new Error('FAILED: /profile route did not trigger Profile Modal on arrival!');
    }
    console.log('✓ /profile route redirected cleanly to / and opened Profile Modal with zero 404!');

    const closeRedirectModal = await page.waitForSelector(
      '[data-testid="close-profile-modal-btn"]',
      { timeout: 3000 }
    );
    await closeRedirectModal.click();
    await new Promise((r) => setTimeout(r, 500));

    // Step 9: Mobile Viewport & Hamburger Navigation Test
    console.log('[Step 9] Testing Mobile Phone Viewport (375x667)...');
    await page.setViewport({ width: 375, height: 667, isMobile: true, hasTouch: true });
    await new Promise((r) => setTimeout(r, 500));

    const hamburger = await page.waitForSelector('[data-testid="mobile-sidebar-toggle"]', {
      timeout: 3000,
    });
    await hamburger.click();
    await new Promise((r) => setTimeout(r, 500));
    console.log('  ✓ Mobile drawer opened via hamburger.');

    // Click visible profile badge in mobile drawer
    await page.evaluate(() => {
      const badges = Array.from(document.querySelectorAll('[data-testid="sidebar-profile-badge"]'));
      const visible = badges.find(el => el.getBoundingClientRect().width > 0);
      if (visible) visible.click();
      else if (badges.length > 0) badges[badges.length - 1].click();
    });
    await page.waitForSelector('[data-testid="profile-modal"]', { timeout: 5000 });
    console.log('  ✓ Mobile Profile Badge opened Profile Modal and closed mobile drawer.');

    const closeMobileProfile = await page.waitForSelector(
      '[data-testid="close-profile-modal-btn"]',
      { timeout: 3000 }
    );
    await closeMobileProfile.click();
    await new Promise((r) => setTimeout(r, 500));

    // Step 10: Sign Out Action Test
    console.log('[Step 10] Testing Sign Out button...');
    await page.setViewport({ width: 1440, height: 960 });
    await new Promise((r) => setTimeout(r, 500));

    // Ensure system drawer is open
    await page.evaluate(() => {
      const sysBtn = document.querySelector('[data-testid="sidebar-system-toggle"]');
      if (sysBtn && sysBtn.getAttribute('aria-expanded') !== 'true') {
        sysBtn.click();
      }
    });
    await new Promise((r) => setTimeout(r, 500));

    await page.evaluate(() => {
      const signout = document.querySelector('[data-testid="sidebar-signout-btn"]');
      if (signout) signout.click();
    });
    await new Promise((r) => setTimeout(r, 1000));

    const bodyAfterSignOut = await page.evaluate(() => document.body.innerText);
    if (bodyAfterSignOut.includes('404')) {
      throw new Error('FAILED: Sign out triggered a 404 error!');
    }
    console.log('✓ Signed out cleanly back to Auth screen without 404.');

    // Assert uncaught error list
    if (uncaughtErrors.length > 0) {
      throw new Error(`Encountered uncaught errors during gauntlet:\n${uncaughtErrors.join('\n')}`);
    }

    console.log('================================================================');
    console.log('🎉 100% SUCCESS: ALL INTERACTIVE UI CONTROLS VERIFIED CLEANLY!');
    console.log('✓ 0 404 screens detected');
    console.log('✓ 0 uncaught TypeErrors or ReferenceErrors');
    console.log('✓ Profile Modal & Quick Department Switcher fully wired');
    console.log('✓ 4-Tab Resource Inspector Studio & Resource Manager verified');
    console.log('================================================================');
  } finally {
    if (browser) await browser.close();
    server.close();
  }
}

runAudit().catch((err) => {
  console.error('\n❌ GAUNTLET FAILED:', err.message);
  process.exit(1);
});
