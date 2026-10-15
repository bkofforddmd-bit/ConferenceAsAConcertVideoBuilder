// netlify/lib/r2.js
//
// Cloudflare R2 for the Campus Sessions video clips, through presigned URLs
// (AWS Signature V4, query-string form) so the phone uploads straight to the
// bucket and players read straight from it — nothing streams through a
// function. Hand-rolled with node:crypto to avoid pulling the AWS SDK into
// the functions bundle.
//
// Environment (Netlify → Site configuration → Environment variables):
//   R2_ACCOUNT_ID         Cloudflare account id (R2 → Overview)
//   R2_ACCESS_KEY_ID      from an R2 API token with Object Read & Write on the bucket
//   R2_SECRET_ACCESS_KEY  same token
//   R2_CAMPUS_BUCKET      the PRIVATE bucket for campus clips (no public access)
//
// The bucket also needs a CORS rule allowing the Studio origin for GET and
// PUT with any headers (see README → Campus Sessions → Video clips).

import { createHmac, createHash } from "node:crypto";

export function r2Configured() {
  return Boolean(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_CAMPUS_BUCKET);
}

const enc = (s) => encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
const encKey = (key) => key.split("/").map(enc).join("/");
const sha256 = (s) => createHash("sha256").update(s).digest("hex");
const hmac = (k, s) => createHmac("sha256", k).update(s).digest();

// Presign a request for `key`. Returns the full URL.
//   method: "GET" | "PUT" | "DELETE"; expiresSec ≤ 7 days; contentType only matters for PUT.
export function presign({ method = "GET", key, expiresSec = 3600, contentType = "" }) {
  const accountId = process.env.R2_ACCOUNT_ID, accessKey = process.env.R2_ACCESS_KEY_ID, secret = process.env.R2_SECRET_ACCESS_KEY, bucket = process.env.R2_CAMPUS_BUCKET;
  if (!accountId || !accessKey || !secret || !bucket) throw new Error("R2 isn't configured on the site (R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_CAMPUS_BUCKET).");
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const region = "auto", service = "s3";
  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z"); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${region}/${service}/aws4_request`;
  const canonicalUri = `/${bucket}/${encKey(key)}`;
  const signedHeaders = contentType && method === "PUT" ? "content-type;host" : "host";
  const params = {
    "X-Amz-Algorithm": "AWS4-HMAC-SHA256",
    "X-Amz-Credential": `${accessKey}/${scope}`,
    "X-Amz-Date": amzDate,
    "X-Amz-Expires": String(Math.max(1, Math.min(604800, Math.floor(expiresSec)))),
    "X-Amz-SignedHeaders": signedHeaders,
  };
  const canonicalQuery = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  const canonicalHeaders = (contentType && method === "PUT" ? `content-type:${contentType.trim()}\n` : "") + `host:${host}\n`;
  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, "UNSIGNED-PAYLOAD"].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const kDate = hmac(`AWS4${secret}`, dateStamp);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  const kSigning = hmac(kService, "aws4_request");
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");
  return `https://${host}${canonicalUri}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

// Server-side delete (used when a worker removes a clip or a session is purged).
export async function deleteObject(key) {
  const url = presign({ method: "DELETE", key, expiresSec: 120 });
  const res = await fetch(url, { method: "DELETE" });
  if (!res.ok && res.status !== 404) throw new Error(`R2 delete failed (${res.status})`);
}
