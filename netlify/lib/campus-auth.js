// netlify/lib/campus-auth.js
//
// Accounts and sign-in for Campus Sessions. The Studio has no user system of
// its own (the public app needs none), so this is small and self-contained:
//   • passwords hashed with scrypt + per-account salt (node:crypto)
//   • sign-in returns a signed token (HMAC-SHA256) the phone keeps; every
//     campus function verifies it and loads the account on the server
//   • roles: "worker" (runs sessions) and "admin" (manages workers, consent
//     text, settings, consent lookups)
//
// Environment:
//   CAMPUS_SESSION_SECRET  signs tokens (required when deployed)
//   CAMPUS_ADMIN_SECRET    one-time secret to create the first administrator
// Locally (no NETLIFY env) both fall back to development values so the flow
// can be tested without configuration.

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { docGet, docSet, docList, newId, now } from "./campus-store.js";

const DEPLOYED = Boolean(process.env.NETLIFY);
const TOKEN_DAYS = 30;

function secret() {
  const s = (process.env.CAMPUS_SESSION_SECRET || "").trim();
  if (s) return s;
  if (DEPLOYED) throw new Error("CAMPUS_SESSION_SECRET isn't set on the site.");
  return "dev-campus-secret";
}

export function adminSecretMatches(candidate) {
  const s = (process.env.CAMPUS_ADMIN_SECRET || "").trim();
  if (!s) return !DEPLOYED && candidate === "dev";
  const a = Buffer.from(String(candidate || ""));
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---- passwords ----
export function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(String(password), salt, 64).toString("hex");
  return { salt, hash };
}
export function checkPassword(password, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const hash = scryptSync(String(password), rec.salt, 64);
  const stored = Buffer.from(rec.hash, "hex");
  return hash.length === stored.length && timingSafeEqual(hash, stored);
}
export function passwordOk(password) {
  return typeof password === "string" && password.length >= 8;
}

// ---- tokens ----
const b64u = (buf) => Buffer.from(buf).toString("base64url");
export function signToken(payload) {
  const body = b64u(JSON.stringify({ ...payload, exp: Date.now() + TOKEN_DAYS * 86400000 }));
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  return `${body}.${sig}`;
}
export function verifyToken(token) {
  if (!token || typeof token !== "string" || !token.includes(".")) return null;
  const [body, sig] = token.split(".");
  const expect = createHmac("sha256", secret()).update(body).digest("base64url");
  const a = Buffer.from(sig || ""), b = Buffer.from(expect);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (!payload.exp || payload.exp < Date.now()) return null;
    return payload;
  } catch { return null; }
}

// ---- accounts ----
export const normEmail = (e) => String(e || "").trim().toLowerCase();

export async function findUserByEmail(email) {
  const idx = await docGet(`email:${normEmail(email)}`);
  return idx && idx.id ? docGet(`user:${idx.id}`) : null;
}

export async function createUser({ email, name, role = "worker", password }) {
  const em = normEmail(email);
  if (!em || !em.includes("@")) throw new Error("A valid email is required.");
  if (await findUserByEmail(em)) throw new Error("An account with that email already exists.");
  const id = newId("u_");
  const user = { id, email: em, name: String(name || "").trim() || em, role, active: true, pass: hashPassword(password), createdAt: now() };
  await docSet(`user:${id}`, user);
  await docSet(`email:${em}`, { id });
  return user;
}

export const publicUser = (u) => u && ({ id: u.id, email: u.email, name: u.name, role: u.role, active: u.active, createdAt: u.createdAt });

export async function listUsers() {
  return (await docList("user:")).map(publicUser).sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

// Reads the bearer token, verifies it, loads the account. Returns
// { user } or { error, status }. `roles` restricts which roles may pass.
export async function authFrom(req, roles = ["worker", "admin"]) {
  const h = (req.headers.get("authorization") || "").trim();
  const token = h.toLowerCase().startsWith("bearer ") ? h.slice(7).trim() : "";
  const payload = verifyToken(token);
  if (!payload) return { error: "Please sign in.", status: 401 };
  const user = await docGet(`user:${payload.uid}`);
  if (!user || !user.active) return { error: "This account is no longer active.", status: 401 };
  if (!roles.includes(user.role)) return { error: "You don't have access to that.", status: 403 };
  return { user };
}
