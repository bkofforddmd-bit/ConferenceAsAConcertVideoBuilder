// netlify/functions/image-status.js
import { getStore } from "@netlify/blobs";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let jobId = "";
  try {
    const body = await req.json();
    jobId = body.jobId || "";
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  if (!jobId) return json({ error: "Provide jobId." }, 400);

  try {
    const store = getStore("scene-images");
    const record = await store.get(jobId, { type: "json" });
    if (!record) return json({ status: "unknown" });
    return json(record);
  } catch (err) {
    return json({ error: "Status lookup failed", detail: String(err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
