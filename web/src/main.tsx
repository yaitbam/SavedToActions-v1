import "./styles/index.css";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import { AlertProvider } from "./ui/AlertProvider";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <AlertProvider>
        <App />
      </AlertProvider>
    </BrowserRouter>
  </StrictMode>,
);
