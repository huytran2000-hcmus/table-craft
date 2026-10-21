import { createRoot } from "react-dom/client";
import { App } from "@table-craft/desktop/renderer/App.js";
import { applyAppearance } from "@table-craft/desktop/renderer/appearance/apply.js";
import { DEFAULT_APPEARANCE } from "@table-craft/desktop/renderer/appearance/tokens.js";
import "./app.css";

const container = document.getElementById("app");
if (container === null) throw new Error("index.html is missing the #app element.");

applyAppearance(DEFAULT_APPEARANCE);
// No StrictMode: its doubled effects would ask main for two engine ports.
createRoot(container).render(<App />);
