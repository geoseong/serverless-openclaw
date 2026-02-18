import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import { loadConfig } from "./config";

// Load runtime config before rendering
loadConfig()
  .then(() => {
    createRoot(document.getElementById("root")!).render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  })
  .catch((error) => {
    console.error("Failed to load configuration:", error);
    document.getElementById("root")!.innerHTML = `
      <div style="padding: 20px; color: red;">
        <h1>Configuration Error</h1>
        <p>Failed to load application configuration. Please check the console for details.</p>
      </div>
    `;
  });
