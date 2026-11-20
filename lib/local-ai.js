// Free local AI through Ollama (https://ollama.com), used when no Anthropic API key is set.
// Runs entirely on this computer, so health data never leaves it.
import { createRequire } from "node:module";
import { dirname } from "node:path";
import { getDocument } from "pdfjs-dist/legacy/build/pdf.mjs";

const BASE = process.env.OLLAMA_URL || "http://127.0.0.1:11434";
export const LOCAL_MODEL = process.env.OLLAMA_MODEL || "gemma4:12b";
// Ollama's default context window is too small for the system prompt plus the patient record.
const OPTIONS = { num_ctx: 16384 };

export class HttpError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

async function call(body, signal) {
  let res;
  try {
    res = await fetch(`${BASE}/api/chat`, {
      method: "POST",
      // think: false skips the model's hidden reasoning pass, about 4x faster on a laptop with similar answers.
      body: JSON.stringify({ model: LOCAL_MODEL, think: false, options: OPTIONS, ...body }),
      signal,
    });
  } catch (err) {
    if (err.name === "AbortError") throw err;
    throw new HttpError(503, "no_local_ai"); // Ollama app isn't running
  }
  if (!res.ok) throw new HttpError(503, res.status === 404 ? "no_model" : "failed");
  return res;
}

// Yields reply text as it is generated.
export async function* localStream(system, messages, signal) {
  const res = await call({ stream: true, messages: [{ role: "system", content: system }, ...messages] }, signal);
  let buf = "";
  for await (const chunk of res.body.pipeThrough(new TextDecoderStream())) {
    buf += chunk;
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line) continue;
      const ev = JSON.parse(line);
      if (ev.error) throw new HttpError(502, "failed");
      if (ev.message?.content) yield ev.message.content;
    }
  }
}

// One answer constrained to a JSON schema; images are base64 strings.
export async function localJson(prompt, { schema, images }) {
  const res = await call({
    stream: false,
    format: schema,
    options: { ...OPTIONS, temperature: 0 },
    messages: [{ role: "user", content: prompt, ...(images && { images }) }],
  });
  const { message } = await res.json();
  try {
    return JSON.parse(message.content);
  } catch {
    throw new HttpError(502, "failed");
  }
}

// Local models can't read PDFs, so pull the text out first. Scanned PDFs have no text layer.
const FONTS = `${dirname(createRequire(import.meta.url).resolve("pdfjs-dist/package.json"))}/standard_fonts/`;

export async function pdfText(base64, maxPages = 20) {
  const task = getDocument({
    data: new Uint8Array(Buffer.from(base64, "base64")),
    isEvalSupported: false, // never run code embedded in an uploaded file
    standardFontDataUrl: FONTS,
  });
  try {
    const doc = await task.promise;
    const pages = [];
    for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
      const { items } = await (await doc.getPage(p)).getTextContent();
      pages.push(items.map((it) => it.str + (it.hasEOL ? "\n" : " ")).join(""));
    }
    return pages.join("\n\n");
  } catch {
    throw new HttpError(400, "bad_file");
  } finally {
    await task.destroy();
  }
}
