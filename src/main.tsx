import React from "react";
import ReactDOM from "react-dom/client";
// JetBrains Mono is loaded via FontFace API in LiveTerminal.tsx
// (CSS @font-face doesn't work in WKWebView Canvas2D)
import App from "./App";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
