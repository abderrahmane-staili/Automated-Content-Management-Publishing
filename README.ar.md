[English](README.md) | **العربية**

# أتمتة WordPress ← مجموعات Facebook بـ n8n وPlaywright

مشروع للـ portfolio يوضح كيف تُربط **n8n** و**REST APIs** و**Google Sheets** و**بوتات Node.js / Playwright تعمل على منافذ مستقلة** في خط أتمتة واحد.

![البنية](docs/architecture.svg)

## ماذا يفعل المشروع

1. **الجمع**: يسحب n8n المقالات (العنوان، الوصف، الصورة) من قائمة مواقع مصدر.
2. **النشر**: يُنشأ كل مقال على **WordPress** عبر REST API (رفع الصورة كوسيط media ثم إنشاء المقال).
3. **التخزين**: يُتتبَّع كل شيء في **Google Sheets** (الطابور، الحالة، رابط WordPress).
4. **التوزيع**: يقسّم n8n مجموعات Facebook على **4 sub-workflows**. كل واحد يستدعي **بوت Playwright** خاصاً به (منفذ خاص وملف Brave خاص) ينشر العنوان والصورة في المجموعة، ثم يضع رابط WordPress في أول تعليق.
5. **المراقبة**: يُرسَل النجاح والأخطاء إلى **Telegram**.

الهدف من تشغيل 4 بوتات بالتوازي هو إظهار التنسيق بين عدة عمليات، وتصميم الـ API، وإدارة الطوابير، ومعالجة الأخطاء، وليس زيادة الحجم.

## التقنيات المستعملة

| الطبقة             | التقنية                                            |
| ------------------ | -------------------------------------------------- |
| الأتمتة            | n8n (استضافة ذاتية على Docker)                     |
| أتمتة المتصفح      | Node.js 18+ وPlaywright وBrave (ملفات تعريف دائمة) |
| واجهة البوت        | Express (`/post-to-group` و`/health`)              |
| نظام إدارة المحتوى | WordPress REST API (Application Passwords)         |
| مخزن البيانات      | Google Sheets                                      |
| التنبيهات          | Telegram Bot API                                   |

## هيكل المشروع

```
.
├── docs/architecture.svg      # المخطط أعلاه
├── playwright-bot/
│   ├── server.js              # بوت واحد = منفذ واحد = ملف Brave واحد
│   ├── start-all.js           # يشغّل BOT_COUNT بوت (3001..3004)
│   └── package.json
├── scripts/first-login.js     # تسجيل دخول يدوي لـ Facebook مرة واحدة لكل ملف
├── workflows/                 # workflows مُصدَّرة من n8n (main + sub-1..4)
├── docker-compose.yml         # n8n
├── .env.example
├── README.md
└── README.ar.md
```

## المتطلبات

- Node.js **18+**
- Docker وDocker Compose
- متصفح Brave مثبّت
- موقع WordPress (5.6 أو أحدث) مع **Application Password**
- حساب Google (اعتماد Sheets في n8n)
- توكن بوت Telegram (اختياري، للتنبيهات)

## التثبيت

### 1. الاستنساخ والإعداد

```bash
git clone https://github.com/<your-username>/n8n-wp-facebook-automation.git
cd n8n-wp-facebook-automation
cp .env.example .env        # في PowerShell: copy .env.example .env
```

عدّل في `.env` القيمتين `BRAVE_PATH` و`API_KEY`.

### 2. تشغيل n8n

```bash
docker compose up -d
```

افتح <http://localhost:5678> وأنشئ حساب المالك.

### 3. تثبيت البوتات وتشغيلها

```bash
cd playwright-bot
npm install
npm run start:all             # يشغّل :3001 :3002 :3003 :3004
```

للتحقق:

```bash
curl -H "x-api-key: $API_KEY" http://localhost:3001/health
```

### 4. تسجيل الدخول إلى Facebook مرة لكل بوت

لكل بوت ملف Brave خاص به، لذلك يحتاج كل واحد إلى تسجيل دخول يدوي لمرة واحدة:

```bash
node scripts/first-login.js bot-1   # سجّل الدخول ثم أغلق النافذة
node scripts/first-login.js bot-2
node scripts/first-login.js bot-3
node scripts/first-login.js bot-4
```

تُحفظ الجلسات في `playwright-bot/profiles/` (مستثناة من git).
أوقف البوتات قبل تشغيل هذا السكربت، لأن ملف Brave الواحد لا يُفتح إلا مرة واحدة.

### 5. إعداد WordPress

1. *Users ← Profile ← Application Passwords* وأنشئ واحداً.
2. اختبره:

```bash
curl -u "user:APP_PASSWORD" https://your-site.com/wp-json/wp/v2/users/me
```

### 6. إعداد Google Sheets

أنشئ ملفاً واحداً بورقتين:

**`posts`**

| title | description | image_url | wp_post_id | wp_url | status |
| ----- | ----------- | --------- | ---------- | ------ | ------ |

**`groups`**

| group_url | bot (1-4) | last_posted_at |
| --------- | --------- | -------------- |

### 7. استيراد الـ workflows في n8n

1. في n8n: **Workflows ← Import from file** واستورد `workflows/sub-1.json` … `sub-4.json` أولاً، ثم `workflows/main.json`.
2. أنشئ الاعتمادات: **Google Sheets** و**WordPress** (HTTP Basic Auth) و**Telegram**، واعتمد **HTTP Header Auth** بالقيمة `x-api-key = <API_KEY>`.
3. في `main` اربط كل عقدة *Execute Workflow* بالـ sub-workflow المطابق.
4. في كل sub-workflow يجب أن تشير عقدة HTTP Request إلى:

   | الـ Sub-workflow | العنوان                                          |
   | ---------------- | ------------------------------------------------ |
   | Sub 1            | `http://host.docker.internal:3001/post-to-group` |
   | Sub 2            | `http://host.docker.internal:3002/post-to-group` |
   | Sub 3            | `http://host.docker.internal:3003/post-to-group` |
   | Sub 4            | `http://host.docker.internal:3004/post-to-group` |

5. فعّل الـ workflows.

## واجهة البوت (API)

`POST /post-to-group` (الترويسة `x-api-key`)

```json
{
  "groupUrl": "https://www.facebook.com/groups/123456789",
  "title": "عنوان المقال",
  "description": "نص اختياري يُضاف تحت العنوان",
  "imageUrl": "https://your-site.com/wp-content/uploads/2026/10/cover.jpg",
  "wpUrl": "https://your-site.com/my-article/"
}
```

الاستجابة: `{ "ok": true, "bot": "bot-1", "groupUrl": "..." }`
عند الفشل: HTTP 500 مع `error` ومسار `screenshot` للتشخيص.

الطلبات الموجهة لنفس البوت تُوضع في طابور وتُنفَّذ **واحداً تلو الآخر**.

## الإعدادات

| المتغير                         | الافتراضي    | الوصف                                       |
| ------------------------------- | ------------ | ------------------------------------------- |
| `BRAVE_PATH`                    | –            | مسار ملف Brave التنفيذي                     |
| `API_KEY`                       | –            | سر مشترك بين n8n والبوتات                   |
| `BOT_COUNT`                     | 4            | عدد البوتات                                 |
| `BASE_PORT`                     | 3001         | أول منفذ                                    |
| `MIN_DELAY_MS` / `MAX_DELAY_MS` | 4000 / 12000 | توقف عشوائي يحاكي السلوك البشري بين الخطوات |
| `HEADLESS`                      | false        | تشغيل Brave بدون نافذة                      |

## حل المشاكل

| المشكلة                                           | الحل                                                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| n8n لا يصل إلى البوت                              | استعمل `host.docker.internal` (مضبوط في `docker-compose.yml`) وتأكد أن البوت يستمع على `0.0.0.0`       |
| `Target page, context or browser has been closed` | الملف مفتوح في نافذة Brave أخرى. أغلقها                                                                |
| انتهاء مهلة الـ selectors                         | واجهة Facebook تتغير كثيراً. عدّل الأنماط في `playwright-bot/server.js` (يوجد دعم للإنجليزية والفرنسية) |
| صفحة checkpoint أو تسجيل الدخول                   | أعد تشغيل `scripts/first-login.js <bot>`                                                               |

## الأمان

- لا ترفع أبداً `.env` أو مفاتيح API أو توكنات Telegram أو كلمات السر أو مجلد `playwright-bot/profiles/` (يحتوي جلسات Facebook).
- راجع كل ملف JSON في `workflows/` قبل الرفع وأزل أي سر أو معرّف خاص (توكنات، Chat IDs، Sheet IDs).
- ضع قيمة قوية لـ `API_KEY`، ولا تعرّض منافذ البوتات للإنترنت.

## الاستعمال المسؤول

هذا المشروع عرض تقني للأتمتة وتكامل الـ APIs والتنسيق بين عدة عمليات.

- أتمتة Facebook قد تخالف شروط الخدمة وقد تؤدي إلى تقييد الحسابات. استعمل حسابات تجريبية ومجموعات تملكها أو تديرها أو حصلت على إذن مشرفيها.
- أعد نشر المحتوى الذي تملكه أو لديك ترخيص باستعماله فقط.
- أبقِ إعدادات التأخير، والتزم بقواعد كل مجموعة وحدود النشر فيها.

المؤلف غير مسؤول عن سوء الاستعمال.

## خارطة الطريق

- [ ] حد يومي وفترة انتظار لكل مجموعة يُخزَّنان في Google Sheets
- [ ] صورة Docker للبوتات
- [ ] لوحة متابعة (سجل التشغيل، نسبة النجاح)
- [ ] إعادة المحاولة بتأخير تصاعدي

## الرخصة

المشروع مرخص بموجب [رخصة MIT](LICENSE).
