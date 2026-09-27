import * as React from "react";
import * as ReactDOM from "react-dom";
import * as ReactDOMClient from "react-dom/client";
import * as JsxRuntime from "react/jsx-runtime";
import * as sdk from "@lifehub/sdk";
import { bind } from "./sdk/bind.ts";
import { App } from "./shell/App.tsx";

/*
 * platform.js — единственное место, где живут React и SDK. Модули и
 * библиотеки получают их отсюда через globalThis.__LIFEHUB__ (см. server/shared.ts),
 * поэтому сколько бы модулей ни было, React в памяти один.
 */
const sdkCache = new Map<string, unknown>();

(globalThis as any).__LIFEHUB__ = {
  shared: {
    react: React,
    "react-dom": ReactDOM,
    "react-dom/client": ReactDOMClient,
    "react/jsx-runtime": JsxRuntime,
    "react/jsx-dev-runtime": { ...JsxRuntime, jsxDEV: JsxRuntime.jsx },
  },
  sdkFor(id: string) {
    let s = sdkCache.get(id);
    if (!s) {
      s = { ...sdk, ...bind(id) };
      sdkCache.set(id, s);
    }
    return s;
  },
};

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}

ReactDOMClient.createRoot(document.getElementById("root")!).render(<App />);
