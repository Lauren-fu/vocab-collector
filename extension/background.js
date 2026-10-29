// Background service worker: the only place that changes cards, calls the AI, and talks to Anki.
import { getSettings, getCards, findCardsByWord, newCard, putCard, updateCard, removeCard, importCards } from "./lib/store.js";
import { explainWord, hasAi } from "./lib/ai.js";
import { ensureReady, addNote, checkConnection, AnkiNotRunningError } from "./lib/anki.js";

const SYNC_ALARM = "sync-to-anki";

// ---------- Sending cards to Anki ----------

let syncing = null;

// Sends every card that is not in Anki yet. If Anki is closed, cards stay "pending" and we try again later.
function syncPending() {
  if (!syncing) syncing = doSync().finally(() => { syncing = null; });
  return syncing;
}

async function doSync() {
  const pending = (await getCards()).filter((c) => c.syncStatus !== "synced").reverse(); // oldest first
  if (pending.length === 0) {
    await updateBadge();
    return { sent: 0, left: 0, ankiOpen: null };
  }
  const { deckName } = await getSettings();
  let sent = 0;
  try {
    await ensureReady(deckName);
    for (const card of pending) {
      try {
        const noteId = await addNote(card, deckName);
        await updateCard(card.id, { syncStatus: "synced", syncError: "", ankiNoteId: noteId });
        sent++;
      } catch (err) {
        if (err instanceof AnkiNotRunningError) throw err;
        await updateCard(card.id, { syncStatus: "error", syncError: err.message });
      }
    }
  } catch (err) {
    await updateBadge();
    if (err instanceof AnkiNotRunningError) return { sent, left: pending.length - sent, ankiOpen: false };
    return { sent, left: pending.length - sent, ankiOpen: true, error: err.message };
  }
  await updateBadge();
  return { sent, left: pending.length - sent, ankiOpen: true };
}

// The number on the toolbar icon = cards waiting for Anki.
async function updateBadge() {
  const waiting = (await getCards()).filter((c) => c.syncStatus !== "synced").length;
  await chrome.action.setBadgeBackgroundColor({ color: "#d97706" });
  await chrome.action.setBadgeText({ text: waiting ? String(waiting) : "" });
}

// ---------- Messages from the page and the Settings page ----------

const handlers = {
  async getStatus() {
    return { hasAi: hasAi(await getSettings()) };
  },

  async checkDuplicate({ word }) {
    const matches = await findCardsByWord(word);
    return { count: matches.length, sentences: matches.slice(0, 3).map((c) => c.sentence) };
  },

  async explain({ word, sentence }) {
    return { definition: await explainWord({ word, sentence }, await getSettings()) };
  },

  async addCard({ card }) {
    const saved = await putCard(newCard(card));
    const result = await syncPending();
    const fresh = (await getCards()).find((c) => c.id === saved.id);
    return {
      syncStatus: fresh?.syncStatus || "pending",
      syncError: fresh?.syncError || "",
      ankiOpen: result.ankiOpen,
    };
  },

  async syncNow() {
    return syncPending();
  },

  async checkAnki() {
    try {
      await checkConnection();
      return { connected: true };
    } catch (err) {
      return { connected: false, notRunning: err instanceof AnkiNotRunningError, error: err.message };
    }
  },

  async deleteCard({ id }) {
    await removeCard(id);
    await updateBadge();
    return {};
  },

  async importCards({ cards }) {
    const added = await importCards(cards);
    await updateBadge();
    syncPending();
    return { added };
  },

  async openOptions() {
    await chrome.runtime.openOptionsPage();
    return {};
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  handler(msg, sender).then(
    (result) => sendResponse({ ok: true, ...result }),
    (err) => sendResponse({ ok: false, error: err.message || String(err) }),
  );
  return true; // keep the channel open for the async answer
});

// ---------- Opening the Add dialog from the shortcut or the right-click menu ----------

async function openAddDialog(tab) {
  if (!tab?.id) return;
  const msg = { type: "openAddDialog" };
  try {
    await chrome.tabs.sendMessage(tab.id, msg);
  } catch {
    // The page was open before the extension was installed: add the script now, then try again.
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ["lib/sentence.js", "content.js"] });
      await chrome.tabs.sendMessage(tab.id, msg);
    } catch {
      // Pages like chrome:// or the Chrome Web Store do not allow extensions. Nothing to do.
    }
  }
}

chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "add-word") openAddDialog(tab);
});

chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "add-word") openAddDialog(tab);
});

chrome.action.onClicked.addListener(() => chrome.runtime.openOptionsPage());

// ---------- Startup ----------

function setup() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({ id: "add-word", title: "Add “%s” to Vocab Collector", contexts: ["selection"] });
  });
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: 1 });
  syncPending();
}

chrome.runtime.onInstalled.addListener(setup);
chrome.runtime.onStartup.addListener(setup);

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== SYNC_ALARM) return;
  const waiting = (await getCards()).some((c) => c.syncStatus !== "synced");
  if (waiting) syncPending();
});
