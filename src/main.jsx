import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CampusApp from "./campus/CampusApp.jsx";
import SongPage from "./campus/SongPage.jsx";
import ErrorScreen from "./components/ErrorScreen.jsx";
import "./styles.css";
import "./studio.css";

// /campus and /campus/admin open Campus Sessions mode (worker + administrator
// screens); everything else is the public Studio.
const isCampus = /^\/campus(\/|$)/.test(window.location.pathname);
// /song/<code> is a student's public song page (from the QR code).
const songCode = (/^\/song\/([a-z2-9]{10})\/?$/.exec(window.location.pathname) || [])[1];

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorScreen>
      {songCode ? <SongPage code={songCode} /> : isCampus ? <CampusApp /> : <App />}
    </ErrorScreen>
  </React.StrictMode>
);
