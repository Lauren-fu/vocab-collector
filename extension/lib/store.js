// Local storage for cards and settings (chrome.storage.local).
// Cards are saved here first, then sent to Anki, so nothing is lost when Anki is closed.
//
// Card shape:
// { id, word, sentence, wordStart, wordEnd, definition, sourceUrl, sourceTitle,
//   createdAt, syncStatus: "pending" | "synced" | "error", syncError, ankiNoteId }

export const DEFAULT_SETTINGS = {
  provider: "deepseek",
  apiKey: "",
  model: "",
  baseUrl: "",
  deckName: "Vocab Collector",
};

export async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return { ...DEFAULT_SETTINGS, ...settings };
}

export async function saveSettings(patch) {
  const next = { ...(await getSettings()), ...patch };
  await chrome.storage.local.set({ settings: next });
  return next;
}

async function readCards() {
  const { cards } = await chrome.storage.local.get("cards");
  return cards || {};
}

// Newest first.
export async function getCards() {
  return Object.values(await readCards()).sort((a, b) => b.createdAt - a.createdAt);
}

export function sameWord(a, b) {
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

export async function findCardsByWord(word) {
  return (await getCards()).filter((c) => sameWord(c.word, word));
}

// All writes go through this queue so two changes at the same time do not overwrite each other.
let queue = Promise.resolve();
function mutate(fn) {
  const run = queue.then(async () => {
    const cards = await readCards();
    const result = await fn(cards);
    await chrome.storage.local.set({ cards });
    return result;
  });
  queue = run.catch(() => {});
  return run;
}

export function newCard(fields) {
  return {
    id: crypto.randomUUID(),
    word: fields.word.trim(),
    sentence: fields.sentence.trim(),
    wordStart: fields.wordStart ?? -1,
    wordEnd: fields.wordEnd ?? -1,
    definition: (fields.definition || "").trim(),
    sourceUrl: fields.sourceUrl || "",
    sourceTitle: fields.sourceTitle || "",
    createdAt: Date.now(),
    syncStatus: "pending",
    syncError: "",
    ankiNoteId: null,
  };
}

export function putCard(card) {
  return mutate((cards) => {
    cards[card.id] = card;
    return card;
  });
}

export function updateCard(id, patch) {
  return mutate((cards) => {
    if (!cards[id]) return null;
    cards[id] = { ...cards[id], ...patch };
    return cards[id];
  });
}

export function removeCard(id) {
  return mutate((cards) => {
    delete cards[id];
  });
}

// Adds cards from a backup file. Cards that already exist (same id) are skipped.
export function importCards(list) {
  return mutate((cards) => {
    let added = 0;
    for (const c of list) {
      if (!c || !c.id || !c.word || cards[c.id]) continue;
      cards[c.id] = { ...newCard(c), ...c };
      added++;
    }
    return added;
  });
}
