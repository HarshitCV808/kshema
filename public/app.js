import { LOCALES, STRINGS } from "./i18n.js";
import {
  SLOTS, VITALS, addDays, adherence, adviceKey, classifyVital, dueReminders, formatVital, isActiveOn, isOngoing, perDay,
  rangeFlag, stockDays, toFahrenheit, todayKey,
} from "./logic.js";

// ---------- state (stored only in this browser) ----------

const KEY = "kshema.v1";
// Pill colours tell medicines apart; kept away from the neem green used for actions.
const PILL_COLORS = ["#2A7FA8", "#D08A1E", "#C2416B", "#7C5BD6", "#8A6A3B", "#3F8F6B"];
const REPORT_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp"];

const blank = () => ({
  profile: { name: "", age: "", sex: "", conditions: "", allergies: "" },
  meds: [], taken: {}, vitals: [], appts: [], reports: [], chat: [], notified: {},
  settings: { lang: "en", theme: "system", consent: false, slotTimes: { morning: "08:00", afternoon: "14:00", night: "21:00" } },
});

// Fill in anything missing from saved (or restored) data so older versions still load.
function normalize(s) {
  const b = blank();
  return {
    ...b, ...s,
    settings: { ...b.settings, ...s.settings, slotTimes: { ...b.settings.slotTimes, ...s.settings?.slotTimes } },
  };
}

function load() {
  try {
    return normalize(JSON.parse(localStorage.getItem(KEY)) || {});
  } catch {
    return blank();
  }
}

let state = load();
let busy = false;
let aiProvider = "local"; // claude | gemini | local, from /api/info

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    toast(t("storageFull"));
  }
}

function prune() {
  const oldest = addDays(todayKey(), -90);
  for (const k of Object.keys(state.taken)) if (k < oldest) delete state.taken[k];
  for (const [k, at] of Object.entries(state.notified)) if (Date.now() - at > 3 * 864e5) delete state.notified[k];
}

// ---------- helpers ----------

const $ = (s) => document.querySelector(s);
const uid = () => crypto.randomUUID?.() ?? `${Date.now()}${Math.random().toString(16).slice(2)}`;
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const t = (k, vars = {}) =>
  (STRINGS[state.settings.lang]?.[k] ?? STRINGS.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
const loc = () => LOCALES[state.settings.lang];
const fmtDate = (key, opts = { day: "numeric", month: "short" }) => new Date(`${key}T00:00`).toLocaleDateString(loc(), opts);
const fmtTime = (hhmm) => new Date(`2000-01-01T${hhmm}`).toLocaleTimeString(loc(), { hour: "numeric", minute: "2-digit" });
const fmtWhen = (iso) => new Date(iso).toLocaleString(loc(), { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
// 2026-11-22 is a Sunday, so day 0..6 maps to Sunday..Saturday in the user's language.
const weekday = (d, weekday = "short") =>
  new Date(2026, 10, 22 + d).toLocaleDateString(loc(), { weekday });
const fmtNum =(n) => (Number(n) === 0.5 ? "½" : String(Number(n) % 1 === 0.5 ? `${Math.floor(n)}½` : Number(n)));
const empty = (v) => v === "" || v == null;
const upsert = (list, item) => {
  const i = list.findIndex((x) => x.id === item.id);
  i >= 0 ? (list[i] = item) : list.push(item);
};

const ICONS = {
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>',
  pill: '<path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z"/><path d="m8.5 8.5 7 7"/>',
  activity: '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
  calendar: '<rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  chat: '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/>',
  user: '<circle cx="12" cy="8" r="5"/><path d="M20 21a8 8 0 0 0-16 0"/>',
  phone: '<path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z"/>',
  plus: '<path d="M5 12h14M12 5v14"/>',
  clip: '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l8.57-8.57A4 4 0 1 1 18 8.84l-8.59 8.57a2 2 0 0 1-2.83-2.83l8.49-8.48"/>',
  send: '<path d="m22 2-7 20-4-9-9-4Z"/><path d="M22 2 11 13"/>',
  trash: '<path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>',
  check: '<path d="M20 6 9 17l-5-5"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
  download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  file: '<path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  pencil: '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/>',
};
const icon = (name, size = 20) =>
  `<svg class="i" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name]}</svg>`;

let fieldSeq = 0;
// Wraps a control with a linked label and optional hint.
function field(label, control, hint = "") {
  const id = `f${++fieldSeq}`;
  const ctl = control.replace(/^<(\w+)/, `<$1 id="${id}"${hint ? ` aria-describedby="${id}h"` : ""}`);
  return `<div class="field"><label for="${id}">${esc(label)}</label>${ctl}${hint ? `<p class="hint" id="${id}h">${esc(hint)}</p>` : ""}</div>`;
}
const options = (pairs, current) =>
  pairs.map(([v, label]) => `<option value="${esc(v)}"${String(v) === String(current) ? " selected" : ""}>${esc(label)}</option>`).join("");

function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.add("show");
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove("show"), 3200);
}

function download(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Minimal, safe markdown for assistant replies: paragraphs, lists, bold.
function md(src) {
  const inline = (s) => esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  const out = [];
  let list = null;
  for (const raw of src.split("\n")) {
    const line = raw.trim();
    const li = line.match(/^(?:[-*•]|\d+[.)])\s+(.*)/);
    if (li) {
      const tag = /^\d/.test(line) ? "ol" : "ul";
      if (list !== tag) {
        if (list) out.push(`</${list}>`);
        out.push(`<${tag}>`);
        list = tag;
      }
      out.push(`<li>${inline(li[1])}</li>`);
      continue;
    }
    if (list) out.push(`</${list}>`);
    list = null;
    if (!line) continue;
    const h = line.match(/^#{1,4}\s+(.*)/);
    out.push(h ? `<p><strong>${inline(h[1])}</strong></p>` : `<p>${inline(line)}</p>`);
  }
  if (list) out.push(`</${list}>`);
  return out.join("");
}

// ---------- views ----------

const NAV = [
  ["today", "sun", "navToday"],
  ["meds", "pill", "navMeds"],
  ["vitals", "activity", "navVitals"],
  ["visits", "calendar", "navVisits"],
  ["ask", "chat", "navAsk"],
];
const VIEWS = { today: viewToday, meds: viewMeds, vitals: viewVitals, visits: viewVisits, ask: viewAsk, me: viewMe };
let view = "today";

const doseLine = (m, s) =>
  [t("tablets", { n: fmtNum(m.pattern[s]) }), m.strength, m.food !== "anytime" && t(m.food)].filter(Boolean).join(", ");

const upcomingAppts = () =>
  state.appts.filter((a) => new Date(`${a.date}T${a.time}`) > new Date()).sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));

const latestVitals = () =>
  Object.keys(VITALS)
    .map((type) => state.vitals.filter((v) => v.type === type).sort((a, b) => a.at.localeCompare(b.at)).at(-1))
    .filter(Boolean);

function viewToday() {
  const key = todayKey();
  const h = new Date().getHours();
  const greet = t(h < 12 ? "goodMorning" : h < 17 ? "goodAfternoon" : "goodEvening");
  const name = state.profile.name ? `, ${esc(state.profile.name)}` : "";
  const active = state.meds.filter((m) => isActiveOn(m, key));
  let due = 0;
  let done = 0;

  const cols = SLOTS.map((slot, s) => {
    const items = active
      .filter((m) => Number(m.pattern[s]) > 0)
      .map((m) => {
        const taken = !!state.taken[key]?.[`${m.id}:${slot}`];
        due++;
        if (taken) done++;
        return `<li><button type="button" class="dose${taken ? " is-taken" : ""}" data-action="toggle-dose" data-id="${m.id}" data-slot="${slot}" aria-pressed="${taken}" aria-label="${esc(t("markTaken", { name: m.name, slot: t(slot) }))}">
          <span class="dome" style="--pill:${esc(m.color)}"><span class="capsule"></span>${icon("check", 18)}</span>
          <span class="dose-text"><span class="dose-name">${esc(m.name)}</span><span class="dose-meta">${esc(doseLine(m, s))}</span></span>
        </button></li>`;
      })
      .join("");
    return `<div class="pocket-col">
      <h3>${esc(t(slot))} <time>${fmtTime(state.settings.slotTimes[slot])}</time></h3>
      ${items ? `<ul>${items}</ul>` : `<p class="pocket-empty">${esc(t("nothingDue"))}</p>`}
    </div>`;
  }).join("");

  const blister = active.length
    ? `<div class="foil">${cols}</div>
       <p class="progress"><span class="meter" style="--f:${due ? done / due : 0}"></span>${esc(t("dosesTaken", { done, due }))}</p>`
    : `<div class="foil foil-empty"><p>${esc(t("noMedsYet"))}</p><button class="btn" data-action="open-med">${icon("plus")}${esc(t("addMed"))}</button></div>`;

  const next = upcomingAppts()[0];
  const latest = latestVitals();
  const refills = state.meds.filter((m) => isOngoing(m, key)).map((m) => [m, stockDays(m)]).filter(([, d]) => d !== null && d <= 5);

  return `
  <div class="greet"><h1>${esc(greet)}${name}</h1>
    <p>${esc(new Date().toLocaleDateString(loc(), { weekday: "long", day: "numeric", month: "long" }))}</p></div>
  <div class="today-grid">
    <section class="blister" aria-labelledby="today-meds">
      <h2 id="today-meds">${esc(t("todayMeds"))}</h2>
      ${blister}
    </section>
    <div class="side">
      ${refills.length ? `<section class="panel warn"><h2>${esc(t("refillSoon"))}</h2><ul class="plain">${refills
        .map(([m, d]) => `<li><strong>${esc(m.name)}</strong> ${esc(t("daysLeft", { n: d }))}</li>`).join("")}</ul></section>` : ""}
      <section class="panel"><h2>${esc(t("nextVisit"))}</h2>${next ? visitCard(next, true) : `<p class="quiet">${esc(t("noVisits"))}</p>`}</section>
      <section class="panel"><h2>${esc(t("latestReadings"))}</h2>${latest.length
        ? `<ul class="mini-vitals">${latest.map((v) => {
            const lvl = classifyVital(v);
            return `<li><span>${esc(t(v.type))}, ${esc(fmtWhen(v.at))}</span><strong>${esc(formatVital(v))}</strong> <small>${VITALS[v.type].unit}</small><span class="badge lvl-${lvl}">${esc(t(`lvl_${lvl}`))}</span></li>`;
          }).join("")}</ul>`
        : `<p class="quiet">${esc(t("noReadings"))}</p>`}</section>
      ${reminderCard()}
    </div>
  </div>`;
}

function reminderCard() {
  if (!("Notification" in window)) return "";
  if (Notification.permission === "granted") return `<p class="quiet note">${icon("bell", 16)} ${esc(t("remindersOn"))}</p>`;
  if (Notification.permission === "denied") return `<p class="quiet note">${esc(t("remindersBlocked"))}</p>`;
  return `<section class="panel tint"><p>${esc(t("remindersHint"))}</p>
    <button class="btn ghost" data-action="enable-reminders">${icon("bell")}${esc(t("enableReminders"))}</button></section>`;
}

function viewMeds() {
  const key = todayKey();
  const days = adherence(state.meds, state.taken, key, 7);
  const week = days.some((d) => d.due)
    ? `<section class="panel"><h2>${esc(t("last7"))}</h2><ol class="week">${days.map((d) => `
        <li aria-label="${esc(t("adherenceDay", { date: fmtDate(d.key, { weekday: "long", day: "numeric" }), done: d.done, due: d.due }))}">
          <span class="bar${d.due ? "" : " none"}"><span style="--f:${d.due ? d.done / d.due : 0}"></span></span>
          <span aria-hidden="true">${esc(fmtDate(d.key, { weekday: "narrow" }))}</span></li>`).join("")}</ol></section>`
    : "";
  const list = state.meds.map((m) => medRow(m, key)).join("") || `<p class="empty">${esc(t("noMeds"))}</p>`;
  return `<div class="page-head"><h1>${esc(t("navMeds"))}</h1>
      <button class="btn" data-action="open-med">${icon("plus")}${esc(t("addMed"))}</button></div>
    ${week}<div class="list">${list}</div>`;
}

function medRow(m, key) {
  const days = stockDays(m);
  const ended = m.end && m.end < key;
  const label = SLOTS.map((s, i) => `${t(s)} ${m.pattern[i]}`).join(", ");
  return `<article class="med${ended ? " ended" : ""}" style="--pill:${esc(m.color)}">
    ${perDay(m) ? `<p class="dosage" aria-label="${esc(label)}">${m.pattern
      .map((n) => `<span${Number(n) ? "" : ' class="zero"'}>${fmtNum(n)}</span>`)
      .join('<span class="dash" aria-hidden="true">-</span>')}</p>` : `<p class="sos-tag">${esc(t("asNeeded"))}</p>`}
    <div class="med-body">
      <h3>${esc(m.name)} ${m.strength ? `<small>${esc(m.strength)}</small>` : ""}</h3>
      <p>${esc(m.food === "anytime" ? t("anytime") : t(m.food))}. ${esc(m.days?.length ? m.days.map((d) => weekday(d)).join(", ") : t("everyDay"))}. ${esc(m.end ? t("until", { date: fmtDate(m.end) }) : t("ongoing"))}</p>
      ${days !== null ? `<p class="${days <= 5 ? "warn-text" : "quiet"}">${esc(t("daysLeft", { n: days }))}</p>` : ""}
      ${m.notes ? `<p class="quiet">${esc(m.notes)}</p>` : ""}
    </div>
    <div class="row-actions">
      <button class="icon-btn" data-action="open-med" data-id="${m.id}" aria-label="${esc(`${t("edit")} ${m.name}`)}">${icon("pencil", 18)}</button>
      <button class="icon-btn" data-action="del-med" data-id="${m.id}" aria-label="${esc(`${t("delete")} ${m.name}`)}">${icon("trash", 18)}</button>
    </div>
  </article>`;
}

function spark(list) {
  if (list.length < 2) return "";
  const ys = list.map((v) => Number(v.type === "bp" ? v.values.sys : v.values.value));
  const min = Math.min(...ys);
  const span = Math.max(...ys) - min || 1;
  const pts = ys.map((y, i) => `${((i / (ys.length - 1)) * 116 + 2).toFixed(1)},${(30 - ((y - min) / span) * 26).toFixed(1)}`);
  return `<svg class="spark" viewBox="0 0 120 32" preserveAspectRatio="none" aria-hidden="true"><polyline points="${pts.join(" ")}"/></svg>`;
}

function viewVitals() {
  const latest = latestVitals();
  const alerts = latest
    .filter((v) => Date.now() - new Date(v.at) < 864e5) // an old reading shouldn't keep raising alarms
    .map((v) => [v, adviceKey(v)])
    .filter(([, k]) => k);
  const cards = Object.keys(VITALS).map((type) => {
    const list = state.vitals.filter((v) => v.type === type).sort((a, b) => a.at.localeCompare(b.at));
    const last = list.at(-1);
    if (!last) {
      return `<button class="vital-card add" data-action="open-vital" data-type="${type}">
        <span class="vital-name">${esc(t(type))}</span><span class="vital-add">${icon("plus", 18)}${esc(t("logReading"))}</span></button>`;
    }
    const lvl = classifyVital(last);
    return `<article class="vital-card lvl-${lvl}">
      <header><h2>${esc(t(type))}</h2><span class="badge lvl-${lvl}">${esc(t(`lvl_${lvl}`))}</span></header>
      <p class="vital-value"><strong>${esc(formatVital(last))}</strong> <span>${VITALS[type].unit}</span></p>
      <p class="quiet">${esc(fmtWhen(last.at))}${last.context ? `, ${esc(t(last.context))}` : ""}</p>
      ${spark(list.slice(-12))}
      <button class="link-btn" data-action="open-vital" data-type="${type}">${icon("plus", 16)}${esc(t("logReading"))}</button>
    </article>`;
  }).join("");
  const recent = [...state.vitals].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 20);
  return `<div class="page-head"><h1>${esc(t("navVitals"))}</h1>
      <button class="btn" data-action="open-vital">${icon("plus")}${esc(t("logReading"))}</button></div>
    ${alerts.map(([v, k]) => `<div class="alert" role="alert">${icon("phone")}<p><strong>${esc(t(v.type))} ${esc(formatVital(v))}</strong> ${esc(t(k))}</p><a class="btn danger" href="tel:108">108</a></div>`).join("")}
    <div class="vital-grid">${cards}</div>
    ${recent.length ? `<section class="panel"><h2>${esc(t("recent"))}</h2><ul class="readings">${recent.map((v) => {
      const lvl = classifyVital(v);
      return `<li><span class="r-type">${esc(t(v.type))}</span>
        <span class="r-val"><strong>${esc(formatVital(v))}</strong> ${VITALS[v.type].unit}</span>
        <span class="badge lvl-${lvl}">${esc(t(`lvl_${lvl}`))}</span>
        <span class="quiet">${esc(fmtWhen(v.at))}</span>
        <button class="icon-btn" data-action="del-vital" data-id="${v.id}" aria-label="${esc(t("delete"))}">${icon("trash", 16)}</button></li>`;
    }).join("")}</ul></section>` : ""}`;
}

function visitCard(a, compact = false) {
  const d = new Date(`${a.date}T00:00`);
  return `<article class="visit${compact ? " compact" : ""}">
    <p class="cal" aria-hidden="true"><span>${esc(d.toLocaleDateString(loc(), { month: "short" }))}</span><strong>${d.getDate()}</strong></p>
    <div class="visit-body">
      <h3>${esc(a.doctor)}${a.specialty ? ` <small>${esc(a.specialty)}</small>` : ""}</h3>
      <p>${esc(fmtDate(a.date, { weekday: "long", day: "numeric", month: "long" }))}, ${esc(fmtTime(a.time))}</p>
      ${a.clinic ? `<p class="quiet">${esc(a.clinic)}</p>` : ""}
      ${a.notes && !compact ? `<p class="notes">${esc(a.notes)}</p>` : ""}
    </div>
    ${compact ? "" : `<div class="row-actions">
      <button class="icon-btn" data-action="ics" data-id="${a.id}" aria-label="${esc(t("addToCalendar"))}" title="${esc(t("addToCalendar"))}">${icon("download", 18)}</button>
      <button class="icon-btn" data-action="open-visit" data-id="${a.id}" aria-label="${esc(t("edit"))}">${icon("pencil", 18)}</button>
      <button class="icon-btn" data-action="del-visit" data-id="${a.id}" aria-label="${esc(t("delete"))}">${icon("trash", 18)}</button></div>`}
  </article>`;
}

function viewVisits() {
  const up = upcomingAppts();
  const past = state.appts.filter((a) => !up.includes(a)).sort((a, b) => (b.date + b.time).localeCompare(a.date + a.time)).slice(0, 10);
  return `<div class="page-head"><h1>${esc(t("navVisits"))}</h1>
      <button class="btn" data-action="open-visit">${icon("plus")}${esc(t("addVisit"))}</button></div>
    <section><h2 class="sub">${esc(t("upcoming"))}</h2>${up.length ? `<div class="list">${up.map((a) => visitCard(a)).join("")}</div>` : `<p class="empty">${esc(t("noVisits"))}</p>`}</section>
    ${past.length ? `<section class="past"><h2 class="sub">${esc(t("past"))}</h2><div class="list">${past.map((a) => visitCard(a)).join("")}</div></section>` : ""}`;
}

const FLAG_MARK = { high: "↑", low: "↓", abnormal: "!" };

function reportCard(r) {
  const flagged = r.results.filter((x) => FLAG_MARK[x.flag]);
  return `<article class="report">
    <header><div><h3>${esc(r.title)}</h3><p class="quiet">${esc([r.patient && t("reportFor", { name: r.patient }), r.date, r.lab].filter(Boolean).join(", "))}</p></div>
      <button class="icon-btn" data-action="del-report" data-id="${r.id}" aria-label="${esc(`${t("delete")} ${r.title}`)}">${icon("trash", 18)}</button></header>
    <p>${esc(r.summary)}</p>
    ${r.results.length ? `<p class="${flagged.length ? "warn-text" : "ok-text"}">${esc(flagged.length ? t("needsAttention", { n: flagged.length }) : t("allInRange"))}</p>
    <div class="table-wrap"><table><thead><tr><th scope="col">${esc(t("test"))}</th><th scope="col">${esc(t("result"))}</th><th scope="col">${esc(t("range"))}</th></tr></thead><tbody>
      ${r.results.map((x) => `<tr class="${FLAG_MARK[x.flag] ? "flagged" : ""}"><th scope="row">${esc(x.test)}</th>
        <td>${esc(x.value)} ${esc(x.unit)}${FLAG_MARK[x.flag] ? ` <span class="flag" aria-label="${esc(x.flag)}">${FLAG_MARK[x.flag]}</span>` : ""}</td><td>${esc(x.range)}</td></tr>`).join("")}
    </tbody></table></div>` : ""}
  </article>`;
}

function callLinks(mental) {
  return `<ul class="calls">
    <li><a class="call primary" href="tel:112">${icon("phone")}${esc(t("call112"))}</a></li>
    <li><a class="call" href="tel:108">${icon("phone")}${esc(t("call108"))}</a></li>
    ${mental ? `<li><a class="call" href="tel:14416">${icon("phone")}${esc(t("call14416"))}</a></li>` : ""}
  </ul>`;
}

function msgHtml(m) {
  if (m.role === "flag") {
    return `<div class="msg flag" role="alert"><h3>${esc(t("emergencyTitle"))}</h3><p>${esc(t("emergencyBody"))}</p>${callLinks(m.kinds.includes("selfharm"))}</div>`;
  }
  if (m.role === "user") return `<div class="msg user"><p class="bubble">${esc(m.content)}</p></div>`;
  const body = m.pending && !m.content
    ? `<span class="typing"><span></span><span></span><span></span>${esc(m.status || t("thinking"))}</span>`
    : md(m.content);
  return `<div class="msg bot${m.error ? " err" : ""}"><div class="bubble">${body}</div></div>`;
}

function viewAsk() {
  const intro = state.chat.length
    ? ""
    : `<div class="ask-intro"><p>${esc(t("askIntro"))}</p><div class="chips">${["try1", "try2", "try3"]
        .map((k) => `<button class="chip" data-action="suggest" data-text="${esc(t(k))}">${esc(t(k))}</button>`).join("")}</div></div>`;
  return `<div class="ask">
    <div class="page-head"><h1>${esc(t("navAsk"))}</h1>
      ${state.chat.length ? `<button class="btn ghost small" data-action="clear-chat"${busy ? " disabled" : ""}>${esc(t("clearChat"))}</button>` : ""}</div>
    ${aiProvider === "gemini" ? `<p class="demo-note" role="note">${esc(t("demoNotice"))}
      <a href="https://github.com/HarshitCV808/kshema/tree/main/samples" target="_blank" rel="noopener">${esc(t("sampleReports"))}</a></p>` : ""}
    ${state.reports.length ? `<details class="reports"><summary>${icon("file", 18)}${esc(t("reports", { n: state.reports.length }))}</summary>${state.reports.map(reportCard).join("")}</details>` : ""}
    <div id="chat-log" class="chat-log" aria-live="polite" aria-busy="${busy}">${intro}${state.chat.map(msgHtml).join("")}</div>
    <form id="composer" class="composer">
      <label class="attach icon-btn" title="${esc(t("attach"))}">
        <input type="file" class="sr-only" id="report-file" accept="${REPORT_TYPES.join(",")}"${busy ? " disabled" : ""}>
        <span class="sr-only">${esc(t("attach"))}</span>${icon("clip")}</label>
      <label class="sr-only" for="msg">${esc(t("messagePlaceholder"))}</label>
      <textarea id="msg" name="msg" rows="1" enterkeyhint="send" placeholder="${esc(t("messagePlaceholder"))}"></textarea>
      <button class="send" aria-label="${esc(t("send"))}"${busy ? " disabled" : ""}>${icon("send")}</button>
    </form>
  </div>`;
}

function viewMe() {
  const p = state.profile;
  const s = state.settings;
  return `<div class="page-head"><h1>${esc(t("navMe"))}</h1></div>
  <form id="profile-form" class="panel form-grid">
    ${field(t("yourName"), `<input name="name" value="${esc(p.name)}" autocomplete="name">`)}
    <div class="row-2">
      ${field(t("age"), `<input name="age" type="number" min="0" max="120" inputmode="numeric" value="${esc(p.age)}">`)}
      ${field(t("sex"), `<select name="sex"><option value=""></option>${options([["female", t("female")], ["male", t("male")], ["other", t("other")]], p.sex)}</select>`)}
    </div>
    ${field(t("conditions"), `<input name="conditions" value="${esc(p.conditions)}">`, t("conditionsHint"))}
    ${field(t("allergies"), `<input name="allergies" value="${esc(p.allergies)}">`)}
    <fieldset><legend>${esc(t("doseTimes"))}</legend><div class="row-3">
      ${SLOTS.map((slot) => field(t(slot), `<input type="time" name="slot-${slot}" value="${esc(s.slotTimes[slot])}" required>`)).join("")}
    </div></fieldset>
    <button class="btn">${esc(t("save"))}</button>
  </form>
  <section class="panel"><fieldset><legend>${esc(t("appearance"))}</legend>
    <div class="day-picks">${[["system", t("themeSystem")], ["light", t("themeLight")], ["dark", t("themeDark")]]
      .map(([v, label]) => `<label class="day-pick"><input type="radio" name="theme" value="${v}"${(s.theme || "system") === v ? " checked" : ""}>
        <span>${esc(label)}</span></label>`).join("")}</div></fieldset></section>
  ${reminderCard()}
  <section class="panel"><h2>${esc(t("yourData"))}</h2><p class="quiet">${esc(t("privacy"))}</p>
    <div class="btn-row">
      <button class="btn ghost" data-action="export">${icon("download")}${esc(t("exportData"))}</button>
      <label class="btn ghost">${icon("file")}${esc(t("importData"))}<input type="file" id="import-file" class="sr-only" accept="application/json,.json"></label>
      <button class="btn ghost danger-text" data-action="delete-all">${icon("trash")}${esc(t("deleteAll"))}</button>
    </div></section>`;
}

function render() {
  document.documentElement.lang = state.settings.lang;
  applyTheme();
  $(".skip").textContent = t("skip");
  $("#brand-name").textContent = t("brand");
  $("#lang").value = state.settings.lang;
  $(".sos").innerHTML = `${icon("phone", 18)}<span>${esc(t("sos"))}</span>`;
  $(".sos").setAttribute("aria-label", t("sos")); // label hidden on narrow screens
  const me = $(".me-link");
  me.innerHTML = icon("user");
  me.setAttribute("aria-label", t("navMe"));
  me.toggleAttribute("aria-current", view === "me");
  $("#tabs").innerHTML = NAV.map(([id, ic, label]) =>
    `<a href="#${id}"${id === view ? ' aria-current="page"' : ""}>${icon(ic, 22)}<span>${esc(t(label))}</span></a>`).join("");
  $("#main").innerHTML = VIEWS[view]();
  if (view === "ask") scrollChat();
}

// "system" follows the device; "light" or "dark" overrides it (styles.css reads data-theme).
function applyTheme() {
  const theme = state.settings.theme;
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

function route(focus = true) {
  if ($("#sheet").open && !sheetLocked) $("#sheet").close(); // back button leaves an open form
  const v = location.hash.slice(1);
  view = VIEWS[v] ? v : "today";
  render();
  if (focus) {
    $("#main").focus({ preventScroll: true });
    if (view !== "ask") window.scrollTo(0, 0);
  }
}

// ---------- sheets (forms in a modal dialog) ----------

let sheetSubmit = null;
let sheetLocked = false;

function openSheet(title, body, onSubmit, { submitLabel = t("save"), locked = false } = {}) {
  const d = $("#sheet");
  sheetSubmit = onSubmit;
  sheetLocked = locked;
  d.innerHTML = `<form class="sheet-form">
    <header class="sheet-head"><h2 id="sheet-title">${esc(title)}</h2>
      ${locked ? "" : `<button type="button" class="icon-btn" data-action="close-sheet" aria-label="${esc(t("close"))}">${icon("x")}</button>`}</header>
    <div class="sheet-body">${body}</div>
    <footer class="sheet-foot">
      ${locked ? "" : `<button type="button" class="btn ghost" data-action="close-sheet">${esc(t("cancel"))}</button>`}
      <button class="btn">${esc(submitLabel)}</button></footer>
  </form>`;
  if (!d.open) d.showModal();
  d.querySelector(".sheet-body :is(input, select, textarea)")?.focus();
}

function openMed(id) {
  const m = state.meds.find((x) => x.id === id) ?? {
    name: "", strength: "", pattern: [1, 0, 1], food: "after", start: todayKey(), end: "", stock: "", notes: "",
  };
  openSheet(id ? t("editMed") : t("addMed"), `
    ${field(t("medName"), `<input name="name" required value="${esc(m.name)}" autocomplete="off">`)}
    ${field(t("strength"), `<input name="strength" value="${esc(m.strength)}">`, t("strengthHint"))}
    <fieldset><legend>${esc(t("pattern"))}</legend><p class="hint">${esc(t("patternHint"))}</p>
      <div class="pattern-inputs">${SLOTS.map((s, i) => `<label><span>${esc(t(s))}</span>
        <input type="number" name="p${i}" min="0" max="10" step="0.5" inputmode="decimal" value="${esc(m.pattern[i])}" required></label>`)
        .join('<span class="dash" aria-hidden="true">-</span>')}</div></fieldset>
    ${field(t("food"), `<select name="food">${options(["before", "after", "with", "anytime"].map((f) => [f, t(f)]), m.food)}</select>`)}
    <fieldset><legend>${esc(t("days"))}</legend><p class="hint">${esc(t("daysHint"))}</p>
      <div class="day-picks">${[0, 1, 2, 3, 4, 5, 6].map((d) => `<label class="day-pick">
        <input type="checkbox" name="days" value="${d}"${!m.days?.length || m.days.includes(d) ? " checked" : ""}>
        <span>${esc(weekday(d))}</span></label>`).join("")}</div></fieldset>
    <div class="row-2">
      ${field(t("startDate"), `<input type="date" name="start" value="${esc(m.start)}" required>`)}
      ${field(t("endDate"), `<input type="date" name="end" value="${esc(m.end)}" min="${esc(m.start)}">`, t("endHint"))}
    </div>
    ${field(t("stock"), `<input type="number" name="stock" min="0" max="9999" inputmode="numeric" value="${esc(m.stock)}">`, t("stockHint"))}
    ${field(t("notes"), `<input name="notes" value="${esc(m.notes)}">`)}`,
  (fd) => {
    upsert(state.meds, {
      id: m.id ?? uid(),
      color: m.color ?? PILL_COLORS[state.meds.length % PILL_COLORS.length],
      name: fd.get("name").trim(),
      strength: fd.get("strength").trim(),
      pattern: [0, 1, 2].map((i) => Math.max(0, Number(fd.get(`p${i}`)) || 0)),
      food: fd.get("food"),
      days: ((d) => (d.length === 7 ? [] : d))(fd.getAll("days").map(Number)), // [] = every day
      start: fd.get("start"),
      end: fd.get("end"),
      stock: empty(fd.get("stock")) ? "" : Number(fd.get("stock")),
      notes: fd.get("notes").trim(),
    });
  });
}

const vitalFields = (type, v = {}) => {
  const num = (name, label, min, max, step = 1) =>
    field(label, `<input type="number" name="${name}" min="${min}" max="${max}" step="${step}" inputmode="decimal" value="${esc(v[name])}" required>`);
  const unit = VITALS[type].unit;
  switch (type) {
    case "bp":
      return `<div class="row-2">${num("sys", `${t("systolic")} (${unit})`, 50, 260)}${num("dia", `${t("diastolic")} (${unit})`, 30, 160)}</div>`;
    case "sugar":
      return num("value", `${t("value")} (${unit})`, 20, 600) +
        field(t("sugarWhen"), `<select name="context">${options(["fasting", "afterMeal", "random"].map((c) => [c, t(c)]), "fasting")}</select>`);
    case "weight": return num("value", `${t("value")} (${unit})`, 2, 300, 0.1);
    case "pulse": return num("value", `${t("value")} (${unit})`, 20, 250);
    case "spo2": return num("value", `${t("value")} (${unit})`, 50, 100);
    case "temp": return num("value", `${t("value")} (°F / °C)`, 30, 110, 0.1);
  }
};

function openVital(type = "bp") {
  const now = new Date();
  const local = new Date(now - now.getTimezoneOffset() * 6e4).toISOString().slice(0, 16);
  openSheet(t("logReading"), `
    ${field(t("type"), `<select name="type" data-action="vital-type">${options(Object.keys(VITALS).map((k) => [k, t(k)]), type)}</select>`)}
    <div class="vital-fields">${vitalFields(type)}</div>
    ${field(t("when"), `<input type="datetime-local" name="at" value="${local}" max="${local}" required>`)}`,
  (fd) => {
    const type = fd.get("type");
    const values = Object.fromEntries(VITALS[type].fields.map((f) => [f, Number(fd.get(f))]));
    if (type === "temp") values.value = toFahrenheit(values.value);
    const v = { id: uid(), type, values, context: fd.get("context") || "", at: new Date(fd.get("at")).toISOString() };
    state.vitals.push(v);
    const advice = adviceKey(v);
    if (advice) setTimeout(() => openEmergency(false, t(advice)));
  });
}

function openVisit(id) {
  const a = state.appts.find((x) => x.id === id) ?? { doctor: "", specialty: "", clinic: "", date: "", time: "10:00", notes: "" };
  openSheet(id ? t("edit") : t("addVisit"), `
    ${field(t("doctor"), `<input name="doctor" required value="${esc(a.doctor)}">`)}
    ${field(t("specialty"), `<input name="specialty" value="${esc(a.specialty)}">`)}
    ${field(t("clinic"), `<input name="clinic" value="${esc(a.clinic)}">`)}
    <div class="row-2">
      ${field(t("date"), `<input type="date" name="date" required value="${esc(a.date)}">`)}
      ${field(t("time"), `<input type="time" name="time" required value="${esc(a.time)}">`)}
    </div>
    ${field(t("visitNotes"), `<textarea name="notes" rows="3">${esc(a.notes)}</textarea>`)}`,
  (fd) => {
    upsert(state.appts, {
      id: a.id ?? uid(),
      ...Object.fromEntries(["doctor", "specialty", "clinic", "date", "time", "notes"].map((k) => [k, fd.get(k).trim()])),
    });
  });
}

function openWelcome() {
  const p = state.profile;
  openSheet(t("welcomeTitle"), `
    <p>${esc(t("welcomeBody"))}</p>
    ${field(t("language"), `<select name="lang" data-action="welcome-lang">${options([["en", "English"], ["kn", "ಕನ್ನಡ"], ["hi", "हिन्दी"]], state.settings.lang)}</select>`)}
    <div class="row-2">
      ${field(t("yourName"), `<input name="name" value="${esc(p.name)}" autocomplete="name">`)}
      ${field(t("age"), `<input name="age" type="number" min="0" max="120" inputmode="numeric" value="${esc(p.age)}">`)}
    </div>
    <p class="privacy">${esc(t("privacy"))}</p>`,
  (fd) => {
    state.profile.name = fd.get("name").trim();
    state.profile.age = fd.get("age");
    state.settings.consent = true;
  }, { submitLabel: t("agree"), locked: true });
}

function openEmergency(mental = true, message = "") {
  const d = $("#emergency");
  d.innerHTML = `<h2 id="em-title">${esc(t("emergencyTitle"))}</h2><p>${esc(message || t("emergencyBody"))}</p>
    ${callLinks(mental)}<button type="button" class="btn ghost" data-action="close-emergency">${esc(t("close"))}</button>`;
  if (!d.open) d.showModal();
}

function downloadIcs(a) {
  const stamp = (d) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const text = (s) => String(s || "").replace(/[\\,;]/g, (c) => `\\${c}`).replace(/\n/g, "\\n");
  const start = new Date(`${a.date}T${a.time}`);
  const alarm = (trigger) => ["BEGIN:VALARM", `TRIGGER:${trigger}`, "ACTION:DISPLAY", `DESCRIPTION:${text(a.doctor)}`, "END:VALARM"];
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Kshema//EN", "BEGIN:VEVENT",
    `UID:${a.id}@kshema`, `DTSTAMP:${stamp(new Date())}`, `DTSTART:${stamp(start)}`,
    `DTEND:${stamp(new Date(start.getTime() + 30 * 6e4))}`,
    `SUMMARY:${text(a.doctor + (a.specialty ? ` (${a.specialty})` : ""))}`,
    `LOCATION:${text(a.clinic)}`, `DESCRIPTION:${text(a.notes)}`,
    ...alarm("-P1D"), ...alarm("-PT1H"),
    "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  download(`visit-${a.date}.ics`, ics, "text/calendar");
}

// ---------- assistant ----------

// Everything the assistant should know, as plain text. Built fresh for each question.
function buildContext() {
  const key = todayKey();
  const p = state.profile;
  const lines = [`Today: ${key}`];
  const prof = [
    p.name && `Name: ${p.name}`, p.age && `Age: ${p.age}`, p.sex && `Sex: ${p.sex}`,
    p.conditions && `Conditions: ${p.conditions}`, p.allergies && `Allergies: ${p.allergies}`,
  ].filter(Boolean);
  if (prof.length) lines.push(`Profile: ${prof.join("; ")}`);

  const meds = state.meds.filter((m) => isOngoing(m, key)); // weekly medicines too, not only today's
  if (meds.length) {
    lines.push("Current medicines (dose pattern is morning-afternoon-night):");
    for (const m of meds) {
      const food = m.food === "anytime" ? "any time" : `${m.food} food`;
      const days = m.days?.length ? `, only on ${m.days.map((d) => ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"][d]).join("/")}` : "";
      lines.push(`- ${m.name} ${m.strength} ${m.pattern.join("-")}, ${food}${days}${m.notes ? `, note: ${m.notes}` : ""}`);
    }
    // Up to yesterday, so today's not-yet-due doses don't read as missed.
    const wk = adherence(state.meds, state.taken, addDays(key, -1), 7).reduce((a, d) => [a[0] + d.done, a[1] + d.due], [0, 0]);
    if (wk[1]) lines.push(`Doses marked taken in the 7 days before today: ${wk[0]} of ${wk[1]}`);
  }

  const readings = Object.keys(VITALS).flatMap((type) =>
    state.vitals.filter((v) => v.type === type).sort((a, b) => b.at.localeCompare(a.at)).slice(0, 3));
  if (readings.length) {
    lines.push("Recent readings:");
    for (const v of readings) {
      lines.push(`- ${STRINGS.en[v.type]}: ${formatVital(v)} ${VITALS[v.type].unit}${v.context ? ` (${STRINGS.en[v.context]})` : ""} on ${todayKey(new Date(v.at))} [${classifyVital(v)}]`);
    }
  }

  const up = upcomingAppts().slice(0, 3);
  if (up.length) {
    lines.push("Upcoming appointments:");
    for (const a of up) lines.push(`- ${a.doctor}${a.specialty ? ` (${a.specialty})` : ""} on ${a.date} ${a.time}${a.clinic ? ` at ${a.clinic}` : ""}`);
  }

  for (const r of state.reports.slice(0, 5)) {
    lines.push(`Report: ${r.title}${r.patient ? `, for ${r.patient}` : ""}${r.date ? `, ${r.date}` : ""}${r.lab ? `, ${r.lab}` : ""}`);
    for (const x of r.results) lines.push(`  - ${x.test}: ${x.value} ${x.unit} (ref ${x.range || "n/a"}) [${x.flag}]`);
    if (!r.results.length && r.summary) lines.push(`  Summary: ${r.summary}`);
  }
  return lines.join("\n");
}

const ERRORS = {
  missing_key: "errNoKey", busy: "errBusy", offline: "errOffline", refused: "errRefused", too_large: "fileTooBig",
  bad_file: "fileType", no_local_ai: "errNoLocalAi", no_model: "errNoModel", scanned_pdf: "errScannedPdf",
};
const errText = (code) => t(ERRORS[code] ?? (/fetch|network/i.test(code) ? "errOffline" : "errFailed"));

function scrollChat() {
  $("#chat-log")?.lastElementChild?.scrollIntoView({ block: "end" });
}

function renderChatLog() {
  const log = $("#chat-log");
  if (!log) return;
  log.innerHTML = state.chat.map(msgHtml).join("");
  log.setAttribute("aria-busy", busy);
  scrollChat();
}

let painting = false;
function paintReply(m) {
  if (painting) return;
  painting = true;
  requestAnimationFrame(() => {
    painting = false;
    const el = $("#chat-log .msg.bot:last-child .bubble");
    if (el) el.innerHTML = md(m.content);
    scrollChat();
  });
}

async function ask(text) {
  text = text.trim();
  if (busy || !text) return;
  busy = true;
  state.chat = state.chat.slice(-100); // keeps browser storage from filling up
  state.chat.push({ role: "user", content: text, at: Date.now() });
  const reply = { role: "assistant", content: "", at: Date.now(), pending: true };
  state.chat.push(reply);
  if (view === "ask") render();
  const history = state.chat
    .filter((m) => (m.role === "user" || m.role === "assistant") && m.content && !m.error)
    .map(({ role, content }) => ({ role, content }));

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: history.slice(-20), context: buildContext(), lang: state.settings.lang }),
    });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "failed");
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += value;
      let i;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6));
        if (ev.type === "text") {
          reply.content += ev.text;
          paintReply(reply);
        } else if (ev.type === "redflag") {
          state.chat.splice(state.chat.indexOf(reply), 0, { role: "flag", kinds: ev.kinds, at: Date.now() });
          renderChatLog();
          openEmergency(ev.kinds.includes("selfharm"));
        } else if (ev.type === "error") {
          throw new Error(ev.code);
        }
      }
    }
    if (!reply.content) throw new Error("failed");
  } catch (err) {
    reply.error = true;
    reply.content = errText(err.message);
  }
  reply.pending = false;
  busy = false;
  save();
  if (view === "ask") {
    render();
    $("#msg")?.focus();
  }
}

// Restore a file made by "Download my data". Rendering escapes every field, so a tampered
// file can't inject markup; it is checked only for the right shape.
async function restore(file) {
  if (!file) return;
  try {
    const data = JSON.parse(await file.text());
    const lists = ["meds", "vitals", "appts", "reports", "chat"];
    if (typeof data !== "object" || !data || lists.some((k) => k in data && !Array.isArray(data[k]))) throw new Error();
    if (!confirm(t("importConfirm"))) return;
    state = normalize(data);
    save();
    render();
    toast(t("importDone"));
  } catch {
    toast(t("importBad"));
  }
}

const toBase64 = (file) =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1]);
    r.onerror = () => reject(new Error("bad_file"));
    r.readAsDataURL(file);
  });

// Phone photos are often several MB. Claude rejects images over 5 MB, and both AIs read a
// ~2000 px image faster with no loss of legibility, so shrink before upload.
async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, 2000 / Math.max(bmp.width, bmp.height));
  if (scale === 1 && file.size < 4e6) return file;
  const canvas = Object.assign(document.createElement("canvas"), {
    width: Math.round(bmp.width * scale),
    height: Math.round(bmp.height * scale),
  });
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
}

async function attachReport(file) {
  if (!file || busy) return;
  if (!REPORT_TYPES.includes(file.type)) return toast(t("fileType"));
  const pdf = file.type === "application/pdf";
  if (file.size > (pdf ? 8 : 25) * 1024 * 1024) return toast(t("fileTooBig"));
  busy = true;
  const note = { role: "assistant", content: "", at: Date.now(), pending: true, status: t("readingReport") };
  state.chat.push(note);
  render();
  try {
    const upload = pdf ? file : await shrinkImage(file).catch(() => Promise.reject(new Error("bad_file")));
    const res = await fetch("/api/report", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: file.name, mediaType: upload.type, data: await toBase64(upload), lang: state.settings.lang }),
    });
    const json = await res.json().catch(() => ({ error: "failed" }));
    if (!res.ok) throw new Error(json.error);
    if (!json.is_report) {
      note.content = t("notAReport");
      note.error = true;
    } else {
      const rep = {
        id: uid(), file: file.name, addedAt: Date.now(), title: json.title || file.name,
        patient: json.patient, date: json.date, lab: json.lab, summary: json.summary,
        results: (json.results ?? []).map((x) => ({ ...x, flag: rangeFlag(x.value, x.range) ?? x.flag })),
      };
      state.reports.unshift(rep);
      const flagged = rep.results.filter((x) => FLAG_MARK[x.flag]);
      note.content = `**${t("reportAdded")}: ${rep.title}**${rep.date ? ` (${rep.date})` : ""}\n\n${rep.summary}` +
        (flagged.length ? `\n\n${flagged.map((x) => `- ${x.test}: ${x.value} ${x.unit} ${FLAG_MARK[x.flag]} (${x.range})`).join("\n")}` : "");
    }
  } catch (err) {
    note.content = errText(err.message);
    note.error = true;
  }
  note.pending = false;
  busy = false;
  save();
  if (view === "ask") render();
}

// ---------- reminders ----------

// shortcut: browser notifications only fire while a Kshema tab is open; the mobile app
// version should use native scheduled notifications. Calendar files (.ics) cover visits.
function checkReminders() {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  let fired = false;
  for (const r of dueReminders({ meds: state.meds, taken: state.taken, appts: state.appts, slotTimes: state.settings.slotTimes })) {
    if (state.notified[r.key]) continue;
    state.notified[r.key] = Date.now();
    fired = true;
    const [title, body] = r.kind === "dose"
      ? [t("remindDose", { name: r.med.name }), t("remindDoseBody", {
          slot: t(r.slot), dose: t("tablets", { n: fmtNum(r.med.pattern[SLOTS.indexOf(r.slot)]) }),
          food: r.med.food === "anytime" ? "" : t(r.med.food),
        })]
      : [t("remindVisit", { doctor: r.appt.doctor }), t("remindVisitBody", {
          when: r.lead === 1 ? t("inAnHour") : `${fmtDate(r.appt.date)} ${fmtTime(r.appt.time)}`,
          clinic: r.appt.clinic,
        })];
    new Notification(title, { body, icon: "icon.svg", tag: r.key });
  }
  if (fired) save();
}

// ---------- events ----------

function confirmThen(msg, fn) {
  if (confirm(msg)) {
    fn();
    save();
    render();
  }
}

document.addEventListener("click", async (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.tagName === "SELECT") return;
  const { action, id } = el.dataset;
  switch (action) {
    case "sos": return openEmergency(true);
    case "close-emergency": return $("#emergency").close();
    case "close-sheet": return $("#sheet").close();
    case "open-med": return openMed(id);
    case "open-vital": return openVital(el.dataset.type);
    case "open-visit": return openVisit(id);
    case "toggle-dose": {
      const key = todayKey();
      const slot = el.dataset.slot;
      const day = (state.taken[key] ||= {});
      const m = state.meds.find((x) => x.id === id);
      const n = Number(m.pattern[SLOTS.indexOf(slot)]);
      const k = `${id}:${slot}`;
      const tracked = !empty(m.stock);
      if (day[k]) {
        delete day[k];
        if (tracked) m.stock += n;
      } else {
        day[k] = Date.now();
        if (tracked) m.stock = Math.max(0, m.stock - n);
      }
      save();
      render();
      return $(`[data-action="toggle-dose"][data-id="${id}"][data-slot="${slot}"]`)?.focus();
    }
    case "del-med": return confirmThen(t("confirmDelete"), () => (state.meds = state.meds.filter((m) => m.id !== id)));
    case "del-vital": return confirmThen(t("confirmDelete"), () => (state.vitals = state.vitals.filter((v) => v.id !== id)));
    case "del-visit": return confirmThen(t("confirmDelete"), () => (state.appts = state.appts.filter((a) => a.id !== id)));
    case "del-report": return confirmThen(t("confirmDelete"), () => (state.reports = state.reports.filter((r) => r.id !== id)));
    case "ics": return downloadIcs(state.appts.find((a) => a.id === id));
    case "suggest": return ask(el.dataset.text);
    case "clear-chat": return confirmThen(t("confirmDelete"), () => (state.chat = []));
    case "enable-reminders":
      await Notification.requestPermission();
      checkReminders();
      return render();
    case "export":
      return download(`kshema-${todayKey()}.json`, JSON.stringify(state, null, 2), "application/json");
    case "delete-all":
      return confirmThen(t("deleteAllConfirm"), () => {
        const lang = state.settings.lang;
        localStorage.removeItem(KEY);
        state = blank();
        state.settings.lang = lang;
        setTimeout(openWelcome);
      });
  }
});

document.addEventListener("change", (e) => {
  const el = e.target;
  if (el.id === "lang") {
    state.settings.lang = el.value;
    save();
    render();
  } else if (el.dataset.action === "welcome-lang") {
    state.settings.lang = el.value;
    render();
    openWelcome();
    $('#sheet select[name="lang"]').focus();
  } else if (el.name === "days" && !el.form.querySelector('[name="days"]:checked')) {
    el.checked = true; // a medicine needs at least one day
  } else if (el.name === "start" && el.form?.end) {
    el.form.end.min = el.value; // last day can't be before the first
  } else if (el.dataset.action === "vital-type") {
    $("#sheet .vital-fields").innerHTML = vitalFields(el.value);
  } else if (el.name === "theme") {
    state.settings.theme = el.value;
    save();
    applyTheme();
  } else if (el.id === "import-file") {
    restore(el.files[0]);
  } else if (el.name === "sys" || el.name === "dia") {
    const f = el.form;
    f.dia.setCustomValidity(f.sys.value && f.dia.value && +f.sys.value <= +f.dia.value ? t("bpOrder") : "");
  } else if (el.id === "report-file") {
    attachReport(el.files[0]);
  }
});

document.addEventListener("submit", (e) => {
  const form = e.target;
  e.preventDefault();
  if (form.closest("#sheet")) {
    sheetSubmit(new FormData(form));
    $("#sheet").close();
    save();
    render();
    $("#main").focus({ preventScroll: true }); // the button that opened the form was re-rendered
  } else if (form.id === "composer") {
    const text = form.msg.value;
    form.msg.value = "";
    ask(text);
  } else if (form.id === "profile-form") {
    const fd = new FormData(form);
    for (const k of Object.keys(state.profile)) state.profile[k] = String(fd.get(k) ?? "").trim();
    for (const slot of SLOTS) state.settings.slotTimes[slot] = fd.get(`slot-${slot}`);
    save();
    render();
    toast(t("profileSaved"));
  }
});

// Enter sends, Shift+Enter adds a line.
document.addEventListener("keydown", (e) => {
  if (e.target.id === "msg" && e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    e.target.form.requestSubmit();
  }
});

$("#sheet").addEventListener("cancel", (e) => sheetLocked && e.preventDefault());
window.addEventListener("hashchange", () => route());

prune();
route(false);
fetch("/api/info")
  .then((r) => r.json())
  .then(({ provider }) => {
    aiProvider = provider;
    if (view === "ask") render();
  })
  .catch(() => {}); // notice is optional; the page works without it
if (!state.settings.consent) openWelcome();
setInterval(checkReminders, 30_000);
checkReminders();
