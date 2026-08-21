import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import QuickCapture from "./QuickCapture";
import DigWidget from "./DigWidget";
import { LocaleProvider } from "./i18n";

const params = new URLSearchParams(window.location.search);
const isQuick = params.has("quick");
const isDig = params.has("dig");
if (isDig) document.documentElement.classList.add("dig-win");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <LocaleProvider>
      {isDig ? <DigWidget /> : isQuick ? <QuickCapture /> : <App />}
    </LocaleProvider>
  </React.StrictMode>
);
