// A button that opens the file picker and hands the chosen file to onFile
// (async). Used to attach a song or a finished music video made elsewhere —
// e.g. rendered on a phone — to the project on this computer.
import React, { useState } from "react";

export default function AttachFile({ label, accept, onFile, className = "btn btn-ghost btn-sm", title, busyLabel = "Attaching…" }) {
  const [busy, setBusy] = useState(false);
  return (
    <label className={className} style={{ cursor: busy ? "wait" : "pointer" }} title={title}>
      {busy ? busyLabel : label}
      <input
        type="file"
        accept={accept}
        style={{ display: "none" }}
        disabled={busy}
        onChange={async (e) => {
          const f = e.target.files && e.target.files[0];
          e.target.value = "";
          if (!f) return;
          setBusy(true);
          try { await onFile(f); } finally { setBusy(false); }
        }}
      />
    </label>
  );
}
