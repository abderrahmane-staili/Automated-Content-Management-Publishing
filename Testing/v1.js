
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

const BRAVE_PATH =
  "C:\\Program Files\\BraveSoftware\\Brave-Browser\\Application\\brave.exe";

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
      return fs.readFileSync(filePath).toString("base64");
    }
  } catch (e) {
    console.log("Error converting image to Base64:", e.message);
  }

  return null;
}

async function isCheckpoint(page) {
  try {
    const isUrlCheckpoint = page.url().includes("/checkpoint/");

    const hasText = await page
      .getByText(
        /confirm you're human|confirmez votre identité|تأكيد هويتك/i,
        { exact: false }
      )
      .isVisible()
      .catch(() => false);

    return isUrlCheckpoint || hasText;
  } catch (e) {
    return false;
  }
}

async function pasteText(page, locator, text) {
  await locator.focus().catch(() => {});

  await page.evaluate((t) => {
    return navigator.clipboard.writeText(t);
  }, text).catch(() => {});

  await page.keyboard.press("Control+V");
}

function getCommentBox(page) {
  return page.locator(
    '[contenteditable="true"][role="textbox"], ' +
    '[contenteditable="true"][aria-label*="Write a public comment" i], ' +
    '[contenteditable="true"][aria-label*="Écrire un commentaire" i], ' +
    '[contenteditable="true"][aria-label*="كتابة تعليق" i], ' +
    '[contenteditable="true"][aria-label*="تعليق" i]'
  ).first();
}

/*
 * كيقلب على التعليق اللي فيه "." بالضبط.
 * ما كيستعملش commentBox القديم من بعد النشر.
 */
function getExactDotComments(page) {
  return page.locator("div[dir='auto']").filter({
    hasText: /^\.$/
  });
}

/*
 * كيقلب على زر القائمة داخل أقرب ancestor
 * تابع للتعليق المحدد فقط.
 *
 * ما كيقلبش على menu button فصفحة Facebook كاملة.
 */
async function findOwnCommentMenuButton(commentLocator) {
  const menuSelector = [
    'div[role="button"][aria-haspopup="menu"]',
    'button[aria-haspopup="menu"]',

    'div[role="button"][aria-label*="comment" i]',
    'div[role="button"][aria-label*="more" i]',
    'div[role="button"][aria-label*="options" i]',
    'div[role="button"][aria-label*="actions" i]',

    'button[aria-label*="comment" i]',
    'button[aria-label*="more" i]',
    'button[aria-label*="options" i]',
    'button[aria-label*="actions" i]'
  ].join(", ");

  // كنبدأو من أقرب parent ونطلعو تدريجياً.
  for (let depth = 1; depth <= 12; depth++) {
    const ancestor = commentLocator.locator(
      `xpath=ancestor::div[${depth}]`
    );

    const ancestorCount = await ancestor.count().catch(() => 0);

    if (!ancestorCount) {
      break;
    }

    const candidates = ancestor.locator(menuSelector);
    const count = await candidates.count().catch(() => 0);

    if (!count) {
      continue;
    }

    // كنقلبو على زر menu مناسب داخل نفس ancestor.
    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);

      const visible = await candidate.isVisible().catch(() => false);

      if (!visible) {
        continue;
      }

      const attributes = await candidate.evaluate((el) => {
        return {
          label: el.getAttribute("aria-label") || "",
          hasPopup: el.getAttribute("aria-haspopup") || "",
          role: el.getAttribute("role") || "",
          text: (el.innerText || "").trim()
        };
      }).catch(() => null);

      if (!attributes) {
        continue;
      }

      const label = attributes.label.toLowerCase();

      const isMenuButton =
        attributes.hasPopup === "menu" ||
        label.includes("comment") ||
        label.includes("more") ||
        label.includes("options") ||
        label.includes("actions");

      if (isMenuButton) {
        console.log(
          `[MENU FOUND] Ancestor depth: ${depth}, Label: "${attributes.label}"`
        );

        return candidate;
      }
    }
  }

  return null;
}

/*
 * اختبار التعليق فقط بعد انتهاء مدة الحظر.
 */
async function testCommentOnly(profile, group_url) {
  const userDataDir = PROFILE_PATHS[profile];

  if (!userDataDir) {
    console.log(`[ERROR] Unknown profile path for: ${profile}`);
    return false;
  }

  let context = null;

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

    const page = await context.newPage();

    await page.goto(group_url, {
      waitUntil: "domcontentloaded"
    });

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);

    const commentBox = getCommentBox(page);

    const isVisible = await commentBox.isVisible().catch(() => false);

    if (!isVisible) {
      return false;
    }

    await commentBox.scrollIntoViewIfNeeded();
    await commentBox.click();

    await pasteText(page, commentBox, ".");

    await page.keyboard.press("Enter");
    await page.waitForTimeout(3000);

    const blockedPopup = page.getByText(
      /You can't use this feature at the moment|You Can't Use This Feature Right Now|Vous ne pouvez pas utiliser cette fonctionnalité|لا يمكنك استخدام هذه الميزة/i,
      { exact: false }
    );

    const isBlocked = await blockedPopup.isVisible().catch(() => false);

    if (isBlocked) {
      const okBtn = page.getByRole("button", {
        name: /^(OK|موافق)$/
      });

      await okBtn.click().catch(() => {});
      return false;
    }

    const errorIcon = page.locator(
      '[aria-hidden="true"] svg path[d*="7.5 7.5 0 1 0"]'
    ).first();

    const hasErrorIcon = await errorIcon.isVisible().catch(() => false);

    const dotComments = getExactDotComments(page);
    const commentFound = await dotComments.last().isVisible().catch(() => false);

    if (hasErrorIcon || !commentFound) {
      return false;
    }

    return true;

  } catch (e) {
    console.log(`[TEST COMMENT ERROR] ${profile}:`, e.message);
    return false;

  } finally {
    if (context) {
      const allPages = context.pages();

      for (const p of allPages) {
        try {
          await p.close();
        } catch (e) {}
      }

      await context.close();

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

/*
 * نشر التعليق المؤقت ثم تحديده وتعديله.
 */
async function editAndReplaceComment(page, finalPath, mainCommentText) {
  try {
    console.log("[STEP] Locating comment box...");

    const commentBox = getCommentBox(page);

    await commentBox.waitFor({
      state: "visible",
      timeout: 8000
    });

    /*
     * كنحفظو عدد التعليقات اللي فيها نقطة قبل النشر،
     * باش نعرفو واش تزاد تعليق جديد.
     */
    const dotCommentsBefore = getExactDotComments(page);
    const previousCount = await dotCommentsBefore.count().catch(() => 0);

    console.log(`[INFO] Existing exact dot comments: ${previousCount}`);

    console.log("[STEP] Posting initial placeholder comment...");

    await commentBox.scrollIntoViewIfNeeded();
    await commentBox.click();

    await pasteText(page, commentBox, ".");

    await page.keyboard.press("Enter");

    /*
     * مهم:
     * ما كنستعملوش commentBox القديم هنا.
     * كنعاودو نحددو التعليق من DOM بعد النشر.
     */
    console.log("[STEP] Waiting for the new placeholder comment...");

    let exactPostedComment = null;

    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(1000);

      const currentDotComments = getExactDotComments(page);
      const currentCount = await currentDotComments.count().catch(() => 0);

      if (currentCount > previousCount) {
        const candidate = currentDotComments.last();

        const visible = await candidate.isVisible().catch(() => false);

        if (visible) {
          exactPostedComment = candidate;
          break;
        }
      }
    }

    /*
     * Fallback: إلا تبدل DOM بطريقة خلات العدد ما يتبدلش،
     * كنستعملو آخر عنصر ظاهر فيه النقطة بالضبط.
     */
    if (!exactPostedComment) {
      const currentDotComments = getExactDotComments(page);

      const count = await currentDotComments.count().catch(() => 0);

      for (let i = count - 1; i >= 0; i--) {
        const candidate = currentDotComments.nth(i);

        if (await candidate.isVisible().catch(() => false)) {
          exactPostedComment = candidate;
          break;
        }
      }
    }

    if (!exactPostedComment) {
      throw new Error(
        "The newly posted placeholder comment could not be located."
      );
    }

    console.log("[SUCCESS] Placeholder comment located.");

    await exactPostedComment.scrollIntoViewIfNeeded();
    await exactPostedComment.hover();

    await page.waitForTimeout(1200);

    /*
     * هنا هو التصحيح الرئيسي:
     * كنلقاو menu button داخل أقرب ancestor ديال التعليق.
     */
    console.log("[STEP] Finding the menu of this exact comment...");

    const optionsButton = await findOwnCommentMenuButton(
      exactPostedComment
    );

    if (!optionsButton) {
      const ssPath = path.join(
        screenshotsDir,
        `comment_menu_not_found_${Date.now()}.png`
      );

      await page.screenshot({
        path: ssPath,
        fullPage: false
      }).catch(() => {});

      throw new Error(
        "Could not find a menu button inside the exact comment container. Screenshot: " +
        ssPath
      );
    }

    console.log("[STEP] Opening the exact comment menu...");

    await optionsButton.scrollIntoViewIfNeeded();
    await optionsButton.click();

    await page.waitForTimeout(1500);

    /*
     * من بعد ما فتحنا menu ديال التعليق،
     * كنقلبو على Edit / Modifier / تعديل.
     */
    console.log("[STEP] Looking for Edit option...");

    const editOption = page.locator(
      '[role="menuitem"]:has-text("Edit"), ' +
      '[role="menuitem"]:has-text("Modifier"), ' +
      '[role="menuitem"]:has-text("تعديل"), ' +
      'div[role="button"]:has-text("Edit"), ' +
      'div[role="button"]:has-text("Modifier"), ' +
      'div[role="button"]:has-text("تعديل")'
    ).last();

    await editOption.waitFor({
      state: "visible",
      timeout: 6000
    });

    await editOption.click();

    await page.waitForTimeout(1500);

    /*
     * تحرير التعليق.
     */
    console.log("[STEP] Replacing placeholder text...");

    const editBox = page.locator(
      'div[contenteditable="true"][role="textbox"]'
    ).last();

    await editBox.waitFor({
      state: "visible",
      timeout: 6000
    });

    await editBox.click();

    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    await page.waitForTimeout(500);

    await pasteText(page, editBox, mainCommentText);

    await page.waitForTimeout(1500);

    /*
     * إرفاق الصورة إذا كانت موجودة.
     */
    if (finalPath && fs.existsSync(finalPath)) {
      try {
        console.log("[STEP] Attaching image to edited comment...");

        const fileInputs = page.locator('input[type="file"]');
        const fileInputCount = await fileInputs.count();

        if (fileInputCount > 0) {
          await fileInputs.last().setInputFiles(finalPath);

        } else {
          const photoBtn = page.locator(
            '[aria-label*="Attach a photo" i], ' +
            '[aria-label*="Joignez une photo" i], ' +
            '[aria-label*="إرفاق صورة" i], ' +
            '[aria-label*="صورة" i]'
          ).last();

          if (await photoBtn.isVisible().catch(() => false)) {
            const [fileChooser] = await Promise.all([
              page.waitForEvent("filechooser", {
                timeout: 6000
              }),
              photoBtn.click()
            ]);

            await fileChooser.setFiles(finalPath);
          } else {
            console.log("[WARNING] Photo attachment button not found.");
          }
        }

        await page.waitForTimeout(3000);

      } catch (imgErr) {
        console.log("[EDIT IMAGE ERROR]:", imgErr.message);
      }
    }

    /*
     * حفظ التعديل.
     */
    console.log("[STEP] Saving edited comment...");

    await page.keyboard.press("Control+Enter");

    await page.waitForTimeout(4000);

    console.log("[SUCCESS] Comment edit process completed.");

    return true;

  } catch (err) {
    console.log("[EDIT COMMENT ERROR]:", err.message);

    return false;
  }
}

/*
 * تنفيذ مهمة واحدة.
 */
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

    const cleanPath = imagePath
      ? imagePath.replace(/^file:\/\/\/??/i, "")
      : "";

    const finalPath = path.normalize(
      decodeURIComponent(cleanPath)
    );

    await page.goto(group_url, {
      waitUntil: "domcontentloaded"
    });

    /*
     * فحص checkpoint.
     */
    if (await isCheckpoint(page)) {
      console.log(`[CHECKPOINT DETECTED] Profile: ${profile}`);

      const ssPath = path.join(
        screenshotsDir,
        `checkpoint_${profile.replace(/\s+/g, "_")}_${Date.now()}.png`
      );

      await page.screenshot({
        path: ssPath,
        fullPage: false
      }).catch(() => {});

      report.postStatus = "CHECKPOINT_REQUIRED";
      report.error =
        "Facebook requested human verification (Checkpoint/Captcha)";

      report.errorScreenshotBase64 = getBase64Image(ssPath);

      return report;
    }

    /*
     * فتح نافذة إنشاء المنشور.
     */
    const writeBtn = page.getByText(
      /Write something...|Créer un منشور|عن ماذا تفكر|أنشئ منشورًا|Exprimez-vous|اكتب شيئًا/i,
      { exact: false }
    ).first();

    await writeBtn.waitFor({
      state: "visible",
      timeout: 8000
    });

    await writeBtn.click();

    await page.waitForTimeout(2500);

    /*
     * إرفاق صورة المنشور.
     */
    if (finalPath && fs.existsSync(finalPath)) {
      const fileInput = page.locator('input[type="file"]').last();

      await fileInput.setInputFiles(finalPath);

      await page.waitForTimeout(1000);
    }

    /*
     * كتابة محتوى المنشور.
     */
    const postBox = page
      .getByRole("dialog")
      .locator('[contenteditable="true"]')
      .first();

    await postBox.waitFor({
      state: "visible",
      timeout: 8000
    });

    await postBox.click();

    await pasteText(page, postBox, title);

    /*
     * نشر المنشور.
     */
    const postButton = page.locator(
      '[aria-label="Post"], ' +
      '[aria-label="Publier"], ' +
      '[aria-label="نشر"]'
    ).last();

    await postButton.waitFor({
      state: "visible",
      timeout: 8000
    });

    await postButton.click({
      force: true
    });

    await page.waitForTimeout(3000);

    /*
     * فحص رسالة منع النشر.
     */
    const feedbackBlocked = page.locator(
      'div[role="button"]:has-text("Donner votre avis"), ' +
      'div[role="button"]:has-text("Give feedback"), ' +
      'div[role="button"]:has-text("تقديم ملاحظات")'
    ).first();

    const isFeedbackVisible = await feedbackBlocked
      .isVisible()
      .catch(() => false);

    if (isFeedbackVisible) {
      console.log(
        `[POST BLOCKED] ${profile}: Feedback popup detected.`
      );

      report.postStatus = "FAILED";
      report.commentStatus = "SKIPPED";

      report.error =
        "Post was blocked by Facebook (Donner votre avis popup detected).";

      const ssPath = path.join(
        screenshotsDir,
        `post_blocked_${profile.replace(/\s+/g, "_")}_${Date.now()}.png`
      );

      await page.screenshot({
        path: ssPath,
        fullPage: false
      }).catch(() => {});

      report.errorScreenshotBase64 = getBase64Image(ssPath);

      return report;
    }

    report.postStatus = "SUCCESS";

    await page.waitForTimeout(2000);

    /*
     * إغلاق dialogs المفتوحة.
     */
    for (let i = 0; i < 3; i++) {
      const dialog = page.getByRole("dialog").first();

      const dialogVisible = await dialog
        .isVisible()
        .catch(() => false);

      if (!dialogVisible) {
        break;
      }

      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);

    /*
     * إضافة / تعديل التعليق.
     */
    if (comment) {
      const editSuccess = await editAndReplaceComment(
        page,
        finalPath,
        comment
      );

      const blockedPopup = page.getByText(
        /You can't use this feature at the moment|You Can't Use This Feature Right Now|Vous ne pouvez pas utiliser cette fonctionnalité|لا يمكنك استخدام هذه الميزة/i,
        { exact: false }
      );

      const isBlocked = await blockedPopup
        .isVisible()
        .catch(() => false);

      if (isBlocked) {
        const closeBtn = page.locator(
          '[aria-label="Close"], ' +
          '[aria-label="Fermer"], ' +
          '[aria-label="إغلاق"]'
        ).first();

        const okBtn = page.getByRole("button", {
          name: /^(OK|موافق)$/i
        });

        await closeBtn.click().catch(async () => {
          await okBtn.click().catch(() => {});
        });

        report.commentStatus = "FAILED_RATE_LIMITED";

      } else if (!editSuccess) {
        report.commentStatus = "FAILED_COMMENT_ERROR";

      } else {
        report.commentStatus = "SUCCESS";
      }

    } else {
      report.commentStatus = "SKIPPED";
    }

  } catch (err) {
    report.error = err.message;

    if (page) {
      try {
        const ssPath = path.join(
          screenshotsDir,
          `error_${profile.replace(/\s+/g, "_")}_${Date.now()}.png`
        );

        await page.screenshot({
          path: ssPath,
          fullPage: false
        });

        report.errorScreenshotBase64 = getBase64Image(ssPath);

      } catch (ssErr) {
        console.log(
          "Failed to capture screenshot:",
          ssErr.message
        );
      }
    }

  } finally {
    if (context) {
      const allPages = context.pages();

      for (const p of allPages) {
        try {
          await p.close();
        } catch (e) {}
      }

      await context.close();

      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  return report;
}

/*
 * API endpoint.
 */
app.post("/browser", async (req, res) => {
  const {
    title,
    imagePath,
    comment,
    tasks
  } = req.body;

  const defaultTasks = [
    {
      profile: "Profile 3",
      group_url: "https://web.facebook.com/groups/365301486470237"
    }
  ];

  const taskList =
    tasks && Array.isArray(tasks) && tasks.length > 0
      ? tasks
      : defaultTasks;

  const results = [];

  for (const task of taskList) {
    const lastBlocked = rateLimitTracker.get(task.profile);
    const now = Date.now();

    /*
     * Cooldown.
     */
    if (lastBlocked && now - lastBlocked < COOL_DOWN_MS) {
      const waitTimeLeft = Math.ceil(
        (COOL_DOWN_MS - (now - lastBlocked)) / 1000
      );

      console.log(
        `[SKIP] ${task.profile} is in cool-down (${waitTimeLeft}s left).`
      );

      results.push({
        profile: task.profile,
        group_url: task.group_url,
        postStatus: "SKIPPED_COOL_DOWN",
        commentStatus: "SKIPPED_COOL_DOWN",
        error: `Rate limited / Group issue. Retry allowed in ${waitTimeLeft}s.`
      });

      continue;
    }

    /*
     * إعادة اختبار التعليق بعد مرور 15 دقيقة.
     */
    if (lastBlocked && now - lastBlocked >= COOL_DOWN_MS) {
      console.log(
        `[TESTING] 15 minutes passed for ${task.profile}. Testing comment...`
      );

      const canComment = await testCommentOnly(
        task.profile,
        task.group_url
      );

      if (!canComment) {
        console.log(
          `[STILL BLOCKED] ${task.profile} is still rate-limited.`
        );

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
        console.log(
          `[UNBLOCKED] ${task.profile} limit lifted! Running full task...`
        );

        rateLimitTracker.delete(task.profile);
      }
    }

    /*
     * تشغيل المهمة.
     */
    console.log(
      `[RUNNING] Executing task for ${task.profile}...`
    );

    const taskReport = await runSingleTask(
      task,
      title,
      imagePath,
      comment
    );

    /*
     * تسجيل المشاكل.
     */
    if (
      taskReport.postStatus !== "SUCCESS" ||
      taskReport.commentStatus === "FAILED_RATE_LIMITED" ||
      taskReport.error !== null
    ) {
      console.log(
        `[GROUP/TASK ISSUE] ${task.profile} failed task or got blocked. Setting 15-min timer.`
      );

      rateLimitTracker.set(task.profile, Date.now());
    }

    results.push(taskReport);
  }

  res.json(results);
});

/*
 * Start server.
 */
const server = app.listen(3001, () => {
  console.log("Playwright API running on port 3001");
});

server.timeout = 600000;
