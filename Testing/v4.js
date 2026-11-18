
const express = require("express");
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.json({ limit: "20mb" }));

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

// --------------------------------------------------
// HELPERS
// --------------------------------------------------

function getBase64Image(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) {
      return fs.readFileSync(filePath).toString("base64");
    }
  } catch (e) {
    console.log("Error converting image to Base64:", e.message);
  }

  return null;
}

async function saveScreenshot(page, prefix) {
  try {
    const ssPath = path.join(
      screenshotsDir,
      `${prefix}_${Date.now()}.png`
    );

    await page.screenshot({
      path: ssPath,
      fullPage: false
    });

    console.log(`[SCREENSHOT] ${ssPath}`);
    return ssPath;
  } catch (e) {
    console.log("[SCREENSHOT ERROR]", e.message);
    return null;
  }
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
  await locator.click();
  await locator.focus();

  await page.evaluate(async (value) => {
    await navigator.clipboard.writeText(value);
  }, text);

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

// --------------------------------------------------
// EXACT PLACEHOLDER COMMENT
// --------------------------------------------------

function getExactDotComments(page) {
  return page.locator("div[dir='auto']").filter({
    hasText: /^\.$/
  });
}

// --------------------------------------------------
// FIND THE COMMENT MENU
// --------------------------------------------------

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

  for (let depth = 1; depth <= 12; depth++) {
    const ancestor = commentLocator.locator(
      `xpath=ancestor::div[${depth}]`
    );

    const candidates = ancestor.locator(menuSelector);
    const count = await candidates.count().catch(() => 0);

    if (!count) continue;

    for (let i = 0; i < count; i++) {
      const candidate = candidates.nth(i);

      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }

      const attributes = await candidate.evaluate((el) => ({
        label: el.getAttribute("aria-label") || "",
        hasPopup: el.getAttribute("aria-haspopup") || ""
      })).catch(() => null);

      if (!attributes) continue;

      const label = attributes.label.toLowerCase();

      if (
        attributes.hasPopup === "menu" ||
        label.includes("comment") ||
        label.includes("more") ||
        label.includes("options") ||
        label.includes("actions")
      ) {
        console.log(
          `[MENU FOUND] Ancestor depth: ${depth}, Label: ${attributes.label}`
        );

        return candidate;
      }
    }
  }

  return null;
}

// --------------------------------------------------
// FIND THE EXACT EDITOR CONTAINING "."
// --------------------------------------------------

async function findExactPlaceholderEditor(page) {
  const selector =
    'div[contenteditable="true"][role="textbox"][data-lexical-editor="true"]';

  const editors = page.locator(selector);
  const count = await editors.count().catch(() => 0);

  console.log(`[INFO] Found ${count} lexical editors.`);

  const matches = [];

  for (let i = 0; i < count; i++) {
    const editor = editors.nth(i);

    if (!await editor.isVisible().catch(() => false)) {
      continue;
    }

    const text = await editor.innerText().catch(() => "");
    const label = await editor.getAttribute("aria-label").catch(() => "");

    console.log(
      `[EDITOR CHECK] ${i} | Text: "${text.trim()}" | Label: ${label}`
    );

    if (text.trim() === ".") {
      matches.push(editor);
    }
  }

  if (matches.length === 1) {
    console.log("[EDITOR MATCH] Exact placeholder editor found.");
    return matches[0];
  }

  if (matches.length > 1) {
    console.log(
      `[WARNING] Found ${matches.length} editors containing only ".".`
    );
    return null;
  }

  return null;
}

// --------------------------------------------------
// FIND FILE INPUT NEAR EDITOR
// --------------------------------------------------

async function findFileInputNearEditor(editBox) {
  for (let depth = 1; depth <= 12; depth++) {
    const ancestor = editBox.locator(
      `xpath=ancestor::div[${depth}]`
    );

    const inputs = ancestor.locator('input[type="file"]');
    const count = await inputs.count().catch(() => 0);

    if (count > 0) {
      console.log(
        `[FILE INPUT FOUND] Ancestor depth: ${depth}, count: ${count}`
      );

      return inputs.last();
    }
  }

  return null;
}

// --------------------------------------------------
// FIND PHOTO BUTTON NEAR EDITOR
// --------------------------------------------------

async function findPhotoButtonNearEditor(editBox) {
  const photoSelector = [
    '[aria-label*="Attach a photo" i]',
    '[aria-label*="Add photo" i]',
    '[aria-label*="Photo" i]',
    '[aria-label*="Joignez une photo" i]',
    '[aria-label*="Ajouter une photo" i]',
    '[aria-label*="إرفاق صورة" i]',
    '[aria-label*="إضافة صورة" i]',
    '[aria-label*="صورة" i]'
  ].join(", ");

  for (let depth = 1; depth <= 12; depth++) {
    const ancestor = editBox.locator(
      `xpath=ancestor::div[${depth}]`
    );

    const buttons = ancestor.locator(photoSelector);
    const count = await buttons.count().catch(() => 0);

    for (let i = count - 1; i >= 0; i--) {
      const candidate = buttons.nth(i);

      if (await candidate.isVisible().catch(() => false)) {
        console.log(`[PHOTO BUTTON FOUND] Ancestor depth: ${depth}`);
        return candidate;
      }
    }
  }

  return null;
}

// --------------------------------------------------
// FIND AND CLICK FACEBOOK COMMENT SUBMIT BUTTON
// --------------------------------------------------

async function submitEditedComment(page, editBox, mainCommentText) {
  console.log("[STEP] Checking text before submitting...");

  const currentText = await editBox.innerText().catch(() => "");

  if (!currentText.includes(mainCommentText)) {
    throw new Error(
      `URL is missing from editor. Current text: "${currentText}"`
    );
  }

  // Selector taken from the HTML supplied by the user.
  const submitSelector =
    '#focused-state-composer-submit [aria-label="تعليق على منشور"]';

  console.log("[STEP] Locating Facebook comment submit button...");

  let submitButton = null;

  for (let attempt = 0; attempt < 20; attempt++) {
    const buttons = page.locator(submitSelector);
    const count = await buttons.count().catch(() => 0);

    for (let i = count - 1; i >= 0; i--) {
      const candidate = buttons.nth(i);

      const visible = await candidate
        .isVisible()
        .catch(() => false);

      const enabled = await candidate
        .isEnabled()
        .catch(() => false);

      if (visible && enabled) {
        submitButton = candidate;
        break;
      }
    }

    if (submitButton) break;

    await page.waitForTimeout(500);
  }

  if (!submitButton) {
    const ssPath = await saveScreenshot(
      page,
      "comment_submit_button_not_found"
    );

    throw new Error(
      `Facebook comment submit button not found. Screenshot: ${ssPath || "unavailable"}`
    );
  }

  console.log("[STEP] Clicking Facebook comment submit button...");

  await submitButton.scrollIntoViewIfNeeded();
  await submitButton.click();

  console.log("[STEP] Waiting for edited comment to publish...");

  let updateVerified = false;

  for (let attempt = 0; attempt < 20; attempt++) {
    await page.waitForTimeout(1000);

    const matchingComments = page
      .locator("div[dir='auto']")
      .filter({
        hasText: new RegExp(
          mainCommentText.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
        )
      });

    const matchingCount = await matchingComments
      .count()
      .catch(() => 0);

    for (let i = 0; i < matchingCount; i++) {
      const candidate = matchingComments.nth(i);

      if (!await candidate.isVisible().catch(() => false)) {
        continue;
      }

      const text = await candidate.innerText().catch(() => "");

      if (text.includes(mainCommentText)) {
        updateVerified = true;
        break;
      }
    }

    if (updateVerified) break;
  }

  if (!updateVerified) {
    const ssPath = await saveScreenshot(
      page,
      "comment_submit_not_verified"
    );

    throw new Error(
      `Submit was clicked, but the edited comment was not verified. Screenshot: ${ssPath || "unavailable"}`
    );
  }

  console.log("[SUCCESS] Edited comment successfully published.");

  return true;
}

// --------------------------------------------------
// TEST COMMENT PERMISSION
// --------------------------------------------------

async function testCommentOnly(profile, group_url) {
  const userDataDir = PROFILE_PATHS[profile];

  if (!userDataDir) {
    console.log(`[ERROR] Unknown profile: ${profile}`);
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

    if (!await commentBox.isVisible().catch(() => false)) {
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

    if (await blockedPopup.isVisible().catch(() => false)) {
      const okBtn = page.getByRole("button", {
        name: /^(OK|موافق)$/i
      });

      await okBtn.click().catch(() => {});
      return false;
    }

    const dotComments = getExactDotComments(page);
    const commentFound = await dotComments.last()
      .isVisible()
      .catch(() => false);

    return commentFound;

  } catch (e) {
    console.log(`[TEST COMMENT ERROR] ${profile}:`, e.message);
    return false;

  } finally {
    if (context) {
      for (const p of context.pages()) {
        try {
          await p.close();
        } catch (e) {}
      }

      await context.close();
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }
}

// --------------------------------------------------
// EDIT AND REPLACE COMMENT
// --------------------------------------------------

async function editAndReplaceComment(page, finalPath, mainCommentText) {
  try {
    console.log("[STEP] Locating comment box...");

    const commentBox = getCommentBox(page);

    await commentBox.waitFor({
      state: "visible",
      timeout: 8000
    });

    const previousCount = await getExactDotComments(page)
      .count()
      .catch(() => 0);

    // Post placeholder.
    console.log("[STEP] Posting initial placeholder comment...");

    await commentBox.scrollIntoViewIfNeeded();
    await commentBox.click();

    await pasteText(page, commentBox, ".");

    await page.keyboard.press("Enter");

    // Find newly posted placeholder.
    console.log("[STEP] Waiting for placeholder comment...");

    let exactPostedComment = null;

    for (let attempt = 0; attempt < 15; attempt++) {
      await page.waitForTimeout(1000);

      const currentComments = getExactDotComments(page);
      const currentCount = await currentComments.count().catch(() => 0);

      if (currentCount > previousCount) {
        for (let i = currentCount - 1; i >= previousCount; i--) {
          const candidate = currentComments.nth(i);

          if (!await candidate.isVisible().catch(() => false)) {
            continue;
          }

          const text = await candidate.innerText().catch(() => "");

          if (text.trim() === ".") {
            exactPostedComment = candidate;
            break;
          }
        }
      }

      if (exactPostedComment) break;
    }

    if (!exactPostedComment) {
      throw new Error("New placeholder comment was not found.");
    }

    console.log("[SUCCESS] Placeholder comment located.");

    await exactPostedComment.scrollIntoViewIfNeeded();
    await exactPostedComment.hover();

    await page.waitForTimeout(1200);

    // Find the menu for this exact comment.
    console.log("[STEP] Finding this comment's menu...");

    const optionsButton = await findOwnCommentMenuButton(
      exactPostedComment
    );

    if (!optionsButton) {
      throw new Error("Own comment menu not found.");
    }

    console.log("[STEP] Opening comment menu...");

    await optionsButton.scrollIntoViewIfNeeded();
    await optionsButton.click();

    await page.waitForTimeout(1500);

    // Click Edit.
    console.log("[STEP] Clicking Edit...");

    const editOptions = page.locator(
      '[role="menuitem"]:has-text("Edit"), ' +
      '[role="menuitem"]:has-text("Modifier"), ' +
      '[role="menuitem"]:has-text("تعديل"), ' +
      'div[role="button"]:has-text("Edit"), ' +
      'div[role="button"]:has-text("Modifier"), ' +
      'div[role="button"]:has-text("تعديل")'
    );

    let editOption = null;

    const editCount = await editOptions.count().catch(() => 0);

    for (let i = editCount - 1; i >= 0; i--) {
      const candidate = editOptions.nth(i);

      if (await candidate.isVisible().catch(() => false)) {
        editOption = candidate;
        break;
      }
    }

    if (!editOption) {
      throw new Error("Edit/Modifier option was not found.");
    }

    await editOption.click();

    await page.waitForTimeout(1500);

    // Find the exact editor containing ".".
    console.log("[STEP] Locating exact placeholder editor...");

    let editBox = null;

    for (let attempt = 0; attempt < 10; attempt++) {
      editBox = await findExactPlaceholderEditor(page);

      if (editBox) break;

      await page.waitForTimeout(500);
    }

    if (!editBox) {
      throw new Error(
        'Could not uniquely identify the editor containing ".".'
      );
    }

    console.log("[SUCCESS] Exact placeholder editor found.");

    await editBox.scrollIntoViewIfNeeded();
    await editBox.click();
    await editBox.focus();

    const beforeText = await editBox.innerText().catch(() => "");

    if (beforeText.trim() !== ".") {
      throw new Error(
        `Wrong editor selected. Expected "." but found "${beforeText.trim()}"`
      );
    }

    // Remove placeholder.
    console.log("[STEP] Removing placeholder...");

    await page.keyboard.press("Control+A");
    await page.keyboard.press("Backspace");

    await page.waitForTimeout(500);

    // Insert URL.
    console.log("[STEP] Inserting URL/comment...");

    await pasteText(page, editBox, mainCommentText);

    await page.waitForTimeout(1000);

    const insertedText = await editBox.innerText().catch(() => "");

    console.log("[INFO] Text inside editor:", insertedText);

    if (!insertedText.includes(mainCommentText)) {
      throw new Error("The new URL/text was not inserted correctly.");
    }

    // Attach image.
    if (finalPath && fs.existsSync(finalPath)) {
      console.log("[STEP] Looking for photo attachment...");

      let fileInput = await findFileInputNearEditor(editBox);

      if (fileInput) {
        console.log("[STEP] Setting image through nearby file input...");

        await fileInput.setInputFiles(finalPath);

      } else {
        const photoButton = await findPhotoButtonNearEditor(editBox);

        if (!photoButton) {
          throw new Error(
            "Photo button/file input was not found near the selected editor."
          );
        }

        console.log("[STEP] Clicking photo attachment button...");

        const [fileChooser] = await Promise.all([
          page.waitForEvent("filechooser", {
            timeout: 10000
          }),
          photoButton.click()
        ]);

        await fileChooser.setFiles(finalPath);
      }

      console.log("[SUCCESS] Image selected.");

      // Wait for Facebook to process the attached image.
      await page.waitForTimeout(3500);
    }

    // Confirm text still exists.
    const textBeforeSubmit = await editBox.innerText().catch(() => "");

    if (!textBeforeSubmit.includes(mainCommentText)) {
      throw new Error(
        "URL disappeared from editor before submitting."
      );
    }

    // Submit using the actual Facebook button from supplied HTML.
    console.log("[STEP] Submitting edited comment...");

    await submitEditedComment(
      page,
      editBox,
      mainCommentText
    );

    return true;

  } catch (err) {
    console.log("[EDIT COMMENT ERROR]:", err.message);

    await saveScreenshot(page, "edit_comment_error");

    return false;
  }
}

// --------------------------------------------------
// RUN SINGLE TASK
// --------------------------------------------------

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

    const finalPath = cleanPath
      ? path.normalize(decodeURIComponent(cleanPath))
      : "";

    await page.goto(group_url, {
      waitUntil: "domcontentloaded"
    });

    // Checkpoint detection.
    if (await isCheckpoint(page)) {
      console.log(`[CHECKPOINT DETECTED] Profile: ${profile}`);

      const ssPath = await saveScreenshot(
        page,
        `checkpoint_${profile.replace(/\s+/g, "_")}`
      );

      report.postStatus = "CHECKPOINT_REQUIRED";
      report.error =
        "Facebook requested human verification (Checkpoint/Captcha)";

      report.errorScreenshotBase64 = getBase64Image(ssPath);

      return report;
    }

    // Open post composer.
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

    // Attach main post image.
    if (finalPath && fs.existsSync(finalPath)) {
      const fileInput = page
        .getByRole("dialog")
        .locator('input[type="file"]')
        .last();

      await fileInput.setInputFiles(finalPath);

      await page.waitForTimeout(1000);
    }

    // Write main post title.
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

    // Publish main post.
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

    // Check if Facebook blocked the post.
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
        "Post was blocked by Facebook (Feedback popup detected).";

      const ssPath = await saveScreenshot(
        page,
        `post_blocked_${profile.replace(/\s+/g, "_")}`
      );

      report.errorScreenshotBase64 = getBase64Image(ssPath);

      return report;
    }

    report.postStatus = "SUCCESS";

    await page.waitForTimeout(2000);

    // Close any remaining dialogs.
    for (let i = 0; i < 3; i++) {
      const dialog = page.getByRole("dialog").first();

      const dialogVisible = await dialog
        .isVisible()
        .catch(() => false);

      if (!dialogVisible) break;

      await page.keyboard.press("Escape");
      await page.waitForTimeout(1000);
    }

    await page.mouse.wheel(0, 300);
    await page.waitForTimeout(1000);

    // Edit the comment.
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
      const ssPath = await saveScreenshot(
        page,
        `error_${profile.replace(/\s+/g, "_")}`
      );

      report.errorScreenshotBase64 = getBase64Image(ssPath);
    }

  } finally {
    if (context) {
      for (const p of context.pages()) {
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

// --------------------------------------------------
// API
// --------------------------------------------------

app.post("/browser", async (req, res) => {
  const {
    title,
    imagePath,
    comment,
    tasks
  } = req.body;

  const defaultTasks = [
    { profile: "Profile 1", group_url: "https://web.facebook.com/groups/736575628842964" }
   ];

  const taskList =
    tasks && Array.isArray(tasks) && tasks.length > 0
      ? tasks
      : defaultTasks;

  const results = [];

  for (const task of taskList) {
    const lastBlocked = rateLimitTracker.get(task.profile);
    const now = Date.now();

    // Cooldown check.
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

    // Retest after cooldown.
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

    console.log(
      `[RUNNING] Executing task for ${task.profile}...`
    );

    const taskReport = await runSingleTask(
      task,
      title,
      imagePath,
      comment
    );

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

// --------------------------------------------------
// START SERVER
// --------------------------------------------------

const server = app.listen(3001, () => {
  console.log("Playwright API running on port 3001");
});

server.timeout = 600000;
