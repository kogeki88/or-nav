import puppeteer from '../frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const chromePath = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe';

async function captureHover() {
  const browser = await puppeteer.launch({
    executablePath: chromePath,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1440,900']
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });

  await page.goto('http://localhost:3001/jules-workshop', { waitUntil: 'networkidle0', timeout: 15000 });
  await new Promise((r) => setTimeout(r, 2000));

  // Hover over the 5th workstation (the one waiting with the amber ?)
  const desks = await page.$$('.grid > div');
  if (desks.length >= 5) {
    const box = await desks[4].boundingBox();
    if (box) {
      await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await new Promise((r) => setTimeout(r, 600));
    }
  }

  const docsDir = path.resolve('docs');
  const artifactDir = 'C:\\Users\\igles\\.gemini\\antigravity\\brain\\c7b8346c-72d6-4e0f-8948-e05576f54ccc';
  const outPath1 = path.join(docsDir, 'jules_workshop_hover.png');
  const outPath2 = path.join(artifactDir, 'jules_workshop_hover.png');

  await page.screenshot({ path: outPath1, fullPage: false });
  console.log(`Saved hover screenshot to: ${outPath1}`);

  try {
    if (fs.existsSync(artifactDir)) {
      fs.copyFileSync(outPath1, outPath2);
    }
  } catch {}

  await browser.close();
}

captureHover().catch(console.error);
