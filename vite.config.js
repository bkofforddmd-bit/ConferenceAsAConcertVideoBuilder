import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // During `netlify dev`, functions are served at /.netlify/functions.
    // Netlify dev handles the routing; this proxy is a fallback for plain `vite`.
    proxy: {
      "/.netlify/functions": {
        target: "http://localhost:8888",
        changeOrigin: true,
      },
    },
  },
});
