import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import { App } from "./App.js";
import { I18nProvider } from "./i18n.js";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
    <StrictMode>
        <HashRouter>
            <I18nProvider>
                <App />
            </I18nProvider>
        </HashRouter>
    </StrictMode>,
);
