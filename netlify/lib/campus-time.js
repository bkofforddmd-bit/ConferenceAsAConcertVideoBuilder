// netlify/lib/campus-time.js
//
// Timekeeping math for Campus Sessions. Pay periods are calendar MONTHS in
// the campus time zone (America/Denver). Money is whole cents and time is
// whole minutes, so payroll adds up exactly.

export const TZ = "America/Denver";

const dtf = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
// "YYYY-MM-DD" and "HH:MM" in the campus zone for an ISO instant.
export function localParts(iso) {
  const parts = Object.fromEntries(dtf.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour === "24" ? "00" : parts.hour}:${parts.minute}` };
}
export const localDate = (iso) => localParts(iso).date;
export const monthOf = (iso) => localDate(iso).slice(0, 7); // "YYYY-MM"
export const todayLocal = () => localDate(new Date().toISOString());
export const thisMonth = () => todayLocal().slice(0, 7);

// Monday-based week key "YYYY-Www" for the local date of an instant.
export function weekOf(iso) {
  const d = localDate(iso);
  const [y, m, day] = d.split("-").map(Number);
  const t = Date.UTC(y, m - 1, day);
  const dow = (new Date(t).getUTCDay() + 6) % 7; // Mon=0
  const monday = new Date(t - dow * 86400000);
  return monday.toISOString().slice(0, 10); // the week's Monday date
}

export function minutesBetween(inIso, outIso) {
  const ms = Date.parse(outIso) - Date.parse(inIso);
  return Number.isFinite(ms) && ms > 0 ? Math.round(ms / 60000) : 0;
}

// The hourly rate (cents) in force on a given local date, from a list of
// { cents, effective: "YYYY-MM-DD" } entries; null when none applies yet.
export function rateOn(rates, date) {
  const list = (rates || []).filter((r) => r && Number.isInteger(r.cents) && r.effective && r.effective <= date).sort((a, b) => (a.effective < b.effective ? 1 : -1));
  return list.length ? list[0].cents : null;
}

// Gross pay in cents for `minutes` at `cents` per hour, rounded to the cent.
export const grossCents = (minutes, cents) => (Number.isInteger(cents) ? Math.round((minutes * cents) / 60) : 0);

export const fmtHours = (minutes) => `${Math.floor(minutes / 60)}:${String(minutes % 60).padStart(2, "0")}`;
export const fmtMoney = (cents) => `$${(cents / 100).toFixed(2)}`;
