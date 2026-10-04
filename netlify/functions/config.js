// netlify/functions/config.js
//
// Tells the app which AI services already have a key configured on the
// server, so the Settings panel can show "✓ configured by the site" versus
// "add your own key". Booleans only — keys never leave the server.

import { json, serverKeyPresence, serviceLabels } from "../lib/keys.js";

export default async () => {
  return json({
    serverKeys: serverKeyPresence(),
    labels: serviceLabels(),
    providers: {
      music: [
        { id: "lyria", name: "Google Lyria 3.5", needs: "gemini", note: "Official Google music model. Sings your lyrics. About $0.08 per song." },
        { id: "minimax", name: "MiniMax Music (via fal.ai)", needs: "fal", note: "Budget fallback. About $0.03 per song." },
      ],
      video: [
        { id: "veo", name: "Google Veo (via Gemini)", needs: "gemini", note: "Image-to-video, 8-second clips with motion from each scene image." },
        { id: "fal-kling", name: "Kling (via fal.ai)", needs: "fal", note: "Image-to-video fallback, 5-second clips." },
      ],
    },
  });
};
