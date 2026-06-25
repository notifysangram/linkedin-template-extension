# LinkedIn Message Templates

A Chrome extension (Manifest V3) that helps you manage LinkedIn messages faster — save reply templates, auto-draft AI replies, and track your post analytics — all without leaving LinkedIn.

---

## Features

### 💬 Message Templates
- Save reusable reply templates and insert them into any LinkedIn message in one click
- Use `{{firstName}}` in your template body — the extension fills in the recipient's name automatically
- Add, edit, delete, import, and export templates as JSON (great for backup or sharing across devices)
- **Keyboard shortcut:** `⌘⇧L` (Mac) / `Ctrl+Shift+L` (Windows/Linux) opens the template picker in the active conversation

### 🤖 AI Auto-Draft (powered by Claude via Portkey)
- When you open a conversation, the extension automatically drafts a reply into the empty message box
- Only drafts when the **other person sent the last message** — never overwrites something you've already typed
- Each thread is drafted once per browsing session; nothing is ever sent automatically
- The default reply tone is warm and professional, defaulting to a polite decline (configurable via Reply Preferences)

### 📊 Post Analytics Dashboard
- Open LinkedIn's [Creator Analytics → Content](https://www.linkedin.com/analytics/creator/content/) page and the extension automatically collects your post data
- Dashboard shows: total impressions, average impressions per post, average engagement rate, and posts tracked
- Sparkline chart of your last 20 posts and a top-posts table sorted by impressions
- Use the **Scrape now** button in the popup to manually refresh data from an open analytics tab

---

## Installation

> This extension is not on the Chrome Web Store — load it manually as an unpacked extension.

1. Clone or download this repo
2. Open Chrome → go to `chrome://extensions`
3. Enable **Developer mode** (top-right toggle)
4. Click **Load unpacked** → select the `linkedin-template-extension` folder
5. The extension icon appears in your toolbar

---

## AI Setup (optional — needed for auto-draft)

The AI features use **Claude** via [Portkey](https://portkey.ai) as the API gateway.

1. Sign up at [portkey.ai](https://portkey.ai) and get an API key
2. In Portkey, create a Virtual Key pointing to your Anthropic (Claude) account
3. Click the extension icon → expand **AI Settings (Portkey → Claude)**
4. Paste your **Portkey API key** and **Virtual key**
5. Choose your model (Opus = most capable, Haiku = fastest/cheapest)
6. Optionally add **Reply preferences** to customize the tone or content of drafts

> Your API key is stored locally on your device only and is never sent anywhere except the Portkey gateway.

---

## Enabling Auto-Draft

1. Click the extension icon → expand **Auto-draft replies**
2. Check **"Auto-draft a reply when I open a conversation"**
3. Open or refresh LinkedIn — the extension snapshots your current unreads as backlog (ignores them)
4. Any new conversation you open after that will get a draft ready for you to review and send

---

## File Structure

```
├── manifest.json       # MV3 extension manifest
├── background.js       # Service worker — handles AI API calls via Portkey
├── content.js          # Injected into LinkedIn — templates, auto-draft, analytics scraping
├── content.css         # Styles for injected UI elements
├── popup.html          # Extension popup UI
├── popup.js            # Popup logic — templates, settings, analytics dashboard
├── popup.css           # Popup styles
└── icons/              # Extension icons (16, 48, 128px)
```

---

## Tech Stack

- **Chrome Extension Manifest V3**
- **Claude** (via [Portkey](https://portkey.ai)) for AI reply generation and message classification
- Vanilla JS — no build step, no dependencies

---

## License

MIT
