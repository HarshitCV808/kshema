import { test } from "node:test";
import assert from "node:assert/strict";
import { geminiJson, geminiStream } from "../lib/gemini.js";
import { allowRequest } from "../server.js";

// Fake Gemini responses: the real API needs a key, so these check our request and parsing.
function fakeFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return new Response(body, { status });
  };
  return calls;
}

test("streamed Gemini reply: text only, thoughts skipped, roles mapped", async () => {
  const chunk = (parts) => `data: ${JSON.stringify({ candidates: [{ content: { parts } }] })}\r\n\r\n`;
  const calls = fakeFetch(200, chunk([{ text: "hidden", thought: true }]) + chunk([{ text: "Drink " }]) + chunk([{ text: "water." }]));
  let out = "";
  for await (const t of geminiStream("rules", [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }, { role: "user", content: "fever" }])) out += t;
  assert.equal(out, "Drink water.");
  assert.match(calls[0].url, /:streamGenerateContent\?alt=sse$/);
  assert.deepEqual(calls[0].body.contents.map((c) => c.role), ["user", "model", "user"]);
  assert.equal(calls[0].body.systemInstruction.parts[0].text, "rules");
});

test("report extraction sends the file inline and parses JSON", async () => {
  const calls = fakeFetch(200, JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"is_report":true}' }] } }] }));
  const out = await geminiJson("read it", { schema: { type: "object" }, file: { mimeType: "application/pdf", data: "QUJD" } });
  assert.deepEqual(out, { is_report: true });
  assert.deepEqual(calls[0].body.contents[0].parts[0], { inlineData: { mimeType: "application/pdf", data: "QUJD" } });
  assert.equal(calls[0].body.generationConfig.responseMimeType, "application/json");
});

test("Gemini errors become codes the page understands", async () => {
  fakeFetch(429, "quota");
  await assert.rejects(geminiJson("x", { schema: {} }), { code: "busy" });
  fakeFetch(400, '{"error":{"message":"API key not valid"}}');
  await assert.rejects(geminiJson("x", { schema: {} }), { code: "missing_key" });
});

test("rate limit: 20 AI requests per visitor per 10 minutes", () => {
  const t = 1_000_000;
  for (let i = 0; i < 20; i++) assert.ok(allowRequest("1.2.3.4", t + i));
  assert.equal(allowRequest("1.2.3.4", t + 21), false);
  assert.ok(allowRequest("5.6.7.8", t + 22)); // other visitors unaffected
  assert.ok(allowRequest("1.2.3.4", t + 600e3 + 1)); // window passes
});
