// Safety net: if anything in the app throws while drawing, React would
// otherwise unmount everything and leave a blank page (the navy background
// and nothing else). This boundary shows what went wrong and a way back in.
import React from "react";

export default class ErrorScreen extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error) {
    return { error };
  }
  componentDidCatch(error, info) {
    try { console.error("Studio crashed:", error, info && info.componentStack); } catch {}
  }
  render() {
    if (!this.state.error) return this.props.children;
    const msg = String((this.state.error && this.state.error.message) || this.state.error || "Unknown error");
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24, color: "#eef2f8", fontFamily: "system-ui, sans-serif" }}>
        <div style={{ maxWidth: 520, background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.15)", borderRadius: 14, padding: 22 }}>
          <h2 style={{ margin: "0 0 8px", fontSize: 20 }}>The Studio hit a snag</h2>
          <p style={{ margin: "0 0 12px", opacity: 0.85, lineHeight: 1.45 }}>
            Something went wrong while drawing this page. Your project is saved — reload to pick up where you left off.
          </p>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, opacity: 0.7, background: "rgba(0,0,0,0.25)", padding: 10, borderRadius: 8, margin: "0 0 14px" }}>{msg}</pre>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <button onClick={() => window.location.reload()} style={{ padding: "10px 16px", borderRadius: 10, border: 0, background: "#2E5FA9", color: "#fff", fontWeight: 600, cursor: "pointer" }}>Reload the Studio</button>
            <button onClick={() => { try { sessionStorage.setItem("cac-open-library", "1"); } catch {} window.location.reload(); }} style={{ padding: "10px 16px", borderRadius: 10, border: "1px solid rgba(255,255,255,0.3)", background: "transparent", color: "#fff", cursor: "pointer" }}>Reload and open the Library</button>
          </div>
        </div>
      </div>
    );
  }
}
