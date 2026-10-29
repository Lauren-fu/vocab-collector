// A fake "chrome" object so the extension code can run in a normal web page for testing.
// Also fakes the AI server and AnkiConnect. Set window.__ankiOn = false to act as if Anki is closed.
(function () {
  const store = {};
  const messageListeners = [];
  const event = () => {
    const list = [];
    return { addListener: (f) => list.push(f), _fire: (...a) => list.forEach((f) => f(...a)) };
  };
  const storageChanged = event();

  globalThis.chrome = {
    storage: {
      local: {
        async get(key) {
          if (typeof key === "string") return key in store ? { [key]: structuredClone(store[key]) } : {};
          return structuredClone(store);
        },
        async set(obj) {
          const changes = {};
          for (const k in obj) { store[k] = structuredClone(obj[k]); changes[k] = { newValue: obj[k] }; }
          storageChanged._fire(changes, "local");
        },
      },
      onChanged: storageChanged,
    },
    runtime: {
      onMessage: { addListener: (f) => messageListeners.push(f) },
      sendMessage(msg) {
        return new Promise((resolve) => {
          let waiting = false;
          for (const f of messageListeners) if (f(msg, {}, resolve) === true) waiting = true;
          if (!waiting) resolve(undefined);
        });
      },
      onInstalled: event(),
      onStartup: event(),
      openOptionsPage: async () => { window.__log.push("openOptionsPage"); },
    },
    action: {
      setBadgeText: async ({ text }) => { window.__badge = text; },
      setBadgeBackgroundColor: async () => {},
      onClicked: event(),
    },
    alarms: { create() {}, onAlarm: event() },
    contextMenus: { removeAll(cb) { cb && cb(); }, create() {}, onClicked: event() },
    commands: { onCommand: event(), getAll: async () => [{ name: "add-word", shortcut: "⌥⇧S" }] },
    tabs: { sendMessage: async () => {}, create: async () => {} },
    scripting: { executeScript: async () => {} },
    permissions: { request: async () => true },
  };

  window.__log = [];
  window.__ankiOn = true;
  window.__ankiNotes = [];
  window.__ankiModels = [];

  const realFetch = window.fetch.bind(window);
  const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json" } });

  window.fetch = async (url, opts = {}) => {
    url = String(url);
    if (url.startsWith("https://api.deepseek.com")) {
      const body = JSON.parse(opts.body);
      window.__log.push({ ai: body.messages[1].content, auth: opts.headers.Authorization });
      if (opts.headers.Authorization === "Bearer bad") return json({ error: { message: "bad key" } }, 401);
      await new Promise((r) => setTimeout(r, 300));
      return json({ choices: [{ message: { content: "Found everywhere; you see it in many places." } }] });
    }
    if (url.startsWith("http://127.0.0.1:8765")) {
      if (!window.__ankiOn) throw new TypeError("Failed to fetch");
      const { action, params } = JSON.parse(opts.body);
      window.__log.push({ anki: action });
      switch (action) {
        case "requestPermission": return json({ result: { permission: "granted" }, error: null });
        case "modelNames": return json({ result: window.__ankiModels.map((m) => m.modelName), error: null });
        case "createModel": window.__ankiModels.push(params); return json({ result: {}, error: null });
        case "createDeck": return json({ result: 1, error: null });
        case "addNote": window.__ankiNotes.push(params.note); return json({ result: 1000 + window.__ankiNotes.length, error: null });
        default: return json({ result: null, error: "unsupported action" });
      }
    }
    return realFetch(url, opts);
  };
})();
