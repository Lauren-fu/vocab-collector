// Talks to the Anki desktop app through the AnkiConnect add-on (http://127.0.0.1:8765).
// Docs: https://git.foosoft.net/alex/anki-connect

const ANKI_URL = "http://127.0.0.1:8765";
export const MODEL_NAME = "Vocab Collector";

export class AnkiNotRunningError extends Error {}

async function invoke(action, params = {}) {
  let res;
  try {
    res = await fetch(ANKI_URL, {
      method: "POST",
      body: JSON.stringify({ action, version: 6, params }),
    });
  } catch {
    throw new AnkiNotRunningError("Anki is not open, or AnkiConnect is not installed.");
  }
  if (res.status === 403) {
    throw new Error("Anki did not allow Vocab Collector. Allow it in Anki and try again.");
  }
  const data = await res.json();
  if (data.error) throw new Error(`Anki: ${data.error}`);
  return data.result;
}

// AnkiConnect trusts browser extensions by default, so this normally answers "granted" without asking.
// If the user changed AnkiConnect's settings, Anki may show a window asking to allow this extension.
async function askPermission() {
  const result = await invoke("requestPermission");
  if (result?.permission !== "granted") {
    throw new Error("Anki did not allow Vocab Collector. Allow it in Anki and try again.");
  }
}

// Returns "ok", or throws AnkiNotRunningError / Error with a simple message.
export async function checkConnection() {
  await askPermission();
  return "ok";
}

export const FRONT = `<div class="vc-word">{{Word}}</div>
<div class="vc-sentence">{{Sentence}}</div>`;

export const BACK = `{{FrontSide}}
<hr id="answer">
{{#Definition}}<div class="vc-def">{{Definition}}</div>{{/Definition}}
{{#Source}}<div class="vc-src">{{Source}}</div>{{/Source}}`;

export const CSS = `.card {
  font-family: -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif;
  font-size: 20px;
  line-height: 1.5;
  text-align: center;
  color: #1f2328;
  background: #ffffff;
  padding: 24px 16px;
}
.vc-word { font-size: 34px; font-weight: 700; margin-bottom: 14px; }
.vc-sentence { max-width: 640px; margin: 0 auto; }
.vc-sentence u { text-decoration-color: #2563eb; text-decoration-thickness: 2px; text-underline-offset: 3px; }
.vc-def { max-width: 640px; margin: 0 auto; }
.vc-src { margin-top: 24px; font-size: 13px; }
.vc-src a { color: #8b949e; text-decoration: none; }
.card.nightMode, .night_mode .card { color: #e6edf3; background: #1e1e1e; }
.nightMode .vc-sentence u, .night_mode .vc-sentence u { text-decoration-color: #60a5fa; }`;

let readyDeck = null;

// Makes sure the note type and deck exist. Only runs once per deck while the extension is awake.
export async function ensureReady(deckName) {
  if (readyDeck === deckName) return;
  await askPermission();
  const models = await invoke("modelNames");
  if (!models.includes(MODEL_NAME)) {
    await invoke("createModel", {
      modelName: MODEL_NAME,
      inOrderFields: ["Word", "Sentence", "Definition", "Source"],
      css: CSS,
      isCloze: false,
      cardTemplates: [{ Name: "Word card", Front: FRONT, Back: BACK }],
    });
  }
  await invoke("createDeck", { deck: deckName });
  readyDeck = deckName;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

// The sentence with the word underlined.
function sentenceHtml(card) {
  const { sentence, wordStart: a, wordEnd: b } = card;
  if (!(a >= 0 && b > a && b <= sentence.length)) return escapeHtml(sentence);
  return escapeHtml(sentence.slice(0, a)) + "<u>" + escapeHtml(sentence.slice(a, b)) + "</u>" + escapeHtml(sentence.slice(b));
}

function sourceHtml(card) {
  if (!/^https?:/i.test(card.sourceUrl)) return "";
  let label = card.sourceTitle;
  if (!label) {
    try { label = new URL(card.sourceUrl).hostname; } catch { label = card.sourceUrl; }
  }
  return `<a href="${escapeHtml(card.sourceUrl)}">${escapeHtml(label)}</a>`;
}

// Adds one card to Anki and returns the new note id.
export async function addNote(card, deckName) {
  return invoke("addNote", {
    note: {
      deckName,
      modelName: MODEL_NAME,
      fields: {
        Word: escapeHtml(card.word),
        Sentence: sentenceHtml(card),
        Definition: escapeHtml(card.definition || ""),
        Source: sourceHtml(card),
      },
      // The same word with a different sentence is a new card; the extension already asked the user.
      options: { allowDuplicate: true },
      tags: ["vocab-collector"],
    },
  });
}
