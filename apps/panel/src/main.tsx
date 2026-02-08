import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";
import "./index.css";
import "./i18n/index.js";
import { App } from "./App.js";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
