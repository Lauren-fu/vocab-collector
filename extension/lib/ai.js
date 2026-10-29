// Asks an AI to explain a word in simple English, using the meaning it has in one sentence.
// All providers here speak the same "chat completions" format, so switching is just a different URL and model.

export const PROVIDERS = {
  deepseek: { label: "DeepSeek", baseUrl: "https://api.deepseek.com", model: "deepseek-chat" },
  kimi: { label: "Kimi (Moonshot)", baseUrl: "https://api.moonshot.cn/v1", model: "moonshot-v1-8k" },
  qwen: { label: "Qwen (Alibaba)", baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus" },
  custom: { label: "Other (OpenAI-compatible)", baseUrl: "", model: "" },
};

const SYSTEM_PROMPT = `You help people who are learning English.
Explain what an English word means in ONE given sentence.
Rules:
- Use very simple English. Use only common, easy words.
- Explain only the meaning the word has in THIS sentence.
- One or two short sentences. At most 25 words.
- Do not use the word itself (or its other forms) in the explanation.
- If it is a phrase or idiom, explain the whole phrase.
- Reply with the explanation only. No quotes, no labels, no other language.`;

const TIMEOUT_MS = 20000;

// The base URL and model actually used, after filling in provider defaults.
export function resolveProvider(settings) {
  const preset = PROVIDERS[settings.provider] || PROVIDERS.custom;
  return {
    baseUrl: (settings.baseUrl || preset.baseUrl).replace(/\/+$/, ""),
    model: settings.model || preset.model,
  };
}

export function hasAi(settings) {
  const { baseUrl, model } = resolveProvider(settings);
  return Boolean(settings.apiKey && baseUrl && model);
}

export async function explainWord({ word, sentence }, settings) {
  const { baseUrl, model } = resolveProvider(settings);
  if (!settings.apiKey) throw new Error("No API key. Add one in Settings.");
  if (!baseUrl || !model) throw new Error("Set the AI address and model in Settings.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res;
  try {
    res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${settings.apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        max_tokens: 150,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: `Word: ${word}\nSentence: ${sentence}` },
        ],
      }),
    });
  } catch (err) {
    if (err.name === "AbortError") throw new Error("The AI took too long. Try again.");
    throw new Error("Could not reach the AI. Check your internet.");
  } finally {
    clearTimeout(timer);
  }

  let data = null;
  try { data = await res.json(); } catch { /* error body may not be JSON */ }

  if (!res.ok) {
    if (res.status === 401) throw new Error("The API key is wrong.");
    if (res.status === 402) throw new Error("Your AI account has no money left.");
    if (res.status === 429) throw new Error("Too many requests. Wait a little and try again.");
    const detail = data?.error?.message || res.statusText;
    throw new Error(`AI error ${res.status}: ${detail}`);
  }

  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new Error("The AI gave an empty answer. Try again.");
  return text.replace(/^["“']|["”']$/g, "").trim();
}

// Used by the Settings page "Test" button.
export function testAi(settings) {
  return explainWord({ word: "bright", sentence: "She is a bright student and learns fast." }, settings);
}
