/**
 * Playwright bot — one instance = one port = one Brave profile.
 *
 * POST /post-to-group   { groupUrl, title, imageUrl, wpUrl, description? }
 * GET  /health
 *
 * NOTE: Facebook changes its markup often. The selectors below are
 * role/text based (EN + FR) and may need small adjustments for your account.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const express = require('express');
const { chromium } = require('playwright');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = Number(process.env.PORT || 3001);
const BOT_NAME = process.env.BOT_NAME || `bot-${PORT}`;
const BRAVE_PATH = process.env.BRAVE_PATH;
const API_KEY = process.env.API_KEY;
const HEADLESS = process.env.HEADLESS === 'true';
const MIN_DELAY = Number(process.env.MIN_DELAY_MS || 4000);
const MAX_DELAY = Number(process.env.MAX_DELAY_MS || 12000);
const PROFILE_DIR = path.resolve(__dirname, 'profiles', BOT_NAME);
const SHOT_DIR = path.resolve(__dirname, 'screenshots');

fs.mkdirSync(PROFILE_DIR, { recursive: true });
fs.mkdirSync(SHOT_DIR, { recursive: true });

const rand = (a, b) => Math.floor(Math.random() * (b - a + 1)) + a;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const humanPause = () => sleep(rand(MIN_DELAY, MAX_DELAY));

// ---- one browser context per bot, created lazily and reused ----
let ctx;
async function getContext() {
  if (ctx) return ctx;
  ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
    executablePath: BRAVE_PATH,
    headless: HEADLESS,
    viewport: null,
    args: ['--no-first-run', '--no-default-browser-check'],
  });
  ctx.on('close', () => { ctx = null; });
  return ctx;
}

// ---- simple FIFO queue: a bot does ONE job at a time ----
let chain = Promise.resolve();
function enqueue(task) {
  const run = chain.then(task, task);
  chain = run.catch(() => {});
  return run;
}

async function downloadImage(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image download failed: ${res.status}`);
  const ext = (url.split('?')[0].match(/\.(jpe?g|png|webp|gif)$/i) || [, 'jpg'])[1];
  const file = path.join(os.tmpdir(), `${BOT_NAME}-${Date.now()}.${ext}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function typeHuman(page, text) {
  await page.keyboard.type(text, { delay: rand(35, 110) });
}

async function postToGroup({ groupUrl, title, imageUrl, wpUrl, description }) {
  const context = await getContext();
  const page = await context.newPage();
  let imagePath;
  try {
    if (imageUrl) imagePath = await downloadImage(imageUrl);

    await page.goto(groupUrl, { waitUntil: 'domcontentloaded' });
    await humanPause();

    // 1) open the composer
    await page
      .getByRole('button', {
        name: /write something|create a public post|what's on your mind|écrivez quelque chose|exprimez-vous|créer une publication/i,
      })
      .first()
      .click();

    const dialog = page.getByRole('dialog').first();
    await dialog.waitFor({ timeout: 20000 });

    // 2) text
    await dialog.getByRole('textbox').first().click();
    await typeHuman(page, description ? `${title}\n\n${description}` : title);
    await sleep(rand(1000, 2500));

    // 3) image
    if (imagePath) {
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 15000 }),
        dialog.getByRole('button', { name: /photo\/video|photo\/vidéo/i }).first().click(),
      ]);
      await chooser.setFiles(imagePath);
      await sleep(rand(3000, 6000));
    }

    // 4) publish
    await dialog.getByRole('button', { name: /^(post|publier)$/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 90000 });
    await humanPause();

    // 5) comment the WordPress link on the newest post
    await page.reload({ waitUntil: 'domcontentloaded' });
    await sleep(rand(3000, 5000));
    const firstPost = page.locator('[role="article"]').first();
    await firstPost.getByRole('button', { name: /comment|commenter/i }).first().click();
    const commentBox = firstPost.getByRole('textbox', { name: /comment|commentaire/i }).first();
    await commentBox.click();
    await typeHuman(page, wpUrl);
    await page.keyboard.press('Enter');
    await sleep(rand(2000, 4000));

    return { ok: true, bot: BOT_NAME, groupUrl };
  } catch (err) {
    const shot = path.join(SHOT_DIR, `${BOT_NAME}-${Date.now()}.png`);
    await page.screenshot({ path: shot }).catch(() => {});
    throw Object.assign(err, { screenshot: shot });
  } finally {
    if (imagePath) fs.unlink(imagePath, () => {});
    await page.close().catch(() => {});
  }
}

const app = express();
app.use(express.json({ limit: '1mb' }));

app.use((req, res, next) => {
  if (API_KEY && req.get('x-api-key') !== API_KEY) {
    return res.status(401).json({ ok: false, error: 'unauthorized' });
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, bot: BOT_NAME, port: PORT }));

app.post('/post-to-group', async (req, res) => {
  const { groupUrl, title, wpUrl } = req.body || {};
  if (!groupUrl || !title || !wpUrl) {
    return res.status(400).json({ ok: false, error: 'groupUrl, title and wpUrl are required' });
  }
  try {
    const result = await enqueue(() => postToGroup(req.body));
    res.json(result);
  } catch (err) {
    res.status(500).json({ ok: false, bot: BOT_NAME, error: err.message, screenshot: err.screenshot });
  }
});

app.listen(PORT, '0.0.0.0', () => console.log(`[${BOT_NAME}] listening on :${PORT}`));
