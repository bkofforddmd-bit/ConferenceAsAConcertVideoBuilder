[build]
  command = "npm run build"
  publish = "dist"
  functions = "netlify/functions"

[dev]
  command = "npm run dev"
  targetPort = 5173
  port = 8888

# SPA fallback so client-side routing works
[[redirects]]
  from = "/*"
  to = "/index.html"
  status = 200
