const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json());

const screenshotsDir = path.join(__dirname, "error_screenshots");
if (!fs.existsSync(screenshotsDir)) {
  fs.mkdirSync(screenshotsDir, { recursive: true });
}

const BRAVE_PATH = "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

const PROFILE_PATHS = {
  "Profile 1": "C:\\BraveProfiles\\youssef\\profile1",
  "Profile 2": "C:\\BraveProfiles\\youssef\\profile2",
  "Profile 3": "C:\\BraveProfiles\\youssef\\profile3",
  "Profile 4": "C:\\BraveProfiles\\youssef\\profile4",
  "Profile 5": "C:\\BraveProfiles\\youssef\\profile5",
  "Profile 6": "C:\\BraveProfiles\\youssef\\profile6",
  "Profile 7": "C:\\BraveProfiles\\youssef\\profile7",
  "Profile 8": "C:\\BraveProfiles\\youssef\\profile8",
  "Profile 9": "C:\\BraveProfiles\\youssef\\profile9",
  "Profile 10": "C:\\BraveProfiles\\youssef\\profile10",
  "Profile 11": "C:\\BraveProfiles\\youssef\\profile11",
  "Profile 12": "C:\\BraveProfiles\\youssef\\profile12",
  "Profile 13": "C:\\BraveProfiles\\youssef\\profile13",
  "Profile 14": "C:\\BraveProfiles\\youssef\\profile14",
  "Profile 15": "C:\\BraveProfiles\\youssef\\profile15",
  "Profile 16": "C:\\BraveProfiles\\youssef\\profile16",
  "Profile 17": "C:\\BraveProfiles\\youssef\\profile17",
  "Profile 18": "C:\\BraveProfiles\\youssef\\profile18",
  "Profile 19": "C:\\BraveProfiles\\youssef\\profile19",
  "Profile 20": "C:\\BraveProfiles\\youssef\\profile20"
};

const rateLimitTracker = new Map();
const COOL_DOWN_MS = 15 * 60 * 1000;

function getBase64Image(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      const fileData = fs.readFileSync(filePath);
      return fileData.toString("base64");
    }
  } catch (e) {
    console.log("Error converting image to Base64:", e.message);
  }
  return null;
}

async function isCheckpoint(page) {
  try {
    const isUrlCheckpoint = page.url().includes("/checkpoint/");
    const hasText = await page.getByText(/confirm you're human|confirmez votre identité|تأكيد هويتك/i, { exact: false }).isVisible().catch(() => false);
    return isUrlCheckpoint || hasText;
  } catch (e) {
    return false;
  }
}

async function pasteText(page, locator, text) {
  await locator.focus().catch(() => {});
  await page.evaluate((t) => navigator.clipboard.writeText(t), text).catch(() => {});
  await page.keyboard.press("Control+V");
}

async function testCommentOnly(profile, group_url) {
  const userDataDir = PROFILE_PATHS[profile];
  if (!userDataDir) {
    console.log(`[ERROR] Unknown profile path for: ${profile}`);
    return false;
  }

  let context = null;
  let page = null;
  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: BRAVE_PATH,
      headless: false,
      locale: "en-US",
      args: ["--lang=en-US"],
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,ar;q=0.7"
      },
      permissions: ["clipboard-read", "clipboard-write"]
    });

    page = await context.newPage();
    await page.goto(group_url, { waitUntil: "domcontentloaded" });

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);

    const commentBox = page
      .locator(
        '[contenteditable="true"][role="textbox"], ' +
        '[contenteditable="true"][aria-label*="Write a public comment" i], ' +
        '[contenteditable="true"][aria-label*="Écrire un commentaire" i], ' +
        '[contenteditable="true"][aria-label*="كتابة تعليق" i], ' +
        '[contenteditable="true"][aria-label*="تعليق" i]'
      )
      .first();

    const isVisible = await commentBox.isVisible().catch(() => false);
    if (!isVisible) return false;

    await commentBox.scrollIntoViewIfNeeded().catch(() => {});
    await commentBox.click();
    await pasteText(page, commentBox, ".");
    await page.keyboard.press("Enter");
    await page.waitForTimeout(2000);

    const postedComment = page.getByText(".", { exact: true }).first();
    const commentFound = await postedComment.isVisible().catch(() => false);

    const blockedPopup = page.getByText(/You can't use this feature at the moment|You Can't Use This Feature Right Now|Vous ne pouvez pas utiliser cette fonctionnalité|لا يمكنك استخدام هذه الميزة/i, { exact: false });
    const isBlocked = await blockedPopup.isVisible().catch(() => false);
    if (isBlocked) {
      const okBtn = page.getByRole("button", { name: /^(OK|موافق)$/i });
      await okBtn.click().catch(() => {});
      return false;
    }

    const errorIcon = page.locator('[aria-hidden="true"] svg path[d*="7.5 7.5 0 1 0"]').first();
    const hasErrorIcon = await errorIcon.isVisible().catch(() => false);
    if (hasErrorIcon || !commentFound) return false;

    return true;

  } catch (e) {
    console.log(`[TEST COMMENT ERROR] ${profile}:`, e.message);
    return false;
  } finally {
    if (context) {
      const allPages = context.pages();
      for (const p of allPages) { try { await p.close(); } catch (e) {} }
      await context.close();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

async function runSingleTask(task, title, imagePath, comment) {
  const { profile, group_url } = task;
  const userDataDir = PROFILE_PATHS[profile];

  if (!userDataDir) {
    return {
      profile,
      group_url,
      postStatus: "FAILED",
      commentStatus: "SKIPPED",
      error: `Unknown profile path mapping for ${profile}`
    };
  }

  let context = null;
  let page = null;

  const report = {
    profile,
    group_url,
    postStatus: "FAILED",
    commentStatus: "SKIPPED",
    error: null,
    errorScreenshotBase64: null
  };

  try {
    context = await chromium.launchPersistentContext(userDataDir, {
      executablePath: BRAVE_PATH,
      headless: false,
      locale: "en-US",
      args: ["--lang=en-US"],
      extraHTTPHeaders: {
        "Accept-Language": "en-US,en;q=0.9,fr;q=0.8,ar;q=0.7"
      },
      permissions: ["clipboard-read", "clipboard-write"]
    });

    page = await context.newPage();

    const cleanPath = imagePath ? imagePath.replace(/^file:\/\/\/??/i, "") : "";
    const finalPath = path.normalize(decodeURIComponent(cleanPath));

    await page.goto(group_url, { waitUntil: "domcontentloaded" });

    if (await isCheckpoint(page)) {
      console.log(`[CHECKPOINT DETECTED] Profile: ${profile}`);
      const ssPath = path.join(screenshotsDir, `checkpoint_${profile.replace(/\s+/g, "_")}_${Date.now()}.png`);
      await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
      report.postStatus = "CHECKPOINT_REQUIRED";
      report.error = "Facebook requested human verification (Checkpoint/Captcha)";
      report.errorScreenshotBase64 = getBase64Image(ssPath);
      return report;
    }

    const writeBtn = page.getByText(/Write something...|Créer un منشور|عن ماذا تفكر|أنشئ منشورًا|Exprimez-vous|اكتب شيئًا/i, { exact: false }).first();
    await writeBtn.waitFor({ state: "visible", timeout: 8000 });
    await writeBtn.click();
    await page.waitForTimeout(2500);

    if (finalPath && fs.existsSync(finalPath)) {
      const fileInput = page.locator('input[type="file"]').last();
      await fileInput.setInputFiles(finalPath);
      await page.waitForTimeout(1000);
    }

    const postBox = page.getByRole("dialog").locator('[contenteditable="true"]').first();
    await postBox.waitFor({ state: "visible", timeout: 8000 });
    await postBox.click();
    await pasteText(page, postBox, title);

    const postButton = page.locator('[aria-label="Post"], [aria-label="Publier"], [aria-label="نشر"]').last();
    await postButton.waitFor({ state: "visible", timeout: 8000 });
    await postButton.click({ force: true });

    await page.waitForTimeout(3000);

    const feedbackBlocked = page.locator('div[role="button"]:has-text("Donner votre avis"), div[role="button"]:has-text("Give feedback"), div[role="button"]:has-text("تقديم ملاحظات")').first();
    const isFeedbackVisible = await feedbackBlocked.isVisible().catch(() => false);

    if (isFeedbackVisible) {
      console.log(`[POST BLOCKED] ${profile}: Found 'Donner votre avis' popup. Post failed.`);
      report.postStatus = "FAILED";
      report.commentStatus = "SKIPPED";
      report.error = "Post was blocked by Facebook (Donner votre avis popup detected).";
      const ssPath = path.join(screenshotsDir, `post_blocked_${profile.replace(/\s+/g, "_")}_${Date.now()}.png`);
      await page.screenshot({ path: ssPath, fullPage: false }).catch(() => {});
      report.errorScreenshotBase64 = getBase64Image(ssPath);
      return report;
    }

    report.postStatus = "SUCCESS";
    await page.waitForTimeout(2000);

    for (let i = 0; i < 3; i++) {
      const dialog = page.getByRole("dialog").first();
      const dialogVisible = await dialog.isVisible().catch(() => false);
      if (!dialogVisible) break;
      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);

    const commentBox = page
      .locator(
        '[contenteditable="true"][role="textbox"], ' +
        '[contenteditable="true"][aria-label*="Write a public comment" i], ' +
        '[contenteditable="true"][aria-label*="Écrire un commentaire" i], ' +
        '[contenteditable="true"][aria-label*="كتابة تعليق" i], ' +
        '[contenteditable="true"][aria-label*="تعليق" i]'
      )
      .first();

    let commentReady = false;
    for (let i = 0; i < 4; i++) {
      commentReady = await commentBox.isVisible().catch(() => false);
      if (commentReady) {
        await commentBox.scrollIntoViewIfNeeded().catch(() => {});
        break;
      }
      await page.waitForTimeout(1500);
    }

    if (commentReady) {
      await commentBox.click();
      if (comment) {
        await pasteText(page, commentBox, comment);
        await page.waitForTimeout(1000);
      }

      if (finalPath && fs.existsSync(finalPath)) {
        try {
          const commentContainer = commentBox.locator('xpath=ancestor::form[1] | ancestor::div[contains(@role, "region") or contains(@class, "x1n2onr6")]').first();

          const photoBtn = commentContainer.locator(
            '[aria-label*="Attach a photo" i], ' +
            '[aria-label*="Joignez une photo" i], ' +
            '[aria-label*="إرفاق صورة" i], ' +
            '[aria-label*="صورة" i], ' +
            'div[aria-label*="photo" i], ' +
            'div[aria-label*="image" i]'
          ).first();

          const fileInputInside = commentContainer.locator('input[type="file"]').last();

          if (await fileInputInside.count() > 0) {
            await fileInputInside.setInputFiles(finalPath);
          } else if (await photoBtn.isVisible().catch(() => false)) {
            const [fileChooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5000 }),
              photoBtn.click()
            ]);
            await fileChooser.setFiles(finalPath);
          } else {
            const fallbackInput = page.locator('input[type="file"][accept*="image"]').last();
            await fallbackInput.setInputFiles(finalPath);
          }
          await page.waitForTimeout(2000);
        } catch (imgErr) {
          console.log(`[COMMENT IMAGE ERROR] ${profile}:`, imgErr.message);
        }
      }

      try {
        const submitCommentBtn = page.locator(
          '[aria-label="Commenter"], ' +
          '[aria-label="Comment"], ' +
          '[aria-label="التعليق"], ' +
          '[aria-label="Publier un commentaire"], ' +
          'div[role="button"]:has(svg path[d*="M1.32 6.2"])'
        ).last();

        await submitCommentBtn.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});

        if (await submitCommentBtn.isVisible().catch(() => false)) {
          await submitCommentBtn.click();
        } else {
          await commentBox.focus();
          await page.keyboard.press("Enter");
        }
      } catch (submitErr) {
        console.log(`[SUBMIT CLICK ERROR] ${profile}:`, submitErr.message);
        await page.keyboard.press("Enter");
      }

      await page.waitForTimeout(3000);

      const blockedPopup = page.getByText(/You can't use this feature at the moment|You Can't Use This Feature Right Now|Vous ne pouvez pas utiliser cette fonctionnalité|لا يمكنك استخدام هذه الميزة/i, { exact: false });
      const isBlocked = await blockedPopup.isVisible().catch(() => false);

      const errorIcon = page.locator('[aria-hidden="true"] svg path[d*="7.5 7.5 0 1 0"]').first();
      const hasErrorIcon = await errorIcon.isVisible().catch(() => false);

      if (isBlocked) {
        const closeBtn = page.locator('[aria-label="Close"], [aria-label="Fermer"], [aria-label="إغلاق"]').first();
        const okBtn = page.getByRole("button", { name: /^(OK|موافق)$/i });
        await closeBtn.click().catch(async () => {
          await okBtn.click().catch(() => {});
        });
        report.commentStatus = "FAILED_RATE_LIMITED";
      } else if (hasErrorIcon) {
        report.commentStatus = "FAILED_COMMENT_ERROR";
      } else {
        report.commentStatus = "SUCCESS";
      }

      await page.waitForTimeout(1000);
    } else {
      report.commentStatus = "FAILED_BOX_NOT_FOUND";
    }

  } catch (err) {
    report.error = err.message;
    if (page) {
      try {
        const ssPath = path.join(screenshotsDir, `error_${profile.replace(/\s+/g, "_")}_${Date.now()}.png`);
        await page.screenshot({ path: ssPath, fullPage: false });
        report.errorScreenshotBase64 = getBase64Image(ssPath);
      } catch (ssErr) {
        console.log("Failed to capture screenshot:", ssErr.message);
      }
    }
  } finally {
    if (context) {
      const allPages = context.pages();
      for (const p of allPages) { try { await p.close(); } catch (e) {} }
      await context.close();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return report;
}

app.post("/browser", async (req, res) => {
  const { title, imagePath, comment, tasks } = req.body;

  const defaultTasks = [
      { profile: "Profile 3", group_url: "https://www.facebook.com/groups/694790175153044/" },
      { profile: "Profile 4", group_url: "https://www.facebook.com/groups/40051688142" },
      { profile: "Profile 5", group_url: "https://www.facebook.com/groups/420165248022102/" },
      { profile: "Profile 6", group_url: "https://www.facebook.com/groups/107563939749765/" },
  ];

  const taskList = (tasks && Array.isArray(tasks) && tasks.length > 0) ? tasks : defaultTasks;
  const results = [];

  for (const task of taskList) {
    const lastBlocked = rateLimitTracker.get(task.profile);
    const now = Date.now();

    if (lastBlocked && (now - lastBlocked < COOL_DOWN_MS)) {
      const waitTimeLeft = Math.ceil((COOL_DOWN_MS - (now - lastBlocked)) / 1000);
      console.log(`[SKIP] ${task.profile} is in cool-down (${waitTimeLeft}s left). Skipping...`);
      results.push({
        profile: task.profile,
        group_url: task.group_url,
        postStatus: "SKIPPED_COOL_DOWN",
        commentStatus: "SKIPPED_COOL_DOWN",
        error: `Rate limited / Group issue. Retry allowed in ${waitTimeLeft}s.`
      });
      continue;
    }

    if (lastBlocked && (now - lastBlocked >= COOL_DOWN_MS)) {
      console.log(`[TESTING] 15 minutes passed for ${task.profile}. Testing comment...`);
      const canComment = await testCommentOnly(task.profile, task.group_url);

      if (!canComment) {
        console.log(`[STILL BLOCKED] ${task.profile} is still rate-limited. Resetting 15-min timer.`);
        rateLimitTracker.set(task.profile, Date.now());
        results.push({
          profile: task.profile,
          group_url: task.group_url,
          postStatus: "SKIPPED_STILL_LIMITED",
          commentStatus: "FAILED_RATE_LIMITED",
          error: "Still rate limited after 15-min test."
        });
        continue;
      } else {
        console.log(`[UNBLOCKED] ${task.profile} limit lifted! Running full task...`);
        rateLimitTracker.delete(task.profile);
      }
    }

    console.log(`[RUNNING] Executing task for ${task.profile}...`);
    const taskReport = await runSingleTask(task, title, imagePath, comment);

    if (
      taskReport.postStatus !== "SUCCESS" ||
      taskReport.commentStatus === "FAILED_RATE_LIMITED" ||
      taskReport.error !== null
    ) {
      console.log(`[GROUP/TASK ISSUE] ${task.profile} failed task or got blocked. Setting 15-min timer.`);
      rateLimitTracker.set(task.profile, Date.now());
    }

    results.push(taskReport);
  }

  res.json(results);
});

const server = app.listen(3001, () => {
  console.log("Playwright API running on port 3001");
});
server.timeout = 600000;
