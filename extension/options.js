// The "My words and settings" page.
import { getSettings, saveSettings, getCards, DEFAULT_SETTINGS } from "./lib/store.js";
import { PROVIDERS, resolveProvider, testAi } from "./lib/ai.js";

const $ = (id) => document.getElementById(id);
const PAGE_SIZE = 100;
let shown = PAGE_SIZE;

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((r) => r || { ok: false, error: "No answer." });
}

function flash(el, text, ms = 4000) {
  el.textContent = text;
  clearTimeout(el._timer);
  if (ms) el._timer = setTimeout(() => { el.textContent = ""; }, ms);
}

// ---------- Anki ----------

async function refreshAnki() {
  const line = $("anki-status");
  line.className = "status-line";
  line.querySelector(".text").textContent = "Checking…";
  const r = await send({ type: "checkAnki" });
  if (r.connected) {
    line.classList.add("ok");
    line.querySelector(".text").textContent = "Connected to Anki";
  } else {
    line.classList.add("bad");
    line.querySelector(".text").textContent = r.notRunning
      ? "Anki is not open (or AnkiConnect is not installed). Cards wait here until Anki is open."
      : r.error;
  }
}

$("anki-check").addEventListener("click", refreshAnki);
$("anki-sync").addEventListener("click", async () => {
  const btn = $("anki-sync");
  btn.disabled = true;
  const r = await send({ type: "syncNow" });
  btn.disabled = false;
  const msg = $("anki-msg");
  if (r.ankiOpen === false) flash(msg, "Anki is not open. Open Anki and try again.", 0);
  else if (r.error) flash(msg, r.error, 0);
  else if (r.sent) flash(msg, `Sent ${r.sent} card${r.sent > 1 ? "s" : ""} to Anki.`);
  await refreshAnki();
  await renderList();
});

// ---------- Word list ----------

function sentenceNode(card) {
  const span = document.createElement("div");
  span.className = "sentence";
  const { sentence, wordStart: a, wordEnd: b } = card;
  if (a >= 0 && b > a && b <= sentence.length) {
    const u = document.createElement("u");
    u.textContent = sentence.slice(a, b);
    span.append(sentence.slice(0, a), u, sentence.slice(b));
  } else {
    span.textContent = sentence;
  }
  return span;
}

const STATUS_TEXT = { synced: "In Anki", pending: "Waiting for Anki", error: "Problem" };

function itemNode(card) {
  const item = document.createElement("div");
  item.className = "item";

  const main = document.createElement("div");
  const word = document.createElement("div");
  word.className = "word";
  word.textContent = card.word;
  const def = document.createElement("div");
  def.className = "def" + (card.definition ? "" : " none");
  def.textContent = card.definition || "No meaning";
  const meta = document.createElement("div");
  meta.className = "meta";
  meta.append(new Date(card.createdAt).toLocaleDateString());
  if (/^https?:/i.test(card.sourceUrl)) {
    const a = document.createElement("a");
    a.href = card.sourceUrl;
    a.target = "_blank";
    a.rel = "noopener";
    a.textContent = card.sourceTitle || new URL(card.sourceUrl).hostname;
    meta.append(a);
  }
  main.append(word, sentenceNode(card), def, meta);

  const side = document.createElement("div");
  side.className = "side";
  const tag = document.createElement("span");
  tag.className = `tag ${card.syncStatus}`;
  tag.textContent = STATUS_TEXT[card.syncStatus] || card.syncStatus;
  if (card.syncError) tag.title = card.syncError;
  const del = document.createElement("button");
  del.className = "btn small danger";
  del.textContent = "Delete";
  del.addEventListener("click", async () => {
    const note = card.syncStatus === "synced" ? "\n(The card in Anki stays. Delete it in Anki if you want.)" : "";
    if (!confirm(`Delete “${card.word}” from this list?${note}`)) return;
    await send({ type: "deleteCard", id: card.id });
  });
  side.append(tag, del);

  item.append(main, side);
  return item;
}

async function renderList() {
  const all = await getCards();
  const q = $("search").value.trim().toLowerCase();
  const cards = q
    ? all.filter((c) => c.word.toLowerCase().includes(q) || c.sentence.toLowerCase().includes(q))
    : all;

  $("count").textContent = all.length ? `(${all.length})` : "";
  $("empty").hidden = all.length > 0;

  const list = $("list");
  list.textContent = "";
  for (const card of cards.slice(0, shown)) list.append(itemNode(card));
  if (cards.length > shown) {
    const more = document.createElement("button");
    more.className = "btn more";
    more.textContent = `Show more (${cards.length - shown})`;
    more.addEventListener("click", () => { shown += PAGE_SIZE; renderList(); });
    list.append(more);
  }

  const waiting = all.filter((c) => c.syncStatus !== "synced").length;
  const problems = all.filter((c) => c.syncStatus === "error").length;
  $("anki-pending").textContent = waiting
    ? `${waiting} card${waiting > 1 ? "s" : ""} waiting to go to Anki.` + (problems ? ` ${problems} had a problem (point at the red tag to see why).` : "")
    : all.length ? "All cards are in Anki." : "";
}

$("search").addEventListener("input", () => { shown = PAGE_SIZE; renderList(); });

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.cards) renderList();
});

// ---------- Copy for my AI ----------

function aiRequestText(cards) {
  const lines = cards.map((c, i) => `${i + 1}. ${c.word} — "${c.sentence}"`);
  return `I am learning English. Here are new words I met, each with the sentence where I saw it.

${lines.join("\n")}

Please help me study them:
1. For each word, explain its meaning in that sentence in very simple English.
2. Write a short, interesting story (about 200 words) that uses all of these words.
3. Make 5 fill-in-the-blank questions with these words. Put the answers at the end.`;
}

$("copy-ai").addEventListener("click", async () => {
  const range = $("copy-range").value;
  let since = 0;
  if (range === "1") since = new Date().setHours(0, 0, 0, 0);
  else if (range !== "all") since = Date.now() - Number(range) * 24 * 60 * 60 * 1000;
  const cards = (await getCards()).filter((c) => c.createdAt >= since).reverse();
  const msg = $("copy-msg");
  if (!cards.length) { flash(msg, "No words in this time range."); return; }
  try {
    await navigator.clipboard.writeText(aiRequestText(cards));
    flash(msg, `Copied ${cards.length} word${cards.length > 1 ? "s" : ""}. Now paste it into your AI chat.`, 6000);
  } catch {
    flash(msg, "Could not copy. Try again.");
  }
});

// ---------- Settings ----------

function fillProviders() {
  const select = $("provider");
  for (const [id, p] of Object.entries(PROVIDERS)) {
    const opt = document.createElement("option");
    opt.value = id;
    opt.textContent = p.label;
    select.append(opt);
  }
}

// Empty "Model" and "Address" boxes mean "use the default for this AI"; the default shows as a hint.
function showProviderHints() {
  const p = PROVIDERS[$("provider").value] || PROVIDERS.custom;
  $("model").placeholder = p.model || "model name";
  $("base-url").placeholder = p.baseUrl || "https://…/v1";
}

function formSettings() {
  return {
    provider: $("provider").value,
    apiKey: $("api-key").value.trim(),
    model: $("model").value.trim(),
    baseUrl: $("base-url").value.trim(),
    deckName: $("deck").value.trim() || DEFAULT_SETTINGS.deckName,
  };
}

async function loadSettings() {
  const s = await getSettings();
  $("provider").value = s.provider in PROVIDERS ? s.provider : "custom";
  $("api-key").value = s.apiKey;
  $("model").value = s.model;
  $("base-url").value = s.baseUrl;
  $("deck").value = s.deckName;
  showProviderHints();
}

// Only DeepSeek is allowed by default. Other AI addresses need the user's OK once.
function requestAiPermission(settings) {
  const { baseUrl } = resolveProvider(settings);
  if (!settings.apiKey || !baseUrl) return Promise.resolve(true);
  let origin;
  try { origin = new URL(baseUrl).origin; } catch { return Promise.resolve(false); }
  if (origin === "https://api.deepseek.com") return Promise.resolve(true);
  return chrome.permissions.request({ origins: [`${origin}/*`] });
}

$("provider").addEventListener("change", showProviderHints);

$("show-key").addEventListener("click", () => {
  const input = $("api-key");
  const hidden = input.type === "password";
  input.type = hidden ? "text" : "password";
  $("show-key").textContent = hidden ? "Hide" : "Show";
});

$("save").addEventListener("click", async () => {
  const settings = formSettings();
  const msg = $("settings-msg");
  // Ask for permission first: Chrome only allows it right after a click.
  const allowed = await requestAiPermission(settings);
  if (!allowed) { flash(msg, "Chrome did not allow this AI address, or the address is wrong.", 6000); return; }
  if (settings.apiKey && !resolveProvider(settings).baseUrl) { flash(msg, "Please fill in the Address.", 6000); return; }
  await saveSettings(settings);
  flash(msg, "Saved ✓");
});

$("test-ai").addEventListener("click", async () => {
  const settings = formSettings();
  const msg = $("settings-msg");
  if (!settings.apiKey) { flash(msg, "Add an API key first."); return; }
  const allowed = await requestAiPermission(settings);
  if (!allowed) { flash(msg, "Chrome did not allow this AI address.", 6000); return; }
  flash(msg, "Testing…", 0);
  try {
    const text = await testAi(settings);
    flash(msg, `Works ✓ “bright” = ${text}`, 10000);
  } catch (err) {
    flash(msg, err.message, 10000);
  }
});

async function showShortcut() {
  const commands = await chrome.commands.getAll();
  const cmd = commands.find((c) => c.name === "add-word");
  $("shortcut").textContent = cmd?.shortcut || "not set";
}

$("change-shortcut").addEventListener("click", () => {
  chrome.tabs.create({ url: "chrome://extensions/shortcuts" });
});

// ---------- Backup ----------

$("export").addEventListener("click", async () => {
  const cards = await getCards();
  const data = { app: "vocab-collector", version: 1, exportedAt: new Date().toISOString(), cards };
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `vocab-collector-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  flash($("backup-msg"), `Saved ${cards.length} words.`);
});

$("import").addEventListener("click", () => $("import-file").click());
$("import-file").addEventListener("change", async (e) => {
  const file = e.target.files[0];
  e.target.value = "";
  if (!file) return;
  const msg = $("backup-msg");
  try {
    const data = JSON.parse(await file.text());
    const cards = Array.isArray(data) ? data : data.cards;
    if (!Array.isArray(cards)) throw new Error("bad file");
    const r = await send({ type: "importCards", cards });
    if (!r.ok) throw new Error(r.error);
    flash(msg, `Added ${r.added} new word${r.added === 1 ? "" : "s"}.`, 6000);
  } catch {
    flash(msg, "This is not a Vocab Collector backup file.", 6000);
  }
});

// ---------- Start ----------

fillProviders();
loadSettings();
showShortcut();
renderList();
refreshAnki();
