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
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null);

  useEffect(() => { setKeys(loadKeys()); }, []);

  async function checkGoogle() {
    saveKeys(keys);
    setChecking(true);
    setCheckResult(null);
    try {
      const resp = await fetch("/.netlify/functions/diag-google", { headers: keyHeaders() });
      setCheckResult(await resp.json());
    } catch (e) {
      setCheckResult({ error: String(e && e.message ? e.message : e) });
    } finally {
      setChecking(false);
    }
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
        <button className="btn btn-ghost" onClick={checkGoogle} disabled={checking} title="Sends one tiny request to Google with the active key and shows what Google answers">
          {checking && <span className="spinner" />}
          Check Google key
        </button>
      </div>
      {checkResult && (
        <div className="music-card" style={{ marginTop: 12 }}>
          <h3>Google key check</h3>
          <p className="note" style={{ marginTop: 0 }}>
            Active key: starts with <strong>{checkResult.keyPrefix}</strong>, {checkResult.keyLength} characters
            {checkResult.keyPrefix === "AQ." ? " (Google AI Studio auth key)" : checkResult.keyPrefix === "AIz" ? " (classic Google API key)" : " — this does not look like a Gemini API key"}.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, maxHeight: 320, overflow: "auto" }}>{JSON.stringify(checkResult, null, 2)}</pre>
          <p className="note">Copy this block to Claude if the song still fails — it contains no secrets.</p>
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
