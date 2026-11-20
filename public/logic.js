// Pure helpers shared by the page and the tests. No DOM access here.

export const SLOTS = ["morning", "afternoon", "night"];

export const VITALS = {
  bp: { unit: "mmHg", fields: ["sys", "dia"] },
  sugar: { unit: "mg/dL", fields: ["value"] },
  weight: { unit: "kg", fields: ["value"] },
  pulse: { unit: "bpm", fields: ["value"] },
  spo2: { unit: "%", fields: ["value"] },
  temp: { unit: "°F", fields: ["value"] },
};

const pad = (n) => String(n).padStart(2, "0");

export function todayKey(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function addDays(key, n) {
  const d = new Date(`${key}T00:00`);
  d.setDate(d.getDate() + n);
  return todayKey(d);
}

// Within the course dates, whatever the weekday.
export const isOngoing = (med, key) => (!med.start || med.start <= key) && (!med.end || med.end >= key);

// med.days lists weekdays (0 = Sunday) for medicines not taken daily, e.g. weekly vitamin D.
// Empty or missing means every day.
export function isActiveOn(med, key) {
  const onDay = !med.days?.length || med.days.includes(new Date(`${key}T00:00`).getDay());
  return onDay && isOngoing(med, key);
}

export const perDay = (med) => med.pattern.reduce((a, b) => a + Number(b || 0), 0);

// Days of tablets left at the prescribed pattern; null when stock isn't tracked.
export function stockDays(med) {
  const daily = (perDay(med) * (med.days?.length || 7)) / 7; // average use, so weekly doses last weeks
  if (med.stock === "" || med.stock == null || !daily) return null;
  return Math.max(0, Math.floor(Number(med.stock) / daily));
}

// One entry per day, oldest first: how many doses were due and how many were marked taken.
export function adherence(meds, taken, endKey, days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(endKey, -i);
    let due = 0;
    let done = 0;
    for (const m of meds) {
      if (!isActiveOn(m, key)) continue;
      SLOTS.forEach((slot, s) => {
        if (Number(m.pattern[s]) > 0) {
          due++;
          if (taken[key]?.[`${m.id}:${slot}`]) done++;
        }
      });
    }
    out.push({ key, due, done });
  }
  return out;
}

// low | ok | watch | high | urgent. Thresholds follow common adult reference ranges;
// they flag readings for attention, they do not diagnose.
export function classifyVital(v) {
  const x = Number(v.values.value);
  switch (v.type) {
    case "bp": {
      const sys = Number(v.values.sys);
      const dia = Number(v.values.dia);
      if (sys >= 180 || dia >= 120 || sys < 80) return "urgent";
      if (sys < 90 || dia < 60) return "low";
      if (sys >= 140 || dia >= 90) return "high";
      if (sys >= 130 || dia >= 80) return "watch";
      return "ok";
    }
    case "sugar": {
      if (x < 54 || x >= 400) return "urgent";
      if (x < 70) return "low";
      const fasting = v.context === "fasting";
      if (x >= (fasting ? 126 : 200)) return "high";
      if (x >= (fasting ? 100 : 140)) return "watch";
      return "ok";
    }
    case "pulse":
      if (x < 40 || x > 130) return "urgent";
      if (x < 50) return "low";
      if (x > 100) return "high";
      return "ok";
    case "spo2":
      if (x < 90) return "urgent";
      if (x < 95) return "low";
      return "ok";
    case "temp":
      if (x >= 104 || x < 95) return "urgent";
      if (x >= 102) return "high";
      if (x >= 100.4) return "watch";
      return "ok";
    default:
      return "ok";
  }
}

// Which first-aid message (an i18n key) a reading needs, or null. Low sugar gets advice even
// when not "urgent", because it gets worse within minutes.
export function adviceKey(v) {
  const lvl = classifyVital(v);
  const x = Number(v.values.value);
  if (v.type === "sugar" && (lvl === "low" || (lvl === "urgent" && x < 70))) return "adv_sugar_low";
  if (lvl !== "urgent") return null;
  if (v.type === "bp") return Number(v.values.sys) < 90 ? "adv_bp_low" : "adv_bp_high";
  if (v.type === "sugar") return "adv_sugar_high";
  if (v.type === "temp") return x < 95 ? "adv_temp_low" : "adv_temp_high";
  return `adv_${v.type}`; // pulse, spo2
}

// Indian thermometers show °F or °C. A body temperature under 50 can only be Celsius.
export const toFahrenheit = (x) => (x < 50 ? Math.round((x * 1.8 + 32) * 10) / 10 : x);

// Check a lab value against its printed range ("70 - 100", "< 200", "> 40"), so report flags
// don't rely on the AI's arithmetic. null when either can't be read as numbers.
export function rangeFlag(value, range) {
  const v = Number(String(value).trim());
  const r = String(range || "").replace(/[–—]/g, "-").toLowerCase().trim();
  if (!r || !Number.isFinite(v)) return null;
  const num = "(\\d+(?:\\.\\d+)?)";
  let m;
  if ((m = r.match(new RegExp(`^${num}\\s*(?:-|to)\\s*${num}$`)))) return v < +m[1] ? "low" : v > +m[2] ? "high" : "normal";
  if ((m = r.match(new RegExp(`^(?:<=?|≤|up ?to|less than|below)\\s*${num}$`)))) return v > +m[1] ? "high" : "normal";
  if ((m = r.match(new RegExp(`^(?:>=?|≥|more than|above|greater than)\\s*${num}$`)))) return v < +m[1] ? "low" : "normal";
  return null;
}

export function formatVital(v) {
  return v.type === "bp" ? `${v.values.sys}/${v.values.dia}` : String(v.values.value);
}

const HOUR = 3600e3;

// Reminders that should fire at `now`: doses up to 1 h after their slot time while not
// yet taken, and appointments 24 h and 1 h before they start.
export function dueReminders({ meds, taken, appts, slotTimes }, now = new Date()) {
  const key = todayKey(now);
  const out = [];
  for (const m of meds) {
    if (!isActiveOn(m, key)) continue;
    SLOTS.forEach((slot, s) => {
      if (!(Number(m.pattern[s]) > 0)) return;
      const at = new Date(`${key}T${slotTimes[slot]}`);
      const late = now - at;
      if (late >= 0 && late < HOUR && !taken[key]?.[`${m.id}:${slot}`]) {
        out.push({ key: `dose:${key}:${m.id}:${slot}`, kind: "dose", med: m, slot });
      }
    });
  }
  for (const a of appts) {
    const at = new Date(`${a.date}T${a.time}`);
    for (const lead of [24, 1]) {
      if (now >= at - lead * HOUR && now < at) {
        // Date and time in the key so an edited (rescheduled) visit reminds again.
        out.push({ key: `appt:${a.id}:${a.date}T${a.time}:${lead}`, kind: "appt", appt: a, lead });
        break; // only the nearest reminder
      }
    }
  }
  return out;
}
