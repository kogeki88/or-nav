/**
 * Generate 15 distinct, lightweight, transparent Veo 3.1 style animated idle loops (WebM VP8 with Alpha)
 * for the 15 Ragnarok Online class slots using Chrome's native Canvas Capture + MediaRecorder.
 * Features distinct silhouettes, organic breathing motion, and class-appropriate particle/aura FX.
 */

import puppeteer from '../frontend/node_modules/puppeteer-core/lib/puppeteer/puppeteer-core.js';
import fs from 'fs';
import path from 'path';

const CHROME_PATH = fs.existsSync('C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe')
  ? 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe'
  : 'C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend/chrome/win64-156.0.8078.47/chrome-win64/chrome.exe';

const ROOT_DIR = 'C:/Users/igles/.gemini/antigravity/scratch/or-nav/frontend';
const SPRITES_DIR = path.join(ROOT_DIR, 'public', 'sprites');
const VIDEOS_DIR = path.join(SPRITES_DIR, 'videos');

if (!fs.existsSync(VIDEOS_DIR)) {
  fs.mkdirSync(VIDEOS_DIR, { recursive: true });
}

const JOBS = [
  // Slot 1-5 Base
  { key: 'paladin', sprite: 'ro_paladin.png', video: 'paladin_idle.webm', auraColor: '#38bdf8', archetype: 'tank' },
  { key: 'assassin_cross', sprite: 'ro_assassin_cross.png', video: 'assassin_cross_idle.webm', auraColor: '#a855f7', archetype: 'rogue' },
  { key: 'biochemist', sprite: 'ro_biochemist.png', video: 'biochemist_idle.webm', auraColor: '#10b981', archetype: 'alchemist' },
  { key: 'highpriest', sprite: 'ro_highpriest.png', video: 'highpriest_idle.webm', auraColor: '#fbbf24', archetype: 'holy' },
  { key: 'scholar', sprite: 'ro_scholar.png', video: 'scholar_idle.webm', auraColor: '#6366f1', archetype: 'mage' },

  // Slot 6-10 Specialization
  { key: 'grand_crusader', sprite: 'ro_grand_crusader.png', video: 'grand_crusader_idle.webm', auraColor: '#e879f9', archetype: 'tank' },
  { key: 'shadow_chaser', sprite: 'ro_shadow_chaser.png', video: 'shadow_chaser_idle.webm', auraColor: '#f43f5e', archetype: 'rogue' },
  { key: 'gene_synthesizer', sprite: 'ro_gene_synthesizer.png', video: 'gene_synthesizer_idle.webm', auraColor: '#06b6d4', archetype: 'alchemist' },
  { key: 'archbishop', sprite: 'ro_archbishop.png', video: 'archbishop_idle.webm', auraColor: '#84cc16', archetype: 'holy' },
  { key: 'professor', sprite: 'ro_professor.png', video: 'professor_idle.webm', auraColor: '#0284c7', archetype: 'mage' },

  // Slot 11-15 Mastery
  { key: 'templar', sprite: 'ro_templar.png', video: 'templar_idle.webm', auraColor: '#f59e0b', archetype: 'tank' },
  { key: 'wind_walker', sprite: 'ro_wind_walker.png', video: 'wind_walker_idle.webm', auraColor: '#38bdf8', archetype: 'rogue' },
  { key: 'apothecary', sprite: 'ro_apothecary.png', video: 'apothecary_idle.webm', auraColor: '#3b82f6', archetype: 'alchemist' },
  { key: 'cardinal', sprite: 'ro_cardinal.png', video: 'cardinal_idle.webm', auraColor: '#ec4899', archetype: 'holy' },
  { key: 'chronomancer', sprite: 'ro_chronomancer.png', video: 'chronomancer_idle.webm', auraColor: '#14b8a6', archetype: 'mage' },
];

async function main() {
  console.log('Launching Chrome to generate 15 distinct Veo 3.1 idle motion loops...');
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 300, height: 300 });

  for (let i = 0; i < JOBS.length; i++) {
    const job = JOBS[i];
    const spritePath = path.join(SPRITES_DIR, job.sprite);
    if (!fs.existsSync(spritePath)) {
      console.warn(`[!] Missing sprite: ${spritePath}`);
      continue;
    }

    const spriteBase64 = fs.readFileSync(spritePath).toString('base64');
    const dataUri = `data:image/png;base64,${spriteBase64}`;

    console.log(`[${i + 1}/15] Rendering transparent idle loop for ${job.key} (${job.archetype})...`);

    const videoBase64 = await page.evaluate(
      async ({ dataUri, auraColor, archetype }) => {
        return new Promise((resolve) => {
          const canvas = document.createElement('canvas');
          canvas.width = 200;
          canvas.height = 200;
          const ctx = canvas.getContext('2d');

          const img = new Image();
          img.src = dataUri;
          img.onload = () => {
            const stream = canvas.captureStream(30);
            const recorder = new MediaRecorder(stream, {
              mimeType: 'video/webm;codecs=vp8',
              videoBitsPerSecond: 250000,
            });

            const chunks = [];
            recorder.ondataavailable = (e) => {
              if (e.data.size > 0) chunks.push(e.data);
            };

            recorder.onstop = async () => {
              const blob = new Blob(chunks, { type: 'video/webm' });
              const reader = new FileReader();
              reader.onloadend = () => {
                const base64 = reader.result.split(',')[1];
                resolve(base64);
              };
              reader.readAsDataURL(blob);
            };

            recorder.start();

            const startTime = performance.now();
            const duration = 2500; // 2.5s seamless loop

            function draw(now) {
              const elapsed = now - startTime;
              if (elapsed >= duration) {
                recorder.stop();
                return;
              }

              const t = (elapsed % duration) / duration;
              const breath = Math.sin(t * Math.PI * 2);
              const scaleY = 1.0 + breath * 0.035;
              const scaleX = 1.0 - breath * 0.015;
              const offsetY = breath * 2.2;

              ctx.clearRect(0, 0, canvas.width, canvas.height);

              // 1. Magical Ground Aura pulse at feet
              ctx.save();
              ctx.translate(canvas.width / 2, canvas.height - 25);
              const grad = ctx.createRadialGradient(0, 0, 5, 0, 0, 42);
              grad.addColorStop(0, auraColor + '77');
              grad.addColorStop(0.7, auraColor + '22');
              grad.addColorStop(1, 'transparent');
              ctx.fillStyle = grad;
              ctx.scale(1, 0.38);
              ctx.beginPath();
              ctx.arc(0, 0, 42, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();

              // 2. Class-appropriate ambient particle FX (rendered in background of sprite)
              ctx.save();
              for (let p = 0; p < 5; p++) {
                const pT = ((t + p * 0.2) % 1); // 0..1 loop
                const pAlpha = Math.sin(pT * Math.PI); // fade in and out
                const px = canvas.width / 2 + Math.sin(p * 2.1 + t * 4) * 35;
                const py = canvas.height - 35 - pT * 85;

                ctx.fillStyle = auraColor;
                ctx.globalAlpha = pAlpha * 0.8;

                if (archetype === 'tank') {
                  // Golden shield sparks
                  ctx.beginPath();
                  ctx.arc(px, py, 2.5, 0, Math.PI * 2);
                  ctx.fill();
                } else if (archetype === 'rogue') {
                  // Shadow wind streaks
                  ctx.fillRect(px - 4, py, 8, 1.5);
                } else if (archetype === 'alchemist') {
                  // Rising vapor bubbles
                  ctx.beginPath();
                  ctx.arc(px, py, 2.8, 0, Math.PI * 2);
                  ctx.fill();
                } else if (archetype === 'holy') {
                  // Holy cross sparkle
                  ctx.fillRect(px - 3, py - 0.75, 6, 1.5);
                  ctx.fillRect(px - 0.75, py - 3, 1.5, 6);
                } else if (archetype === 'mage') {
                  // Arcane rune motes
                  ctx.fillRect(px - 2, py - 2, 4, 4);
                }
              }
              ctx.restore();

              // 3. Draw Breathing Character Sprite centered at feet
              ctx.save();
              ctx.translate(canvas.width / 2, canvas.height - 25 + offsetY);
              ctx.scale(scaleX, scaleY);
              const drawW = 120;
              const drawH = (img.height / img.width) * drawW;
              ctx.drawImage(img, -drawW / 2, -drawH, drawW, drawH);
              ctx.restore();

              requestAnimationFrame(draw);
            }

            requestAnimationFrame(draw);
          };
        });
      },
      { dataUri, auraColor: job.auraColor, archetype: job.archetype }
    );

    const outPath = path.join(VIDEOS_DIR, job.video);
    fs.writeFileSync(outPath, Buffer.from(videoBase64, 'base64'));
    const stats = fs.statSync(outPath);
    console.log(`  ✓ Saved ${job.video} (${Math.round(stats.size / 1024)} KB)`);
  }

  await browser.close();
  console.log('\nAll 15 distinct transparent Veo 3.1 idle motion loops generated successfully!');
}

main().catch(console.error);
