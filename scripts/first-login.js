// Opens the bot's Brave profile so you can log in to Facebook manually ONCE.
// Usage: node scripts/first-login.js bot-1
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { chromium } = require('../playwright-bot/node_modules/playwright');
const path = require('path');

const name = process.argv[2] || 'bot-1';
(async () => {
  const ctx = await chromium.launchPersistentContext(
    path.resolve(__dirname, '..', 'playwright-bot', 'profiles', name),
    { executablePath: process.env.BRAVE_PATH, headless: false, viewport: null }
  );
  const page = ctx.pages()[0] || (await ctx.newPage());
  await page.goto('https://www.facebook.com/');
  console.log(`Log in to Facebook in the opened window, then close it. Profile: ${name}`);
  ctx.on('close', () => process.exit(0));
})();
