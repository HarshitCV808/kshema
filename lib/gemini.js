// Google Gemini, used when GEMINI_API_KEY is set (the online demo on Render).
// Free-tier requests may be used by Google to improve its products, so the page tells
// demo users to enter made-up details only.
import { HttpError } from "./local-ai.js";

export const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const BASE = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}`;
// Low thinking keeps replies quick; the fixed safety rules run outside the model anyway.
const THINKING = { thinkingConfig: { thinkingLevel: "LOW" } };

async function call(method, body, signal) {
  let res;
  try {
    res = await fetch(`${BASE}:${method}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": process.env.GEMINI_API_KEY },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new HttpError(502, "offline");
  }
  if (res.ok) return res;
  const detail = await res.text();
  console.error("gemini:", res.status, detail.slice(0, 300));
  if (res.status === 429) throw new HttpError(429, "busy"); // free-tier limit reached
  if ([401, 403].includes(res.status) || /API key/i.test(detail)) throw new HttpError(503, "missing_key");
  throw new HttpError(502, "failed");
}

// Reply text from one response chunk, skipping the model's internal thought parts.
const textOf = (r) =>
  (r.candidates?.[0]?.content?.parts ?? []).filter((p) => p.text && !p.thought).map((p) => p.text).join("");

export async function* geminiStream(system, messages, signal) {
  const res = await call("streamGenerateContent?alt=sse", {
    systemInstruction: { parts: [{ text: system }] },
    contents: messages.map((m) => ({ role: m.role === "assistant" ? "model" : "user", parts: [{ text: m.content }] })),
    generationConfig: THINKING,
  }, signal);
  let buf = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const ev = JSON.parse(line.slice(5));
      if (ev.promptFeedback?.blockReason) throw new HttpError(422, "refused");
      const text = textOf(ev);
      if (text) yield text;
    }
  }
}

// One answer constrained to a JSON schema. Gemini reads PDFs and images directly.
export async function geminiJson(prompt, { schema, file }) {
  const res = await call("generateContent", {
    contents: [{ role: "user", parts: [...(file ? [{ inlineData: file }] : []), { text: prompt }] }],
    generationConfig: { ...THINKING, responseMimeType: "application/json", responseJsonSchema: schema },
  });
  try {
    return JSON.parse(textOf(await res.json()));
  } catch {
    throw new HttpError(502, "failed");
  }
}
