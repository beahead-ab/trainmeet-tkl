import React from "react";
import ReactDOM from "react-dom/client";
import "@fontsource/inter/latin-400.css";
import "@fontsource/inter/latin-500.css";
import "@fontsource/inter/latin-600.css";
import "@fontsource/inter/latin-700.css";
import "./styles.css";
import App from "./App";
import { LanguagePicker, useLanguage } from './i18n';

function LocalizedApp() {
  useLanguage();
  return <><div className="language-toolbar"><LanguagePicker /></div><App /></>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <LocalizedApp />
  </React.StrictMode>,
);
