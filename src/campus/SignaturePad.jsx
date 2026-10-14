// src/campus/SignaturePad.jsx — a finger-drawn signature box. Pointer events
// cover touch, pen and mouse; the result is a PNG data URL (or "" when empty).
import React, { useEffect, useRef, useState } from "react";

export default function SignaturePad({ value, onChange, height = 160 }) {
  const canvasRef = useRef(null);
  const drawing = useRef(false);
  const last = useRef(null);
  const [empty, setEmpty] = useState(!value);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    const ratio = window.devicePixelRatio || 1;
    const w = c.clientWidth || 320;
    c.width = Math.round(w * ratio);
    c.height = Math.round(height * ratio);
    const ctx = c.getContext("2d");
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = "#0b1a3a";
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, height);
    if (value) {
      const img = new Image();
      img.onload = () => ctx.drawImage(img, 0, 0, w, height);
      img.src = value;
    }
  }, [height]); // eslint-disable-line react-hooks/exhaustive-deps

  const pos = (e) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e) => {
    e.preventDefault();
    drawing.current = true;
    last.current = pos(e);
    canvasRef.current.setPointerCapture?.(e.pointerId);
  };
  const move = (e) => {
    if (!drawing.current) return;
    e.preventDefault();
    const p = pos(e);
    const ctx = canvasRef.current.getContext("2d");
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    last.current = p;
    if (empty) setEmpty(false);
  };
  const up = (e) => {
    if (!drawing.current) return;
    drawing.current = false;
    e.preventDefault();
    onChange && onChange(empty ? "" : canvasRef.current.toDataURL("image/png"));
  };
  const clear = () => {
    const c = canvasRef.current;
    const ctx = c.getContext("2d");
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.restore();
    setEmpty(true);
    onChange && onChange("");
  };

  return (
    <div className="sig-wrap">
      <canvas
        ref={canvasRef}
        className="sig-canvas"
        style={{ height, touchAction: "none" }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onPointerLeave={up}
      />
      <div className="sig-row">
        <span className="sig-hint">{empty ? "Sign here with your finger" : "Signed"}</span>
        <button type="button" className="btn btn-ghost btn-sm" onClick={clear}>Clear</button>
      </div>
    </div>
  );
}
