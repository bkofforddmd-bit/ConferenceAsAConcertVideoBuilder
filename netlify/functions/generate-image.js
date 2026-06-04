// netlify/functions/generate-image.js
const GEN_URL = "https://api.openai.com/v1/images/generations";
const EDIT_URL = "https://api.openai.com/v1/images/edits";
const MODEL = "gpt-image-2";

export default async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return json({ error: "Server missing OPENAI_API_KEY" }, 500);

  let body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const { prompt = "", size = "1536x1024", referenceImageB64 = "" } = body;
  if (!prompt.trim()) return json({ error: "Provide a prompt." }, 400);

  try {
    let resp;
    if (referenceImageB64) {
      const form = new FormData();
      form.append("model", MODEL);
      form.append("prompt", prompt);
      form.append("size", size);
      const b64 = referenceImageB64.includes(",")
        ? referenceImageB64.split(",")[1]
        : referenceImageB64;
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      form.append("image", new Blob([bytes], { type: "image/png" }), "reference.png");
      resp = await fetch(EDIT_URL, {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}` },
        body: form,
      });
    } else {
      resp = await fetch(GEN_URL, {
        method: "POST",
        headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model: MODEL, prompt, size }),
      });
    }

    if (!resp.ok) {
      const detail = await resp.text();
      return json({ error: "OpenAI image API error", detail }, resp.status);
    }
    const data = await resp.json();
    const b64 = data?.data?.[0]?.b64_json;
    if (!b64) return json({ error: "No image returned", data }, 502);
    return json({ imageDataUrl: `data:image/png;base64,${b64}` });
  } catch (err) {
    return json({ error: "Request failed", detail: String(err) }, 500);
  }
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}
