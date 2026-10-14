import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import CampusApp from "./campus/CampusApp.jsx";
import ErrorScreen from "./components/ErrorScreen.jsx";
import "./styles.css";
import "./studio.css";

// /campus and /campus/admin open Campus Sessions mode (worker + administrator
// screens); everything else is the public Studio.
const isCampus = /^\/campus(\/|$)/.test(window.location.pathname);

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorScreen>
      {isCampus ? <CampusApp /> : <App />}
    </ErrorScreen>
  </React.StrictMode>
);
