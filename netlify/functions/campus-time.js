// netlify/functions/campus-time.js
//
// Timekeeping for Campus Sessions (Phase 2). Server timestamps throughout.
//
// Worker (own records only):
//   status                      -> { open, today, week, month, totalMinutes, interactions, rate }
//   clock-in  { note? }         -> { shift }   (refused while a shift is open)
//   clock-out { note?, outAt? } -> { shift }   (outAt = the real end time if they forgot; audit kept)
//   shifts    { month? }        -> { shifts, corrections }
//   request-correction { shiftId, in, out, note, reason } -> { correction }
//   summary   { month }         -> { lines, totalMinutes, text }  (for the mailto email)
// Administrator:
//   all-shifts { month, workerId? }, corrections, decide-correction { id, approve, note },
//   approve-shift { shiftId, approved }, approve-month { workerId, month, approved },
//   rates, set-rate { workerId, cents, effective }, payroll { month }, mark-paid { month, workerId, paid }
//
// Records: shift:<id>, correction:<id>, rate:<workerId>, payroll:<YYYY-MM>:<workerId>.

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, docList, newId, now } from "../lib/campus-store.js";
import { authFrom, listUsers } from "../lib/campus-auth.js";
import { localDate, monthOf, weekOf, todayLocal, thisMonth, minutesBetween, rateOn, grossCents, fmtHours, fmtMoney, localParts } from "../lib/campus-time.js";

const MAX_SHIFT_MIN = 16 * 60;

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  const a = await authFrom(req);
  if (a.error) return json({ error: a.error }, a.status);
  const user = a.user;
  const isAdmin = user.role === "admin";
  const save = async (s) => { s.updatedAt = now(); await docSet(`shift:${s.id}`, s); return s; };
  const myShifts = async (workerId) => (await docList("shift:")).filter((s) => s.workerId === workerId);
  const closeShift = (s, outIso) => { s.out = outIso; s.minutes = Math.min(MAX_SHIFT_MIN, minutesBetween(s.in, outIso)); s.status = "closed"; };

  try {
    // ---------------- worker ----------------
    if (action === "status") {
      const shifts = await myShifts(user.id);
      const open = shifts.find((s) => s.status === "open") || null;
      const nowIso = now();
      const today = todayLocal(), month = thisMonth(), week = weekOf(nowIso);
      const mins = (f) => shifts.filter((s) => s.status === "closed" && f(s)).reduce((t, s) => t + (s.minutes || 0), 0);
      const openMin = open ? minutesBetween(open.in, nowIso) : 0;
      const sessions = (await docList("session:")).filter((s) => s.workerId === user.id);
      const rates = (await docGet(`rate:${user.id}`)) || { rates: [] };
      return json({
        open: open ? { ...open, runningMinutes: openMin } : null,
        today: mins((s) => localDate(s.in) === today) + (open && localDate(open.in) === today ? openMin : 0),
        week: mins((s) => weekOf(s.in) === week) + (open && weekOf(open.in) === week ? openMin : 0),
        month: mins((s) => monthOf(s.in) === month) + (open && monthOf(open.in) === month ? openMin : 0),
        totalMinutes: mins(() => true) + openMin,
        interactions: { sessions: sessions.filter((s) => s.status === "completed").length, lyrics: sessions.filter((s) => s.lyrics && s.lyrics.generated).length, songs: sessions.filter((s) => s.song && s.song.generated).length },
        rate: rateOn(rates.rates, today),
        serverTime: nowIso,
      });
    }

    if (action === "clock-in") {
      const open = (await myShifts(user.id)).find((s) => s.status === "open");
      if (open) return json({ error: `You're already clocked in (since ${localParts(open.in).time}). Clock out first.`, shift: open }, 409);
      const s = { id: newId("sh_"), workerId: user.id, in: now(), out: null, minutes: null, note: String(body.note || "").slice(0, 300), status: "open", approved: false, createdAt: now(), audit: [{ at: now(), by: user.id, what: "clock-in" }] };
      return json({ shift: await save(s) });
    }

    if (action === "clock-out") {
      const open = (await myShifts(user.id)).find((s) => s.status === "open");
      if (!open) return json({ error: "You're not clocked in." }, 409);
      const nowIso = now();
      let outIso = nowIso;
      if (body.outAt) {
        const t = Date.parse(body.outAt);
        if (!Number.isFinite(t) || t <= Date.parse(open.in) || t > Date.parse(nowIso) + 60000) return json({ error: "The end time must be after the clock-in and not in the future." }, 400);
        outIso = new Date(t).toISOString();
      }
      if (body.note) open.note = [open.note, String(body.note).slice(0, 300)].filter(Boolean).join(" · ");
      closeShift(open, outIso);
      const adjusted = Math.abs(Date.parse(nowIso) - Date.parse(outIso)) > 5 * 60000;
      open.audit = [...(open.audit || []), { at: nowIso, by: user.id, what: adjusted ? "clock-out (end time set by hand)" : "clock-out", outAt: outIso }];
      if (adjusted) open.endAdjusted = true;
      return json({ shift: await save(open) });
    }

    if (action === "shifts") {
      const month = String(body.month || thisMonth());
      const shifts = (await myShifts(user.id)).filter((s) => monthOf(s.in) === month).sort((x, y) => (x.in < y.in ? 1 : -1));
      const corrections = (await docList("correction:")).filter((c) => c.workerId === user.id && shifts.some((s) => s.id === c.shiftId));
      return json({ month, shifts, corrections });
    }

    if (action === "request-correction") {
      const s = await docGet(`shift:${String(body.shiftId || "")}`);
      if (!s || s.workerId !== user.id) return json({ error: "No such shift." }, 404);
      if (s.status !== "closed") return json({ error: "Clock out first, then request a correction." }, 400);
      const inT = Date.parse(body.in), outT = Date.parse(body.out);
      if (!Number.isFinite(inT) || !Number.isFinite(outT) || outT <= inT) return json({ error: "Give a start and an end, with the end after the start." }, 400);
      if (outT > Date.now() + 60000) return json({ error: "The end can't be in the future." }, 400);
      if (minutesBetween(new Date(inT).toISOString(), new Date(outT).toISOString()) > MAX_SHIFT_MIN) return json({ error: "A shift can't be longer than 16 hours." }, 400);
      const reason = String(body.reason || "").trim().slice(0, 500);
      if (reason.length < 5) return json({ error: "Explain what needs correcting." }, 400);
      const c = { id: newId("cx_"), shiftId: s.id, workerId: user.id, original: { in: s.in, out: s.out, note: s.note || "" }, proposed: { in: new Date(inT).toISOString(), out: new Date(outT).toISOString(), note: String(body.note || s.note || "").slice(0, 300) }, reason, status: "pending", createdAt: now() };
      await docSet(`correction:${c.id}`, c);
      s.pendingCorrection = c.id;
      await save(s);
      return json({ correction: c });
    }

    if (action === "summary") {
      const month = String(body.month || thisMonth());
      const shifts = (await myShifts(user.id)).filter((s) => s.status === "closed" && monthOf(s.in) === month).sort((x, y) => (x.in < y.in ? -1 : 1));
      const total = shifts.reduce((t, s) => t + (s.minutes || 0), 0);
      const lines = shifts.map((s) => { const i = localParts(s.in), o = localParts(s.out); return `${i.date}  ${i.time}–${o.time}  ${fmtHours(s.minutes || 0)}${s.approved ? "  (approved)" : ""}${s.note ? `  ${s.note}` : ""}`; });
      const text = `Campus Sessions hours — ${user.name} — ${month}\n\n${lines.join("\n") || "(no shifts)"}\n\nTotal: ${fmtHours(total)} (${(total / 60).toFixed(2)} hours)`;
      return json({ month, lines, totalMinutes: total, text });
    }

    // ---------------- administrator ----------------
    if (!isAdmin) return json({ error: "You don't have access to that." }, 403);
    const users = await listUsers();
    const nameOf = (id) => (users.find((u) => u.id === id) || {}).name || id;

    if (action === "all-shifts") {
      const month = String(body.month || thisMonth());
      let shifts = (await docList("shift:")).filter((s) => monthOf(s.in) === month);
      if (body.workerId) shifts = shifts.filter((s) => s.workerId === body.workerId);
      return json({ month, shifts: shifts.map((s) => ({ ...s, workerName: nameOf(s.workerId) })).sort((x, y) => (x.in < y.in ? 1 : -1)) });
    }

    if (action === "corrections") {
      const list = (await docList("correction:")).filter((c) => c.status === "pending").map((c) => ({ ...c, workerName: nameOf(c.workerId) }));
      return json({ corrections: list });
    }

    if (action === "decide-correction") {
      const c = await docGet(`correction:${String(body.id || "")}`);
      if (!c || c.status !== "pending") return json({ error: "No pending correction with that id." }, 404);
      const s = await docGet(`shift:${c.shiftId}`);
      c.status = body.approve ? "approved" : "rejected";
      c.decidedBy = user.id; c.decidedAt = now(); c.decisionNote = String(body.note || "").slice(0, 300);
      await docSet(`correction:${c.id}`, c);
      if (s) {
        if (body.approve) {
          s.in = c.proposed.in; s.out = c.proposed.out; s.note = c.proposed.note;
          s.minutes = Math.min(MAX_SHIFT_MIN, minutesBetween(s.in, s.out));
          s.corrected = true;
        }
        delete s.pendingCorrection;
        s.audit = [...(s.audit || []), { at: now(), by: user.id, what: `correction ${c.status}`, correctionId: c.id, original: c.original, proposed: c.proposed }];
        await save(s);
      }
      return json({ correction: c, shift: s });
    }

    if (action === "approve-shift") {
      const s = await docGet(`shift:${String(body.shiftId || "")}`);
      if (!s) return json({ error: "No such shift." }, 404);
      if (s.status !== "closed") return json({ error: "That shift is still open." }, 400);
      s.approved = Boolean(body.approved); s.approvedBy = s.approved ? user.id : null; s.approvedAt = s.approved ? now() : null;
      return json({ shift: await save(s) });
    }

    if (action === "approve-month") {
      const month = String(body.month || thisMonth());
      const shifts = (await docList("shift:")).filter((s) => s.workerId === body.workerId && s.status === "closed" && monthOf(s.in) === month && !s.pendingCorrection);
      for (const s of shifts) { s.approved = Boolean(body.approved); s.approvedBy = s.approved ? user.id : null; s.approvedAt = s.approved ? now() : null; await save(s); }
      return json({ count: shifts.length });
    }

    if (action === "rates") {
      const out = {};
      for (const u of users) out[u.id] = (await docGet(`rate:${u.id}`)) || { workerId: u.id, rates: [] };
      return json({ rates: out, workers: users });
    }

    if (action === "set-rate") {
      const cents = Math.round(Number(body.cents));
      if (!Number.isInteger(cents) || cents < 0 || cents > 100000) return json({ error: "Enter an hourly rate in dollars, e.g. 15.50." }, 400);
      const effective = /^\d{4}-\d{2}-\d{2}$/.test(String(body.effective || "")) ? String(body.effective) : todayLocal();
      const rec = (await docGet(`rate:${String(body.workerId || "")}`)) || { workerId: String(body.workerId || ""), rates: [] };
      if (!users.some((u) => u.id === rec.workerId)) return json({ error: "No such worker." }, 404);
      rec.rates = [...rec.rates.filter((r) => r.effective !== effective), { cents, effective, setBy: user.id, setAt: now() }].sort((x, y) => (x.effective < y.effective ? -1 : 1));
      await docSet(`rate:${rec.workerId}`, rec);
      return json({ rate: rec });
    }

    if (action === "payroll") {
      const month = String(body.month || thisMonth());
      const shifts = (await docList("shift:")).filter((s) => s.status === "closed" && monthOf(s.in) === month);
      const rows = [];
      for (const u of users) {
        const mine = shifts.filter((s) => s.workerId === u.id);
        if (!mine.length && u.role !== "worker") continue;
        const rates = ((await docGet(`rate:${u.id}`)) || { rates: [] }).rates;
        let approvedMin = 0, allMin = 0, gross = 0, missingRate = false;
        for (const s of mine) {
          allMin += s.minutes || 0;
          if (!s.approved) continue;
          approvedMin += s.minutes || 0;
          const r = rateOn(rates, localDate(s.in));
          if (r == null) missingRate = true; else gross += grossCents(s.minutes || 0, r);
        }
        const pay = (await docGet(`payroll:${month}:${u.id}`)) || { status: "open" };
        rows.push({ workerId: u.id, name: u.name, email: u.email, shifts: mine.length, pending: mine.filter((s) => s.pendingCorrection).length, approvedMinutes: approvedMin, allMinutes: allMin, rateCents: rateOn(rates, `${month}-28`), grossCents: gross, missingRate, status: pay.status, paidAt: pay.paidAt || null, paidNote: pay.note || "" });
      }
      return json({ month, rows, generatedAt: now() });
    }

    if (action === "mark-paid") {
      const month = String(body.month || thisMonth());
      const key = `payroll:${month}:${String(body.workerId || "")}`;
      const cur = (await docGet(key)) || { month, workerId: String(body.workerId || "") };
      const next = body.paid ? { ...cur, status: "paid", paidAt: now(), paidBy: user.id, note: String(body.note || "").slice(0, 300) } : { ...cur, status: "open", paidAt: null, paidBy: null };
      await docSet(key, next);
      return json({ payroll: next });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};

export { fmtHours, fmtMoney };
