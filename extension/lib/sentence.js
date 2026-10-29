// Finds the word a user selected and the sentence around it.
// Plain script with no imports or DOM use, so the same file works in the content script,
// in tests, and later in the desktop app.
(function (root) {
  "use strict";

  const ABBREVIATIONS = new Set([
    "mr", "mrs", "ms", "dr", "prof", "sr", "jr", "st", "vs", "etc", "e.g", "i.e",
    "u.s", "u.k", "inc", "ltd", "co", "no", "fig", "vol", "approx", "dept", "est",
    "jan", "feb", "mar", "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
  ]);
  const ENDERS = ".!?";
  const CJK_ENDERS = "。！？";
  const CLOSERS = "\"'”’)]»";
  const MAX_SENTENCE = 400;
  const CONTEXT = 180;

  const WORD_RE = /[\p{L}\p{N}][\p{L}\p{N}'’\-]*/gu;
  const EDGE_JUNK_START = /^[^\p{L}\p{N}]+/u;
  const EDGE_JUNK_END = /[^\p{L}\p{N}]+$/u;

  // True when the character at index i ends a sentence.
  function isBoundary(text, i) {
    const ch = text[i];
    if (CJK_ENDERS.includes(ch)) return true;
    if (!ENDERS.includes(ch)) return false;
    let j = i + 1;
    while (j < text.length && CLOSERS.includes(text[j])) j++;
    // "3.14", "U.S.A", "..." in the middle: no space after, so not an end.
    if (j < text.length && !/\s/.test(text[j])) return false;
    if (ch === ".") {
      const m = /([A-Za-z.]+)$/.exec(text.slice(Math.max(0, i - 12), i));
      if (m) {
        const prev = m[1].toLowerCase();
        // Abbreviations ("Dr.") and initials ("J.") do not end a sentence.
        if (ABBREVIATIONS.has(prev) || /^[a-z]$/.test(prev)) return false;
      }
    }
    return true;
  }

  // Given full text and the [start, end) range of the word, returns the sentence that holds it.
  // Whitespace is collapsed. Very long sentences are cut around the word with "…".
  function findSentence(text, start, end) {
    let s = 0;
    for (let i = start - 1; i >= 0; i--) {
      if (isBoundary(text, i)) { s = i + 1; break; }
    }
    let e = text.length;
    for (let i = end; i < text.length; i++) {
      if (isBoundary(text, i)) {
        e = i + 1;
        while (e < text.length && CLOSERS.includes(text[e])) e++;
        break;
      }
    }

    let before = text.slice(s, start).replace(/\s+/g, " ").replace(/^\s+/, "");
    const word = text.slice(start, end).replace(/\s+/g, " ");
    let after = text.slice(end, e).replace(/\s+/g, " ").replace(/\s+$/, "");

    if (before.length + word.length + after.length > MAX_SENTENCE) {
      if (before.length > CONTEXT) {
        before = "…" + before.slice(before.length - CONTEXT).replace(/^\S*\s/, "");
      }
      if (after.length > CONTEXT) {
        after = after.slice(0, CONTEXT).replace(/\s\S*$/, "") + "…";
      }
    }
    return {
      sentence: before + word + after,
      wordStart: before.length,
      wordEnd: before.length + word.length,
    };
  }

  // Strips quotes and punctuation around a selection: "“Ubiquitous,”" -> "Ubiquitous".
  // Returns the clean text and how many characters were cut from each side.
  function cleanWord(raw) {
    const lead = (EDGE_JUNK_START.exec(raw) || [""])[0].length;
    const rest = raw.slice(lead);
    const trail = (EDGE_JUNK_END.exec(rest) || [""])[0].length;
    return { word: rest.slice(0, rest.length - trail), lead, trail };
  }

  // A word or a short phrase (up to 4 words), like "ubiquitous" or "give up".
  function isWordLike(text) {
    const t = text.trim();
    if (!t || t.length > 40) return false;
    return /^[\p{L}][\p{L}'’\-]*(\s+[\p{L}][\p{L}'’\-]*){0,3}$/u.test(t);
  }

  // All words in a sentence with their positions, for "click the new word" mode.
  function splitWords(sentence) {
    const out = [];
    for (const m of sentence.matchAll(WORD_RE)) {
      out.push({ word: m[0], start: m.index, end: m.index + m[0].length });
    }
    return out;
  }

  // Finds `word` in `sentence` as a whole word, ignoring case.
  // When it appears more than once, picks the one closest to `hint`.
  // Returns { start, end } or null if not found.
  function locateWord(sentence, word, hint) {
    const w = word.trim();
    if (!w) return null;
    const escaped = w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
    const re = new RegExp("(?<![\\p{L}\\p{N}])" + escaped + "(?![\\p{L}\\p{N}])", "giu");
    const h = hint > 0 ? hint : 0;
    let best = null;
    for (const m of sentence.matchAll(re)) {
      if (!best || Math.abs(m.index - h) < Math.abs(best.start - h)) {
        best = { start: m.index, end: m.index + m[0].length };
      }
    }
    return best;
  }

  // Collapses whitespace. Used for a selection that is a whole sentence.
  function normalize(text) {
    return text.replace(/\s+/g, " ").trim();
  }

  root.VCSentence = { findSentence, cleanWord, isWordLike, splitWords, locateWord, normalize };
})(globalThis);
