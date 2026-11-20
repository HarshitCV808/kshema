import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import Anthropic from "@anthropic-ai/sdk";
import { findRedFlags } from "./lib/redflags.js";
import { LANGS, LEVELS, REPORT_PROMPT, REPORT_SCHEMA, SYSTEM_PROMPT } from "./lib/prompts.js";
import { HttpError, LOCAL_MODEL, localJson, localStream, pdfText } from "./lib/local-ai.js";
import { GEMINI_MODEL, geminiJson, geminiStream } from "./lib/gemini.js";

const PUBLIC = fileURLToPath(new URL("./public/", import.meta.url));
const PORT = Number(process.env.PORT) || 3000;
// Only this computer can reach the site by default, so nobody on the same Wi-Fi can use your
// AI (or your API credit). Set HOST=0.0.0.0 to test from a phone on your network.
const HOST = process.env.HOST || "127.0.0.1";
const MODEL = "claude-opus-5-5";
// Which AI answers: Claude if an Anthropic key is set, else Gemini if a Gemini key is set
// (the online demo), else the free local model through Ollama.
const PROVIDER = process.env.ANTHROPIC_API_KEY ? "claude" : process.env.GEMINI_API_KEY ? "gemini" : "local";
const PROVIDER_NAME = { claude: MODEL, gemini: `${GEMINI_MODEL} (Google)`, local: `${LOCAL_MODEL} via Ollama` }[PROVIDER];
// Server-side refusal fallback: if a safety classifier declines (health topics can trip
// one by mistake), the API re-runs the request on Anthropic's recommended fallback model.
const FALLBACK = { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
const MAX_BODY = 15 * 1024 * 1024; // reports arrive as base64
const REPORT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
};

let client;
const anthropic = () => (client ??= new Anthropic());

async function readJson(req) {
  let size = 0;
  const chunks = [];
  for await (const c of req) {
    size += c.length;
    if (size > MAX_BODY) throw new HttpError(413, "too_large");
    chunks.push(c);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "bad_json");
  }
}

// Map errors to codes the page translates. Most specific first.
function errorCode(err) {
  if (err instanceof HttpError) return err.code;
  if (err instanceof Anthropic.AuthenticationError || /api key|apiKey|credentials/i.test(err?.message)) return "missing_key";
  if (err instanceof Anthropic.RateLimitError || err instanceof Anthropic.InternalServerError) return "busy";
  if (err instanceof Anthropic.APIConnectionError) return "offline";
  return "failed";
}

function sendJson(res, status, body) {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

const lang = (code) => LANGS[code] || LANGS.en;

// Trust boundary: the page sends history, but we only pass well-formed text turns,
// merged so roles alternate and the last turn is the user's.
export function cleanMessages(raw) {
  if (!Array.isArray(raw)) throw new HttpError(400, "bad_messages");
  const out = [];
  for (const m of raw.slice(-24)) {
    if (!["user", "assistant"].includes(m?.role) || typeof m.content !== "string") continue;
    const content = m.content.trim().slice(0, 4000);
    if (!content) continue;
    const prev = out.at(-1);
    if (prev?.role === m.role) prev.content += `\n\n${content}`;
    else out.push({ role: m.role, content });
  }
  while (out[0]?.role === "assistant") out.shift();
  if (out.at(-1)?.role !== "user") throw new HttpError(400, "bad_messages");
  return out;
}

async function* claudeStream(patient, messages, signal) {
  const stream = anthropic().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 16000,
      ...FALLBACK,
      output_config: { effort: "medium" },
      system: [
        { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        { type: "text", text: patient },
      ],
      messages,
    },
    { signal },
  );
  for await (const ev of stream) {
    if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") yield ev.delta.text;
  }
  if ((await stream.finalMessage()).stop_reason === "refusal") throw new HttpError(422, "refused");
}

async function chat(req, res) {
  const body = await readJson(req);
  const messages = cleanMessages(body.messages);
  const flags = findRedFlags(messages.at(-1).content);
  const record = String(body.context || "").slice(0, 20000);

  const levels = (LEVELS[body.lang] || LEVELS.en).map((l) => `**${l}**`).join(", ");
  let patient = `Reply in ${lang(body.lang)}. Write the next-step level with exactly one of these labels, in this order of urgency: ${levels}.\n\nPatient record (entered by the patient, may be incomplete):\n${record || "Nothing recorded yet."}`;
  if (flags.length) {
    patient += `\n\nSAFETY: the latest message matched emergency warning signs (${flags.join(", ")}). Open your reply by telling them to call 112 or 108 now${flags.includes("selfharm") ? " and give Tele-MANAS 14416" : ""}.`;
  }

  res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache", connection: "keep-alive" });
  const send = (data) => res.write(`data: ${JSON.stringify(data)}\n\n`);
  if (flags.length) send({ type: "redflag", kinds: flags });

  const abort = new AbortController();
  res.on("close", () => abort.abort());
  try {
    const system = `${SYSTEM_PROMPT}\n\n${patient}`;
    const text =
      PROVIDER === "claude" ? claudeStream(patient, messages, abort.signal)
      : PROVIDER === "gemini" ? geminiStream(system, messages, abort.signal)
      : localStream(system, messages, abort.signal);
    for await (const t of text) send({ type: "text", text: t });
    send({ type: "done" });
  } catch (err) {
    if (!res.destroyed) send({ type: "error", code: errorCode(err) });
    console.error("chat:", err?.message);
  }
  res.end();
}

async function report(req, res) {
  const body = await readJson(req);
  if (!REPORT_TYPES.includes(body.mediaType) || typeof body.data !== "string" || !body.data) {
    throw new HttpError(400, "bad_file");
  }
  const pdf = body.mediaType === "application/pdf";
  const prompt = `${REPORT_PROMPT}\nWrite title and summary in ${lang(body.lang)}.`;

  if (PROVIDER === "gemini") {
    return sendJson(res, 200, await geminiJson(prompt, { schema: REPORT_SCHEMA, file: { mimeType: body.mediaType, data: body.data } }));
  }
  if (PROVIDER === "local") {
    if (!pdf) return sendJson(res, 200, await localJson(prompt, { schema: REPORT_SCHEMA, images: [body.data] }));
    const text = await pdfText(body.data);
    if (text.replace(/\s/g, "").length < 40) throw new HttpError(422, "scanned_pdf");
    return sendJson(res, 200, await localJson(`${prompt}\n\nDocument text:\n${text.slice(0, 40000)}`, { schema: REPORT_SCHEMA }));
  }

  const file = pdf
    ? { type: "document", source: { type: "base64", media_type: body.mediaType, data: body.data } }
    : { type: "image", source: { type: "base64", media_type: body.mediaType, data: body.data } };
  const msg = await anthropic().beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    ...FALLBACK,
    output_config: { effort: "medium", format: { type: "json_schema", schema: REPORT_SCHEMA } },
    messages: [{ role: "user", content: [file, { type: "text", text: prompt }] }],
  });
  if (msg.stop_reason === "refusal") throw new HttpError(422, "refused");
  try {
    sendJson(res, 200, JSON.parse(msg.content.find((b) => b.type === "text")?.text));
  } catch {
    throw new HttpError(502, "failed");
  }
}

async function serveStatic(req, res) {
  let path;
  try {
    path = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return sendJson(res, 400, { error: "bad_path" });
  }
  const file = normalize(join(PUBLIC, path === "/" ? "index.html" : path));
  if (!file.startsWith(PUBLIC)) return sendJson(res, 403, { error: "forbidden" });
  try {
    const data = await readFile(file);
    res.writeHead(200, { "content-type": MIME[extname(file)] || "application/octet-stream", ...SECURITY_HEADERS });
    res.end(data);
  } catch {
    sendJson(res, 404, { error: "not_found" });
  }
}

// Pages may only load scripts from this server and fonts from Google Fonts. Inline style
// attributes are allowed because the page sets per-medicine colours with them.
const SECURITY_HEADERS = {
  "content-security-policy":
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'",
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
};

// Public-demo protection: each visitor gets 20 AI requests per 10 minutes and the whole site
// 300 per hour, so one person can't use up a free API quota.
// shortcut: counts live in memory and reset on restart; use a shared store if there are several servers.
const hits = new Map();
export function allowRequest(ip, now = Date.now()) {
  const recent = (k, ms) => (hits.get(k) ?? []).filter((t) => now - t < ms);
  const mine = recent(ip, 600e3);
  const all = recent("*", 3600e3);
  if (mine.length >= 20 || all.length >= 300) return false;
  if (hits.size > 5000) hits.clear(); // keeps memory bounded if many visitors pass through
  hits.set(ip, [...mine, now]);
  hits.set("*", [...all, now]);
  return true;
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === "GET" && req.url === "/api/info") return sendJson(res, 200, { provider: PROVIDER });
    if (req.method === "POST" && req.url.startsWith("/api/")) {
      // Behind Render's proxy the visitor's address is the first x-forwarded-for entry.
      const ip = req.headers["x-forwarded-for"]?.split(",")[0].trim() || req.socket.remoteAddress;
      if (!allowRequest(ip)) return sendJson(res, 429, { error: "busy" });
    }
    if (req.method === "POST" && req.url === "/api/chat") return await chat(req, res);
    if (req.method === "POST" && req.url === "/api/report") return await report(req, res);
    if (req.method === "GET") return await serveStatic(req, res);
    sendJson(res, 405, { error: "method_not_allowed" });
  } catch (err) {
    console.error(req.url, err?.message);
    const code = errorCode(err);
    const status = err.status || (code === "missing_key" ? 503 : 500);
    if (!res.headersSent) sendJson(res, status, { error: code });
    else res.end();
  }
});

// Tests import this file for its helpers, so only listen when run directly.
if (import.meta.main) server.listen(PORT, HOST, () =>
  console.log(`Kshema running at http://${HOST === "127.0.0.1" ? "localhost" : HOST}:${PORT} (assistant: ${PROVIDER_NAME})`),
);
