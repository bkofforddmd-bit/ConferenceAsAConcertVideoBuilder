import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.jsx";
import ErrorScreen from "./components/ErrorScreen.jsx";
import "./styles.css";
import "./studio.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ErrorScreen>
      <App />
    </ErrorScreen>
  </React.StrictMode>
);
