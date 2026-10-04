// src/components/SettingsPanel.jsx
//
// "API keys" settings: which AI services the site already has keys for, and
// a place to paste personal keys (stored only in this browser). Keys are sent
// to the app's own Netlify functions as headers — never to any other site.

import React, { useEffect, useState } from "react";
import { SERVICES, loadKeys, saveKeys, keyHeaders } from "../lib/keys.js";

export default function SettingsPanel({ config, onClose }) {
  const [keys, setKeys] = useState(loadKeys);
  const [reveal, setReveal] = useState({});
  const [savedMsg, setSavedMsg] = useState("");

  useEffect(() => { setKeys(loadKeys()); }, []);

  const [connChecking, setConnChecking] = useState(false);
  const [connResult, setConnResult] = useState(null);

  // Probes the app's own functions with different methods/sizes/paths so a
  // "Failed to fetch" can be pinned to a cause (network filter, size limit…).
  async function checkConnection() {
    setConnChecking(true);
    setConnResult(null);
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";
    const id = "img_chk_" + Date.now().toString(36);
    const tests = [
      ["GET config", () => fetch("/.netlify/functions/config")],
      ["GET art-status", () => fetch(`/.netlify/functions/art-status?id=${id}`)],
      ["POST art-ref (tiny image)", () => fetch("/.netlify/functions/art-ref", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: id, dataUrl: png }) })],
      ["POST art-job-background (no prompt)", () => fetch("/.netlify/functions/art-job-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: id, prompt: "" }) })],
      ["POST art-job-background (long prompt, 20 KB)", () => fetch("/.netlify/functions/art-job-background", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: id + "b", prompt: "", pad: "x".repeat(20000) }) })],
      ["POST art-sync (empty)", () => fetch("/.netlify/functions/art-sync", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ prompt: "" }) })],
      ["POST generate-scene-detail (empty)", () => fetch("/.netlify/functions/generate-scene-detail", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) })],
      ["POST art-ref (300 KB image)", () => fetch("/.netlify/functions/art-ref", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jobId: id + "c", dataUrl: "data:image/jpeg;base64," + "A".repeat(300 * 1024) }) })],
      ["POST with x-user key headers", () => fetch("/.netlify/functions/art-status?id=" + id, { method: "GET", headers: keyHeaders() })],
      ["POST art-job-background (realistic scene prompt, no key)", () => fetch("/.netlify/functions/art-job-background", { method: "POST", headers: { "content-type": "application/json", "x-user-openai-key": "" }, body: JSON.stringify({ jobId: id + "d", size: "1536x1024", refKey: "", prompt: "A cinematic, reverent painterly illustration of a weathered man in flannel on a dirt path at golden hour, soft diffused sunlight, amber and sage palette, open hands releasing stones, warm hearth light in a farmhouse window. Render the following text cleanly, spelled exactly: \"Slow to Anger\". A small disclaimer band across the bottom reading: This music and video presentation is not an official production of The Church of Jesus Christ of Latter-day Saints." }) })],
    ];
    // Capture what a non-2xx answer actually contains (a filter's block page shows up here).
    const describe = async (r) => {
      const ct = r.headers.get("content-type") || "";
      let snippet = "";
      if (r.status >= 300) { try { snippet = (await r.text()).replace(/\s+/g, " ").slice(0, 100); } catch {} }
      return { status: r.status, type: ct.split(";")[0], snippet };
    };
    const out = { when: new Date().toISOString(), browser: navigator.userAgent, online: navigator.onLine, results: [] };
    for (const [name, run] of tests) {
      const t0 = Date.now();
      try {
        const r = await run();
        const d = await describe(r);
        out.results.push({ test: name, status: d.status, type: d.type, snippet: d.snippet, ms: Date.now() - t0 });
      } catch (e) {
        out.results.push({ test: name, error: String(e && e.message ? e.message : e), ms: Date.now() - t0 });
      }
    }
    setConnResult(out);
    setConnChecking(false);
  }

  function save() {
    saveKeys(keys);
    setSavedMsg("Saved in this browser.");
    setTimeout(() => setSavedMsg(""), 2500);
  }

  const serverKeys = (config && config.serverKeys) || {};

  return (
    <section className="panel settings-panel">
      <div className="panel-head">
        <h2>Settings · API keys</h2>
        <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
      </div>
      <p className="sub">
        Music and video generation call paid AI services. Each service needs a key — either one the
        site owner set on Netlify (shown as <span className="chip ok">configured</span>) or one you paste
        here. Keys you paste stay in this browser only and are sent solely to this app's own functions.
      </p>

      <div className="settings-grid">
        {SERVICES.map((s) => {
          const onServer = Boolean(serverKeys[s.id]);
          const mine = keys[s.id] || "";
          return (
            <div className="settings-row" key={s.id}>
              <div className="settings-label">
                <strong>{s.label}</strong>
                <span className="note" style={{ margin: "2px 0 0" }}>{s.hint}</span>
                <span style={{ marginTop: 6 }}>
                  {onServer ? <span className="chip ok">configured on the site</span> : <span className="chip">no site key</span>}
                  {mine ? <span className="chip ok" style={{ marginLeft: 6 }}>your key saved</span> : null}
                </span>
              </div>
              <div className="settings-input">
                <input
                  type={reveal[s.id] ? "text" : "password"}
                  placeholder={onServer ? "Optional — overrides the site key" : "Paste your key"}
                  value={mine}
                  autoComplete="off"
                  spellCheck={false}
                  onChange={(e) => setKeys((k) => ({ ...k, [s.id]: e.target.value }))}
                />
                <button className="btn btn-ghost btn-sm" onClick={() => setReveal((r) => ({ ...r, [s.id]: !r[s.id] }))}>
                  {reveal[s.id] ? "Hide" : "Show"}
                </button>
                {mine && (
                  <button className="btn btn-ghost btn-sm" onClick={() => setKeys((k) => ({ ...k, [s.id]: "" }))}>
                    Clear
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn btn-primary" onClick={save}>Save keys</button>
        {savedMsg && <span className="note" style={{ margin: 0, color: "var(--success)" }}>{savedMsg}</span>}
        <button className="btn btn-ghost" onClick={checkConnection} disabled={connChecking} title="Tests several kinds of requests to this app's own server to find what a network or security filter is blocking">
          {connChecking && <span className="spinner" />}
          Check connection
        </button>
      </div>
      {connResult && (
        <div className="music-card" style={{ marginTop: 12 }}>
          <h3>Connection check</h3>
          <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
            <tbody>
              {connResult.results.map((r) => (
                <tr key={r.test} style={{ borderTop: "1px solid var(--line)" }}>
                  <td style={{ padding: "6px 4px" }}>{r.test}</td>
                  <td style={{ padding: "6px 4px", color: r.error ? "var(--danger)" : "var(--success)" }}>{r.error ? `✗ ${r.error}` : `✓ ${r.status}${r.type ? ` ${r.type}` : ""}${r.snippet ? ` — ${r.snippet}` : ""}`}</td>
                  <td style={{ padding: "6px 4px", color: "var(--silver)", whiteSpace: "nowrap" }}>{r.ms} ms</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="note">Any 4xx status is fine here — it means the request reached the server. "Failed to fetch" means it never arrived. Copy this to Claude.</p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 11, color: "var(--silver)" }}>{connResult.browser}</pre>
        </div>
      )}

      <div className="settings-costs">
        <h3>What things cost (approximate, billed by each provider)</h3>
        <ul>
          <li><strong>Lyrics, scenes, insights</strong> — Anthropic Claude: a few cents per step.</li>
          <li><strong>Scene images</strong> — OpenAI gpt-image-2: roughly $0.05–0.20 per image.</li>
          <li><strong>Song</strong> — Google Lyria 3.5: about $0.08 per full song. MiniMax (fal.ai): about $0.03.</li>
          <li><strong>Video clips</strong> — Kling 3.0 (fal.ai): about $0.56 per 5-second 1080p clip. Google Veo 3.1 Fast: about $0.96 per 8-second clip.</li>
          <li><strong>Final music video</strong> — rendered in your browser, free.</li>
        </ul>
        <p className="note">
          Site owner: set GEMINI_API_KEY, FAL_KEY, OPENAI_API_KEY and ANTHROPIC_API_KEY under
          Netlify → Site settings → Environment variables so nobody has to paste keys.
        </p>
      </div>
    </section>
  );
}
