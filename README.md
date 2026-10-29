# Vocab Collector

**Save new English words while you read, with the sentence you found them in, and remember them with Anki.**

English | [简体中文](README.zh-CN.md)

![Select a word and click + to save it with its sentence](docs/images/add-dialog.png)

---

## Why

When you read in a second language, you meet a new word, look it up, understand it… and forget it a week later.

A word list does not help much: a word on its own is hard to remember. **The sentence where you met it** is what gives it meaning.

Vocab Collector is a small browser extension for people who are learning English. It makes saving a word take **one click**, keeps the real sentence with it, and sends it to **Anki**, so a proven memory system (spaced repetition) brings it back right before you forget it.

## How it works

1. **Select a word** on any web page (double-click works).
2. **Click the blue +** next to it. The sentence around the word is found for you.
3. **Check and add.** The card goes straight into Anki, ready to review.

Optional: add an AI key, and the back of each card gets a **short explanation in simple English**, for the meaning the word has *in that sentence*, not a long dictionary list.

## Features

- **One-click saving** with the **+** button, a keyboard shortcut (`Alt+Shift+S` / `⌥⇧S`), or the right-click menu
- **Sentence found for you.** It understands things like "Dr.", "e.g." and "3.5", so sentences are not cut in the wrong place. You can still edit it.
- **Or select a whole sentence**, press the shortcut, and click the new word in it
- **Simple English meaning (optional).** Works with DeepSeek, Kimi, Qwen, or any OpenAI-compatible API. Without a key, the back of the card stays empty and you can write your own meaning.
- **Sends cards to Anki automatically** through AnkiConnect. The deck and card style are created for you.
- **Never loses a word.** If Anki is closed, cards wait in the extension and are sent when Anki opens.
- **Duplicate warning.** If you saved the word before, you see the old sentence and decide.
- **Copy for my AI.** Copy this week's words with a ready-made request, paste it into any AI chat, and get a short story and a quiz that use all your words.
- **Backup and restore** as a JSON file
- **Light and dark mode.** Works in Chrome, Edge, and other Chromium browsers on **Mac and Windows**.

## The card

Front: the word in bold, then the sentence with the word underlined. Back: the meaning in simple English, plus a link back to the page.

![Anki card: front and back](docs/images/anki-card.png)

Review it in Anki, on your computer or your phone (AnkiDroid / AnkiMobile). Turn on **FSRS** in the deck options to get the best review schedule.

## Your words page

Click the toolbar icon to see all your words, check the Anki connection, copy words for your AI, and change settings.

![The My words page](docs/images/manager.png)

## Install

You need: **Chrome or Edge**, **[Anki](https://apps.ankiweb.net)** for desktop, and the **AnkiConnect** add-on (code `2055492159`).

1. Download **`vocab-collector-v….zip`** from the [latest release](https://github.com/Lauren-fu/vocab-collector/releases/latest) and unzip it. Keep the `extension` folder in a fixed place.
2. Open `chrome://extensions` (or `edge://extensions`), turn on **Developer mode**, click **Load unpacked**, and choose the `extension` folder.
3. In Anki, go to **Tools → Add-ons → Get Add-ons**, enter `2055492159`, then restart Anki.
4. Click the extension's toolbar icon. When you see **Connected to Anki**, you are ready.
5. *(Optional)* In **Settings**, choose an AI and paste your API key, then click **Test AI**.

A step-by-step guide in Chinese is in **[安装说明.md](安装说明.md)**.

## Privacy

- Your words are stored **only in your browser** and in **your own Anki**. There is no server and no account.
- If you add an AI key, only **the word and its sentence** are sent to the AI service you chose, to get the meaning. Your key stays in your browser.
- AnkiConnect runs on your own computer (`127.0.0.1`).

## Roadmap

Vocab Collector starts as a browser extension. The goal is a **desktop app for Mac and Windows**.

- [x] **v0.1:** browser extension that collects words and sends them to Anki
- [ ] **v0.2:** fill in missing meanings for old cards with one click; publish to the Edge Add-ons store
- [ ] **v1.0:** desktop app: save words from **any** app (PDF readers, e-books…) with a global shortcut, and review inside the app (FSRS, 3 buttons: *Forgot / Unsure / Know*)

## For developers

Plain JavaScript (Manifest V3). No build step and no dependencies.

```
extension/
  manifest.json
  background.js      # service worker: saving, AI calls, sending to Anki
  content.js         # the + button and the "Add a word" dialog on web pages
  options.html/js    # the "My words" and settings page
  lib/sentence.js    # finds the word and its sentence (no DOM, reusable)
  lib/ai.js          # simple-English meaning from any OpenAI-compatible API
  lib/anki.js        # AnkiConnect: note type, deck, adding notes
  lib/store.js       # local storage for cards and settings
tests/
  sentence.test.js   # unit tests for sentence finding
  harness.html       # runs the extension in a normal page with a fake chrome API, AI and Anki
```

Run the sentence tests on macOS with the built-in JavaScript engine:

```bash
/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc extension/lib/sentence.js tests/sentence.test.js
```

To try the UI without installing anything, serve the repository folder (for example `python3 -m http.server`) and open `tests/harness.html` or `tests/options-harness.html`.
