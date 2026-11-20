# Kshema

A health companion website for patients and families in Bangalore, in English, Kannada and Hindi.

- **Today**: the day's medicines laid out like a blister pack (morning, afternoon, night). Tap a pill to mark it taken.
- **Medicines**: enter doses the way Indian prescriptions write them (1-0-1, or 0-0-0 for SOS medicines). You can also choose which days a medicine is taken, for weekly ones like vitamin D 60000 IU. The site tracks the last 7 days and warns you when tablets are running low.
- **Readings**: BP, sugar (fasting or after a meal), weight, pulse, SpO2 and temperature (°F or °C). Readings in the danger range show first-aid steps and the emergency numbers.
- **Visits**: doctor appointments, with reminders and a file you can add to your phone's calendar.
- **Ask**: an AI assistant that answers from your own medicines, readings and reports. Attach a lab report (PDF or photo) and it pulls out each value and flags the abnormal ones.
- **Emergency**: one tap to 112 or 108. Tele-MANAS (14416) is shown for mental-health crises.

## Run it

```bash
npm install
npm start              # http://localhost:3000
npm test
```

The Ask page needs an AI. You have two options:

- **Free, on this computer (the default):** install [Ollama](https://ollama.com), open it, and run `ollama pull gemma4:12b` (about 8 GB, needs 16 GB RAM). Health data never leaves the machine. Answers are weaker than Claude's, especially in Kannada, and scanned PDFs need to be uploaded as photos. Set `OLLAMA_MODEL` in `.env` to use a different model.
- **Claude (paid, better answers):** put `ANTHROPIC_API_KEY=sk-ant-...` in `.env` (copy `.env.example`) and restart. With a key set, the server uses Claude.
- **Google Gemini (free tier, for the online demo):** put `GEMINI_API_KEY=...` in `.env`. Google may use free-tier requests to improve its products, so the Ask page warns users to enter made-up details only. If both keys are set, Claude is used.

Everything else works without either. To try report reading, upload a file from `samples/`. These are fictional reports, including a critical kidney report and a dengue report that should both prompt "contact a doctor today".

By default the server only answers on this computer (127.0.0.1), so nobody else on your Wi-Fi can use your AI. To try the site on your phone, start it with `HOST=0.0.0.0 npm start` and open `http://<your-mac's-IP>:3000`.

## How it's built

| Part | File | Notes |
|---|---|---|
| Server | `server.js` | Node's built-in `http`, no framework. Serves `public/`, plus `POST /api/chat` (streamed reply) and `POST /api/report` (reads a report and returns its values as JSON). |
| AI | `lib/prompts.js` | One system prompt shared by both AIs. It sets the rules: no diagnosis, no dose changes, one triage level per reply. Claude Opus 5.5 also uses the server-side refusal fallback. |
| Local AI | `lib/local-ai.js` | Ollama's `/api/chat`, streamed. Report extraction uses a JSON schema, and PDFs are converted to text with pdf.js. |
| Safety | `lib/redflags.js` | Fixed keyword rules in English, Kannada, Hindi and romanised Hindi/Kannada, ignoring simple English negations ("no chest pain"). They run before the AI is called, so the emergency card appears even if the AI fails. |
| Page | `public/app.js`, `public/i18n.js` | Plain JavaScript modules with no build step. Data is stored in the browser's `localStorage` and never on the server. |
| Health logic | `public/logic.js` | Pure functions for reading ranges, adherence, stock and reminders. Tested in `test/`. |

## Put it online (Render + Gemini)

`render.yaml` describes the service, so Render can set it up from this repo:

1. Get a free Gemini API key at [Google AI Studio](https://aistudio.google.com/apikey).
2. On [render.com](https://render.com), sign in with GitHub, choose **New → Blueprint**, and pick this repo.
3. When Render asks for `GEMINI_API_KEY`, paste the key. It's stored on Render, never in the repo.

Render's free plan sleeps after about 15 minutes without visitors, so the first visit after that takes up to a minute. To keep a public link from using up the free quota, each visitor gets 20 AI requests per 10 minutes and the whole site 300 per hour.

## Clinical safety design

The AI is never the only thing standing between a patient and a dangerous mistake. Safety comes in layers, from the most predictable to the least:

1. **Fixed rules, no AI** (`public/logic.js`, `lib/redflags.js`, both unit-tested)
   - Reading ranges use common adult reference values, for example BP 180/120 or above, or sugar under 54 mg/dL, is urgent.
   - Each urgent reading has its own first-aid message: the 15-15 rule for low sugar, recheck-after-rest for very high BP.
   - Emergency keywords in three languages bring up 112 and 108 straight away, plus Tele-MANAS 14416 for self-harm.
   - Lab-report flags are recalculated from the printed reference range instead of trusting the AI's arithmetic.
2. **Input checks:**
   - BP readings with the upper number below the lower one are rejected.
   - Temperatures entered in °C are converted to °F.
   - Weekly and SOS medicines are modelled, so they aren't shown as daily doses.
3. **Prompt rules** (`lib/prompts.js`):
   - The AI never diagnoses and never changes prescription doses.
   - It checks allergies, kidney or liver disease and pregnancy before mentioning an over-the-counter medicine, and never goes above the maximum dose.
   - Every reply ends with one triage level (emergency, see a doctor today, book a visit, care at home), written in the patient's language, plus when to seek help sooner.
4. **The person decides:** every answer points to a doctor or pharmacist for decisions, and reports show whose name is printed on them.

Thresholds and prompts are general adult guidance. They need sign-off from a clinician before real patient use, and children and pregnant women need separate review.

## Testing

`npm test` runs 17 test groups (Node's built-in test runner, no extra dependencies):
- reading ranges, first-aid choice and °C conversion
- weekly medicines, adherence, stock and reminders
- red flags in each language, including negations and words that only look similar ("accidentally", "benefits")
- report range checks
- the server's cleaning of chat history, which is the trust boundary between the browser and the AI
- the Gemini connection (against fake Gemini responses, since the real API needs a key) and the rate limit

I tested the pages by hand in the browser at phone and desktop sizes, in light and dark mode, in all three languages, and with a script that checks text contrast.

## Security

- The server listens only on 127.0.0.1 unless `HOST` is set.
- Request bodies are capped at 15 MB.
- Static files can't be read outside `public/`.
- Every page is served with a Content-Security-Policy, `nosniff` and `no-referrer`.
- All text shown on the page is escaped, including restored backup files and AI replies, which are rendered as limited markdown.
- Uploaded PDFs are parsed with pdf.js with script execution turned off (`isEvalSupported: false`).

## Privacy

Health records stay in the patient's browser. "Download my data" and "Restore from a file" let the patient keep and move their own backup. The Ask page sends the question and a short text summary of the record to the AI: the local model on this computer by default, or the Anthropic API if a key is set. Under India's DPDP Act 2023, a production launch needs explicit consent (the welcome screen is the start of this), a privacy policy, and a decision on where data is processed.

## Known limits (next steps)

- Reminders fire only while a Kshema tab is open. The mobile app should use native notifications.
- No accounts and no sync between devices yet. Data lives in one browser.
- Red-flag keywords catch common phrasings, not every one. The AI prompt is the second layer of protection.
- Clinical thresholds and prompts need review by a doctor before real patients use the site.
