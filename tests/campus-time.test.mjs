// Timekeeping tests — run with:  node --test tests/campus-time.test.mjs
import { test, before } from "node:test";
import assert from "node:assert/strict";

process.env.CAMPUS_ADMIN_SECRET = "test-admin-secret";
process.env.CAMPUS_SESSION_SECRET = "test-session-secret";
delete process.env.NETLIFY;

const auth = (await import("../netlify/functions/campus-auth.js")).default;
const admin = (await import("../netlify/functions/campus-admin.js")).default;
const time = (await import("../netlify/functions/campus-time.js")).default;
const { docGet, docSet } = await import("../netlify/lib/campus-store.js");
const { rateOn, grossCents, minutesBetween, monthOf, weekOf, fmtHours } = await import("../netlify/lib/campus-time.js");

async function call(fn, body, token) {
  const headers = { "content-type": "application/json" };
  if (token) headers.authorization = `Bearer ${token}`;
  const res = await fn(new Request("http://x/", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, data: await res.json() };
}
let adminTok, w1, w2, w1Id;
before(async () => {
  const boot = await call(auth, { action: "bootstrap", secret: "test-admin-secret", email: "admin@x.com", name: "Admin", password: "password1" });
  adminTok = boot.data.token;
  for (const [email, name] of [["k@x.com", "Kaitlin Test"], ["o@x.com", "Other Worker"]]) {
    const inv = await call(admin, { action: "invite", email, name }, adminTok);
    const acc = await call(auth, { action: "accept-invite", code: inv.data.invite.code, password: "workerpass1" });
    if (email === "k@x.com") { w1 = acc.data.token; w1Id = acc.data.user.id; } else w2 = acc.data.token;
  }
});

test("math: rates by effective date, exact cents, monthly periods", () => {
  const rates = [{ cents: 1500, effective: "2026-09-01" }, { cents: 1650, effective: "2026-10-15" }];
  assert.equal(rateOn(rates, "2026-08-31"), null);
  assert.equal(rateOn(rates, "2026-10-14"), 1500);
  assert.equal(rateOn(rates, "2026-10-15"), 1650);
  assert.equal(grossCents(90, 1650), 2475);   // 1.5 h x $16.50
  assert.equal(grossCents(7, 1500), 175);     // 7 min x $15 = $1.75 exactly
  assert.equal(minutesBetween("2026-10-17T20:00:00Z", "2026-10-17T22:31:20Z"), 151);
  assert.equal(minutesBetween("2026-10-17T22:00:00Z", "2026-10-17T20:00:00Z"), 0);
  assert.equal(monthOf("2026-11-01T03:30:00Z"), "2026-10", "late evening Oct 31 in Utah belongs to October");
  assert.equal(weekOf("2026-10-18T12:00:00Z"), "2026-10-12");
  assert.equal(fmtHours(151), "2:31");
});

test("clock in and out with server timestamps; no double clock-in; stats are the worker's own", async () => {
  assert.equal((await call(time, { action: "status" })).status, 401);
  const s0 = await call(time, { action: "status" }, w1);
  assert.equal(s0.data.open, null);
  const inn = await call(time, { action: "clock-in", note: "Wilk lobby" }, w1);
  assert.equal(inn.status, 200);
  assert.equal(inn.data.shift.status, "open");
  assert.ok(Math.abs(Date.parse(inn.data.shift.in) - Date.now()) < 5000, "server time, not the phone's");
  assert.equal((await call(time, { action: "clock-in" }, w1)).status, 409, "one open shift at a time");
  assert.equal((await call(time, { action: "clock-out" }, w2)).status, 409, "the other worker isn't clocked in");
  const st = await call(time, { action: "status" }, w1);
  assert.ok(st.data.open && st.data.open.id === inn.data.shift.id);
  const out = await call(time, { action: "clock-out", note: "14 students" }, w1);
  assert.equal(out.data.shift.status, "closed");
  assert.equal(out.data.shift.approved, false);
  assert.match(out.data.shift.note, /Wilk lobby . 14 students/);
  assert.equal((await call(time, { action: "clock-out" }, w1)).status, 409);
  // a second shift the same day is fine
  await call(time, { action: "clock-in" }, w1);
  const out2 = await call(time, { action: "clock-out" }, w1);
  assert.equal(out2.status, 200);
  const list = await call(time, { action: "shifts" }, w1);
  assert.equal(list.data.shifts.length, 2);
  assert.equal((await call(time, { action: "shifts" }, w2)).data.shifts.length, 0, "workers see only their own shifts");
});

test("forgot to clock out: the end time can be set by hand, but never in the future or before the start", async () => {
  const inn = await call(time, { action: "clock-in" }, w1);
  const future = new Date(Date.now() + 3600000).toISOString();
  assert.equal((await call(time, { action: "clock-out", outAt: future }, w1)).status, 400);
  assert.equal((await call(time, { action: "clock-out", outAt: "2020-01-01T00:00:00Z" }, w1)).status, 400);
  // pretend the shift started 3 hours ago and they left after 2
  const sh = await docGet(`shift:${inn.data.shift.id}`);
  sh.in = new Date(Date.now() - 3 * 3600000).toISOString();
  await docSet(`shift:${sh.id}`, sh);
  const outAt = new Date(Date.now() - 3600000).toISOString();
  const out = await call(time, { action: "clock-out", outAt }, w1);
  assert.equal(out.status, 200);
  assert.equal(out.data.shift.minutes, 120);
  assert.equal(out.data.shift.endAdjusted, true);
  assert.match(out.data.shift.audit.at(-1).what, /by hand/);
});

test("corrections keep the original and the proposal, and only an administrator can decide them", async () => {
  const mine = (await call(time, { action: "shifts" }, w1)).data.shifts;
  const target = mine.find((s) => s.minutes === 120);
  const bad = await call(time, { action: "request-correction", shiftId: target.id, in: target.in, out: target.in, reason: "x" }, w1);
  assert.equal(bad.status, 400);
  const newOut = new Date(Date.parse(target.in) + 150 * 60000).toISOString();
  const req = await call(time, { action: "request-correction", shiftId: target.id, in: target.in, out: newOut, note: "Wilk + library", reason: "I actually left at the later time" }, w1);
  assert.equal(req.status, 200);
  assert.equal(req.data.correction.status, "pending");
  assert.equal(req.data.correction.original.out, target.out);
  assert.equal((await call(time, { action: "request-correction", shiftId: target.id, in: target.in, out: newOut, reason: "not mine" }, w2)).status, 404, "another worker can't touch it");
  assert.equal((await call(time, { action: "corrections" }, w1)).status, 403);
  assert.equal((await call(time, { action: "decide-correction", id: req.data.correction.id, approve: true }, w1)).status, 403, "workers can't approve their own corrections");
  const pend = await call(time, { action: "corrections" }, adminTok);
  assert.equal(pend.data.corrections.length, 1);
  assert.equal(pend.data.corrections[0].workerName, "Kaitlin Test");
  const dec = await call(time, { action: "decide-correction", id: req.data.correction.id, approve: true, note: "ok" }, adminTok);
  assert.equal(dec.data.shift.minutes, 150);
  assert.equal(dec.data.shift.corrected, true);
  assert.equal(dec.data.shift.note, "Wilk + library");
  const audit = dec.data.shift.audit.at(-1);
  assert.equal(audit.original.out, target.out);
  assert.equal(audit.proposed.out, newOut);
  assert.notEqual(audit.by, w1Id, "the approver is recorded");
  assert.equal((await call(time, { action: "corrections" }, adminTok)).data.corrections.length, 0);
});

test("rates, approval, monthly payroll, mark paid: admin only; exact money", async () => {
  for (const a of ["set-rate", "approve-shift", "approve-month", "mark-paid", "payroll", "rates", "all-shifts"]) assert.equal((await call(time, { action: a }, w1)).status, 403, a);
  assert.equal((await call(time, { action: "set-rate", workerId: w1Id, cents: -5 }, adminTok)).status, 400);
  const r = await call(time, { action: "set-rate", workerId: w1Id, cents: 1650, effective: "2020-01-01" }, adminTok);
  assert.equal(r.data.rate.rates[0].cents, 1650);
  assert.equal((await call(time, { action: "status" }, w1)).data.rate, 1650);
  const month = new Date().toISOString().slice(0, 7);
  let pay = await call(time, { action: "payroll", month }, adminTok);
  let row = pay.data.rows.find((x) => x.workerId === w1Id);
  assert.equal(row.approvedMinutes, 0, "nothing approved yet");
  assert.ok(row.allMinutes >= 150);
  assert.equal(row.grossCents, 0);
  const ap = await call(time, { action: "approve-month", workerId: w1Id, month, approved: true }, adminTok);
  assert.ok(ap.data.count >= 3);
  pay = await call(time, { action: "payroll", month }, adminTok);
  row = pay.data.rows.find((x) => x.workerId === w1Id);
  assert.equal(row.approvedMinutes, row.allMinutes);
  assert.equal(row.grossCents, Math.round((row.approvedMinutes * 1650) / 60));
  assert.equal(row.status, "open");
  const mine = (await call(time, { action: "shifts" }, w1)).data.shifts;
  const sum = await call(time, { action: "summary", month }, w1);
  assert.match(sum.data.text, /Kaitlin Test/);
  assert.equal(sum.data.totalMinutes, row.allMinutes);
  const paid = await call(time, { action: "mark-paid", month, workerId: w1Id, paid: true, note: "Venmo" }, adminTok);
  assert.equal(paid.data.payroll.status, "paid");
  pay = await call(time, { action: "payroll", month }, adminTok);
  assert.equal(pay.data.rows.find((x) => x.workerId === w1Id).status, "paid");
  const all = await call(time, { action: "all-shifts", month }, adminTok);
  assert.ok(all.data.shifts.every((s) => s.workerName));
  assert.ok(mine.every((s) => !("workerName" in s)));
});
