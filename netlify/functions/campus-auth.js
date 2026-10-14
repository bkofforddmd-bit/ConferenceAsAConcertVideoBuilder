// netlify/functions/campus-auth.js
//
// Sign-in for Campus Sessions.
//   POST { action: "status" }                                   -> { hasUsers }
//   POST { action: "bootstrap", secret, email, name, password } -> first admin (needs CAMPUS_ADMIN_SECRET)
//   POST { action: "login", email, password }                   -> { token, user }
//   POST { action: "accept-invite", code, password }            -> { token, user }
//   POST { action: "invite-info", code }                        -> { email, name, role } (to prefill the form)
//   POST { action: "me" }  (Bearer token)                       -> { user }
//   POST { action: "change-password", current, next } (Bearer)  -> { ok }

import { json, readJson } from "../lib/keys.js";
import { docGet, docSet, docList, now } from "../lib/campus-store.js";
import { adminSecretMatches, createUser, findUserByEmail, checkPassword, hashPassword, passwordOk, signToken, publicUser, authFrom } from "../lib/campus-auth.js";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const body = (await readJson(req)) || {};
  const action = String(body.action || "");
  try {
    if (action === "status") {
      const users = await docList("user:");
      return json({ hasUsers: users.length > 0 });
    }

    if (action === "bootstrap") {
      if (!adminSecretMatches(body.secret)) return json({ error: "That setup secret isn't right." }, 403);
      if (!passwordOk(body.password)) return json({ error: "Use a password of at least 8 characters." }, 400);
      let user = await findUserByEmail(body.email);
      if (user) {
        user = { ...user, role: "admin", active: true, pass: hashPassword(body.password), name: String(body.name || user.name).trim() || user.name };
        await docSet(`user:${user.id}`, user);
      } else {
        user = await createUser({ email: body.email, name: body.name, role: "admin", password: body.password });
      }
      return json({ token: signToken({ uid: user.id }), user: publicUser(user) });
    }

    if (action === "login") {
      const user = await findUserByEmail(body.email);
      if (!user || !checkPassword(body.password, user.pass)) return json({ error: "Email or password isn't right." }, 401);
      if (!user.active) return json({ error: "This account has been deactivated." }, 403);
      return json({ token: signToken({ uid: user.id }), user: publicUser(user) });
    }

    if (action === "invite-info") {
      const inv = await docGet(`invite:${String(body.code || "")}`);
      if (!inv || inv.usedAt) return json({ error: "That invitation isn't valid any more." }, 404);
      return json({ email: inv.email, name: inv.name, role: inv.role });
    }

    if (action === "accept-invite") {
      const code = String(body.code || "");
      const inv = await docGet(`invite:${code}`);
      if (!inv || inv.usedAt) return json({ error: "That invitation isn't valid any more." }, 404);
      if (!passwordOk(body.password)) return json({ error: "Use a password of at least 8 characters." }, 400);
      let user = await findUserByEmail(inv.email);
      if (user) {
        user = { ...user, active: true, role: inv.role || user.role, pass: hashPassword(body.password) };
        await docSet(`user:${user.id}`, user);
      } else {
        user = await createUser({ email: inv.email, name: inv.name, role: inv.role || "worker", password: body.password });
      }
      await docSet(`invite:${code}`, { ...inv, usedAt: now(), userId: user.id });
      return json({ token: signToken({ uid: user.id }), user: publicUser(user) });
    }

    if (action === "me") {
      const a = await authFrom(req);
      if (a.error) return json({ error: a.error }, a.status);
      return json({ user: publicUser(a.user) });
    }

    if (action === "change-password") {
      const a = await authFrom(req);
      if (a.error) return json({ error: a.error }, a.status);
      if (!checkPassword(body.current, a.user.pass)) return json({ error: "The current password isn't right." }, 401);
      if (!passwordOk(body.next)) return json({ error: "Use a password of at least 8 characters." }, 400);
      await docSet(`user:${a.user.id}`, { ...a.user, pass: hashPassword(body.next) });
      return json({ ok: true });
    }

    return json({ error: `Unknown action "${action}"` }, 400);
  } catch (e) {
    return json({ error: e.message || String(e) }, 500);
  }
};
