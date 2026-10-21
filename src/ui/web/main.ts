// Web 版の画面の入口。ロジックは ../../core/index.ts からだけ使う（~/git/knowledge/decisions の 902a）。
// `vite build --mode trial` で作ると、確かめ用のページになる（本物の記録には書かない。save-store.ts）。
import "./style.css";
import { startApp } from "./app.ts";
import { createBrowserEnv } from "./browser-env.ts";

startApp(document, createBrowserEnv(window, import.meta.env.MODE === "trial"));
