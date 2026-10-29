// Content script: shows a "+" button next to a selected word, and the "Add a word" dialog.
// Everything we draw lives in a shadow root, so the page's styles cannot break it.
(() => {
  if (window.__vocabCollectorLoaded) return;
  window.__vocabCollectorLoaded = true;

  const S = globalThis.VCSentence;

  let host = null;
  let shadow = null;
  let plusBtn = null;
  let plusCapture = null;
  let panel = null;
  let toastTimer = null;

  // ---------- Talking to the background ----------

  async function send(msg) {
    try {
      return (await chrome.runtime.sendMessage(msg)) || { ok: false, error: "No answer from Vocab Collector." };
    } catch {
      return { ok: false, error: "Vocab Collector was updated. Reload this page and try again." };
    }
  }

  // ---------- Reading the selection ----------

  // The nearest parent that is a block (paragraph, list item, cell…), where the sentence lives.
  function blockOf(node) {
    let el = node.nodeType === Node.ELEMENT_NODE ? node : node.parentElement;
    while (el && el !== document.body && el !== document.documentElement) {
      const display = getComputedStyle(el).display;
      if (display && !display.startsWith("inline") && display !== "contents") return el;
      el = el.parentElement;
    }
    return el || document.body;
  }

  function isTextField(el) {
    if (!el) return false;
    if (el.tagName === "TEXTAREA") return true;
    return el.tagName === "INPUT" && /^(text|search|url|)$/i.test(el.getAttribute("type") || "");
  }

  // Returns what the user selected:
  //   { mode: "word", word, sentence, wordStart, wordEnd, rect }  for a word or short phrase
  //   { mode: "pick", word: "", sentence, ... }                   for a longer piece of text
  // or null when nothing useful is selected.
  function capture() {
    const active = document.activeElement;
    if (isTextField(active)) {
      const a = active.selectionStart, b = active.selectionEnd;
      if (a != null && b > a) return build(active.value, a, b, null, active.getBoundingClientRect());
    }

    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return null;
    const range = sel.getRangeAt(0);
    if (host && host.contains(range.commonAncestorContainer)) return null;

    const block = blockOf(range.startContainer);
    const before = document.createRange();
    before.selectNodeContents(block);
    try {
      before.setEnd(range.startContainer, range.startOffset);
    } catch {
      return null;
    }
    const text = block.textContent || "";
    const start = before.toString().length;
    const selected = range.toString();
    return build(text, start, start + selected.length, selected, range.getBoundingClientRect());
  }

  function build(text, start, end, selected, rect) {
    const raw = selected ?? text.slice(start, end);
    const { word, lead, trail } = S.cleanWord(raw);

    if (S.isWordLike(word)) {
      const s = start + lead;
      const e = end - trail;
      const found = text.slice(s, e) === word
        ? S.findSentence(text, s, e)
        : { sentence: word, wordStart: 0, wordEnd: word.length };
      return { mode: "word", word, ...found, rect };
    }

    const sentence = S.normalize(raw);
    if (S.splitWords(sentence).length < 2) return null;
    return { mode: "pick", word: "", sentence, wordStart: -1, wordEnd: -1, rect };
  }

  // ---------- Our layer on the page ----------

  function ensureHost() {
    if (host && host.isConnected) return;
    host = document.createElement("vocab-collector");
    host.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;z-index:2147483647;";
    shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = CSS;
    shadow.appendChild(style);
    document.documentElement.appendChild(host);
  }

  function isOurs(event) {
    return Boolean(host) && event.composedPath().includes(host);
  }

  // ---------- The "+" button ----------

  function showPlus(c) {
    ensureHost();
    if (!plusBtn) {
      plusBtn = document.createElement("button");
      plusBtn.className = "plus";
      plusBtn.textContent = "+";
      plusBtn.title = "Add this word";
      plusBtn.setAttribute("aria-label", "Add this word");
      plusBtn.addEventListener("mousedown", (e) => e.preventDefault()); // keep the page selection
      plusBtn.addEventListener("click", () => {
        const c = plusCapture;
        hidePlus();
        if (c) openDialog(c);
      });
      shadow.appendChild(plusBtn);
    }
    plusCapture = c;
    const r = c.rect;
    const size = 28;
    let x = Math.min(r.right + 6, window.innerWidth - size - 8);
    let y = r.top - size - 6;
    if (y < 8) y = r.bottom + 6;
    plusBtn.style.left = `${Math.max(8, x)}px`;
    plusBtn.style.top = `${y}px`;
    plusBtn.hidden = false;
  }

  function hidePlus() {
    if (plusBtn) plusBtn.hidden = true;
    plusCapture = null;
  }

  document.addEventListener("mouseup", (e) => {
    if (isOurs(e) || e.button !== 0) return;
    // Wait one tick: the selection is updated after mouseup.
    setTimeout(() => {
      const c = capture();
      if (c && c.mode === "word") showPlus(c);
      else hidePlus();
    }, 0);
  }, true);

  document.addEventListener("mousedown", (e) => {
    if (!isOurs(e)) hidePlus();
  }, true);

  window.addEventListener("scroll", hidePlus, true);
  window.addEventListener("resize", hidePlus);

  // ---------- The "Add a word" dialog ----------

  const PANEL_HTML = `
    <div class="head">
      <strong>Add a word</strong>
      <button class="x" title="Close (Esc)" aria-label="Close">×</button>
    </div>
    <div class="pick" hidden>
      <div class="label">Click the new word:</div>
      <div class="chips"></div>
    </div>
    <label class="label" for="vc-word">Word</label>
    <input id="vc-word" class="word" autocomplete="off" spellcheck="false">
    <label class="label" for="vc-sentence">Sentence</label>
    <textarea id="vc-sentence" class="sentence" rows="3"></textarea>
    <div class="dup" hidden></div>
    <div class="label-row">
      <label class="label" for="vc-def">Meaning <span class="muted">(simple English, optional)</span></label>
      <button class="link get" hidden>Get meaning</button>
    </div>
    <textarea id="vc-def" class="def" rows="3"></textarea>
    <div class="status"></div>
    <div class="foot">
      <button class="btn cancel">Cancel</button>
      <button class="btn primary add">Add card</button>
    </div>`;

  function closeDialog() {
    if (panel) panel.remove();
    panel = null;
  }

  async function openDialog(c) {
    hidePlus();
    closeDialog();
    ensureHost();

    panel = document.createElement("div");
    panel.className = "panel";
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Add a word");
    panel.innerHTML = PANEL_HTML;
    shadow.appendChild(panel);
    const thisPanel = panel;
    const $ = (sel) => thisPanel.querySelector(sel);

    const wordInput = $(".word");
    const sentenceInput = $(".sentence");
    const defInput = $(".def");
    const statusEl = $(".status");
    const dupEl = $(".dup");
    const getBtn = $(".get");
    const addBtn = $(".add");

    wordInput.value = c.word;
    sentenceInput.value = c.sentence;

    let hint = c.wordStart;
    let hasAi = false;
    let defTouched = false;
    let aiRequest = 0;

    function setStatus(text, kind) {
      statusEl.textContent = text || "";
      statusEl.className = "status" + (kind ? " " + kind : "");
    }

    // Keep page shortcuts from firing while typing in the dialog.
    for (const type of ["keydown", "keyup", "keypress"]) {
      thisPanel.addEventListener(type, (e) => e.stopPropagation());
    }
    thisPanel.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeDialog();
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) addCard();
    });
    $(".x").addEventListener("click", closeDialog);
    $(".cancel").addEventListener("click", closeDialog);
    addBtn.addEventListener("click", addCard);
    getBtn.addEventListener("click", () => getMeaning(true));
    defInput.addEventListener("input", () => { defTouched = true; });

    // "Pick" mode: the user selected a sentence, so show its words as buttons.
    if (c.mode === "pick") {
      $(".pick").hidden = false;
      const chips = $(".chips");
      for (const w of S.splitWords(c.sentence)) {
        const chip = document.createElement("button");
        chip.className = "chip";
        chip.textContent = w.word;
        chip.addEventListener("click", () => {
          chips.querySelectorAll(".chip.on").forEach((x) => x.classList.remove("on"));
          chip.classList.add("on");
          wordInput.value = w.word;
          // The selection may hold several sentences: keep only the one with this word.
          const found = S.findSentence(c.sentence, w.start, w.end);
          sentenceInput.value = found.sentence;
          hint = found.wordStart;
          checkDuplicate();
          if (hasAi && !defTouched) getMeaning(false);
        });
        chips.appendChild(chip);
      }
    }

    let dupTimer = null;
    wordInput.addEventListener("input", () => {
      clearTimeout(dupTimer);
      dupTimer = setTimeout(checkDuplicate, 300);
    });

    async function checkDuplicate() {
      const word = wordInput.value.trim();
      if (!word) { dupEl.hidden = true; addBtn.textContent = "Add card"; return; }
      const r = await send({ type: "checkDuplicate", word });
      if (!thisPanel.isConnected || word !== wordInput.value.trim()) return;
      if (!r.ok || r.count === 0) {
        dupEl.hidden = true;
        addBtn.textContent = "Add card";
        return;
      }
      dupEl.hidden = false;
      dupEl.textContent = "";
      const title = document.createElement("div");
      title.textContent = `You already saved “${word}” (${r.count} card${r.count > 1 ? "s" : ""}). Add it again with this sentence?`;
      dupEl.appendChild(title);
      for (const s of r.sentences) {
        const q = document.createElement("div");
        q.className = "dup-sentence";
        q.textContent = `“${s}”`;
        dupEl.appendChild(q);
      }
      addBtn.textContent = "Add again";
    }

    async function getMeaning(force) {
      const word = wordInput.value.trim();
      const sentence = S.normalize(sentenceInput.value);
      if (!word) { setStatus("Pick or type the word first."); return; }
      const id = ++aiRequest;
      getBtn.disabled = true;
      setStatus("Getting meaning…");
      const r = await send({ type: "explain", word, sentence });
      if (!thisPanel.isConnected || id !== aiRequest) return;
      getBtn.disabled = false;
      if (!r.ok) { setStatus(r.error, "error"); return; }
      if (force || !defTouched) {
        defInput.value = r.definition;
        defTouched = false;
      }
      setStatus("");
    }

    async function addCard() {
      const word = wordInput.value.trim();
      const sentence = S.normalize(sentenceInput.value);
      if (!word) { setStatus("Please pick or type the word.", "error"); wordInput.focus(); return; }
      if (!sentence) { setStatus("Please add the sentence.", "error"); sentenceInput.focus(); return; }
      const pos = S.locateWord(sentence, word, hint);
      addBtn.disabled = true;
      setStatus("Saving…");
      const r = await send({
        type: "addCard",
        card: {
          word,
          sentence,
          wordStart: pos ? pos.start : -1,
          wordEnd: pos ? pos.end : -1,
          definition: defInput.value.trim(),
          sourceUrl: location.href,
          sourceTitle: document.title,
        },
      });
      if (!thisPanel.isConnected) return;
      if (!r.ok) {
        addBtn.disabled = false;
        setStatus(r.error, "error");
        return;
      }
      closeDialog();
      if (r.syncStatus === "synced") toast(`Added “${word}” to Anki ✓`);
      else if (r.syncStatus === "error") toast(`Saved “${word}”. Anki said: ${r.syncError}`, true);
      else toast(`Saved “${word}”. It will go to Anki when Anki is open.`);
    }

    // Start: duplicate check and (if there is an AI key) the meaning.
    checkDuplicate();
    const status = await send({ type: "getStatus" });
    if (!thisPanel.isConnected) return;
    hasAi = Boolean(status.ok && status.hasAi);
    if (hasAi) {
      getBtn.hidden = false;
      defInput.placeholder = "The meaning will appear here. You can change it.";
      if (wordInput.value.trim()) getMeaning(false);
    } else {
      defInput.placeholder = "Write a simple meaning, or leave it empty.";
      statusEl.className = "status";
      statusEl.textContent = "No AI key, so there is no automatic meaning. ";
      const link = document.createElement("button");
      link.className = "link";
      link.textContent = "Add a key";
      link.addEventListener("click", () => send({ type: "openOptions" }));
      statusEl.appendChild(link);
    }

    if (c.mode === "word") addBtn.focus();
    else thisPanel.querySelector(".chip")?.focus();
  }

  // ---------- Small message at the bottom of the page ----------

  function toast(text, isError) {
    ensureHost();
    let el = shadow.querySelector(".toast");
    if (!el) {
      el = document.createElement("div");
      el.className = "toast";
      el.setAttribute("role", "status");
      shadow.appendChild(el);
    }
    el.textContent = text;
    el.classList.toggle("error", Boolean(isError));
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, isError ? 6000 : 3500);
  }

  // ---------- Shortcut and right-click menu ----------

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type !== "openAddDialog") return;
    const c = capture();
    if (c) openDialog(c);
    else toast("Select a word (or a sentence) first.");
  });

  const CSS = `
    :host {
      --bg: #ffffff; --fg: #1f2328; --muted: #656d76; --line: #d0d7de; --soft: #f6f8fa;
      --accent: #2563eb; --accent-fg: #ffffff; --warn-bg: #fff8e6; --warn-fg: #7a4d00; --err: #cf222e;
    }
    @media (prefers-color-scheme: dark) {
      :host {
        --bg: #1c2128; --fg: #e6edf3; --muted: #9198a1; --line: #3d444d; --soft: #262c36;
        --accent: #4c8dff; --accent-fg: #ffffff; --warn-bg: #3a2e12; --warn-fg: #f2cc60; --err: #ff7b72;
      }
    }
    * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif; }
    [hidden] { display: none !important; }

    .plus {
      position: fixed; width: 28px; height: 28px; padding: 0; border: none; border-radius: 8px;
      background: var(--accent); color: var(--accent-fg); font-size: 20px; line-height: 28px; font-weight: 600;
      text-align: center; cursor: pointer; box-shadow: 0 2px 8px rgba(0,0,0,.25);
    }
    .plus:hover { filter: brightness(1.1); }

    .panel {
      position: fixed; top: 16px; right: 16px; width: min(380px, calc(100vw - 32px));
      max-height: calc(100vh - 32px); overflow: auto; padding: 14px 16px 16px;
      background: var(--bg); color: var(--fg); border: 1px solid var(--line); border-radius: 12px;
      box-shadow: 0 12px 32px rgba(0,0,0,.25); font-size: 14px; line-height: 1.45; text-align: left;
    }
    .head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; font-size: 15px; }
    .x { border: none; background: none; color: var(--muted); font-size: 22px; line-height: 1; cursor: pointer; padding: 2px 6px; border-radius: 6px; }
    .x:hover { background: var(--soft); }
    .label { display: block; margin: 10px 0 4px; font-size: 12px; font-weight: 600; color: var(--muted); }
    .label-row { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
    .muted { font-weight: 400; color: var(--muted); }
    input, textarea {
      width: 100%; padding: 7px 9px; border: 1px solid var(--line); border-radius: 8px;
      background: var(--bg); color: var(--fg); font-size: 14px; line-height: 1.4; resize: vertical;
    }
    input:focus, textarea:focus { outline: 2px solid var(--accent); outline-offset: -1px; border-color: transparent; }
    .word { font-weight: 700; font-size: 16px; }
    .chips { display: flex; flex-wrap: wrap; gap: 4px; }
    .chip {
      padding: 3px 8px; border: 1px solid var(--line); border-radius: 999px; background: var(--soft);
      color: var(--fg); font-size: 13px; cursor: pointer;
    }
    .chip:hover { border-color: var(--accent); }
    .chip.on { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); }
    .dup { margin-top: 10px; padding: 8px 10px; border-radius: 8px; background: var(--warn-bg); color: var(--warn-fg); font-size: 13px; }
    .dup-sentence { margin-top: 4px; font-style: italic; opacity: .9; }
    .status { min-height: 18px; margin-top: 6px; font-size: 12px; color: var(--muted); }
    .status.error { color: var(--err); }
    .link { border: none; background: none; padding: 0; color: var(--accent); font-size: 12px; cursor: pointer; }
    .link:hover { text-decoration: underline; }
    .link:disabled { opacity: .5; cursor: default; }
    .foot { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .btn {
      padding: 7px 14px; border-radius: 8px; border: 1px solid var(--line); background: var(--soft);
      color: var(--fg); font-size: 14px; cursor: pointer;
    }
    .btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-fg); font-weight: 600; }
    .btn:disabled { opacity: .6; cursor: default; }
    .btn:focus-visible, .chip:focus-visible, .x:focus-visible, .link:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }

    .toast {
      position: fixed; right: 16px; bottom: 16px; max-width: min(360px, calc(100vw - 32px));
      padding: 10px 14px; border-radius: 10px; background: #1f2328; color: #ffffff; font-size: 14px;
      box-shadow: 0 6px 20px rgba(0,0,0,.25);
    }
    .toast.error { background: #8a1c1c; }
  `;
})();
