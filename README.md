# 🌾 कृषि समाचार — AI Farmer News

**भारत का नंबर 1 AI-Powered किसान न्यूज़लेटर — 14 भाषाओं में**

---

## 📁 Project Structure

```
krishi-samachar/
├── index.html          ← Main website (Frontend)
├── api/
│   ├── news.js         ← AI News Generator API
│   └── detail.js       ← AI News Detail API
├── vercel.json         ← Vercel Config
├── package.json        ← Project Info
└── README.md           ← यह फ़ाइल
```

---

## 🚀 Vercel पर FREE Deploy करने के Steps

### Step 1 — GitHub Account बनाएं
👉 https://github.com/signup पर जाएं
- Username, Email, Password डालें
- Free account बनाएं

### Step 2 — New Repository बनाएं
- GitHub पर login करें
- "New" button पर click करें
- Repository name: `krishi-samachar`
- Public रखें
- "Create repository" करें

### Step 3 — Files Upload करें
- Repository page पर "uploading an existing file" पर click करें
- सभी files drag & drop करें:
  - index.html
  - vercel.json
  - package.json
  - api/ folder (news.js और detail.js के साथ)
- "Commit changes" पर click करें

### Step 4 — Vercel Account बनाएं
👉 https://vercel.com/signup पर जाएं
- "Continue with GitHub" पर click करें
- GitHub account से login करें
- FREE plan चुनें

### Step 5 — Project Deploy करें
- Vercel Dashboard पर "Add New Project" करें
- अपना `krishi-samachar` repository select करें
- "Deploy" button पर click करें
- ✅ Deploy हो जाएगा!

### Step 6 — Anthropic API Key डालें (सबसे ज़रूरी!)
- 👉 https://console.anthropic.com पर जाएं
- Sign up करें (Free credits मिलते हैं!)
- "API Keys" section में "Create Key" करें
- Key copy करें

**Vercel में key डालें:**
- Vercel Dashboard → आपका Project → Settings → Environment Variables
- Name: `ANTHROPIC_API_KEY`
- Value: आपकी API key paste करें
- "Save" करें
- Project को "Redeploy" करें

---

## 🌐 आपकी Website Live होगी!

Deploy होने के बाद आपको मिलेगा:
```
https://krishi-samachar-yourname.vercel.app
```

यह URL आप किसी को भी share कर सकते हैं! 📱

---

## ✨ Features

- ✅ 14 भाषाओं में AI News
- ✅ Daily Auto Update
- ✅ Click करके detail पढ़ें
- ✅ Mobile Friendly
- ✅ 100% FREE hosting

---

## 💰 Cost

| Service | Cost |
|---------|------|
| Vercel Hosting | FREE (100GB/month) |
| GitHub | FREE |
| Anthropic API | ~₹0.10 per 10 news fetch |

---

## 📞 Problems?

किसी भी problem के लिए Claude से पूछें! 🤖
