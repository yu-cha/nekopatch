import type { Plugin } from "vite";
import { defineConfig } from "vitest/config";

// ホーム画面に追加したときの名前とアイコン（Web App Manifest）。
// 確かめ用のページ（--mode trial）は、本物と見分けられる名前にする。
function webManifest(trial: boolean): Plugin {
  const name = trial ? "ねこパッチ（確かめ用）" : "ねこパッチ";
  return {
    name: "nekopatch-web-manifest",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "manifest.webmanifest",
        source: `${JSON.stringify(
          {
            name,
            short_name: name,
            start_url: "./",
            scope: "./",
            display: "standalone",
            background_color: "#e9edf1",
            icons: [
              { src: "icon-192.png", sizes: "192x192", type: "image/png" },
              { src: "icon-512.png", sizes: "512x512", type: "image/png" },
              { src: "icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
            ],
          },
          null,
          2,
        )}\n`,
      });
    },
  };
}

export default defineConfig(({ mode }) => ({
  // https://yu-cha.github.io/nekopatch/ と、確かめ用の …/nekopatch/preview/ の両方で動くよう、相対の場所で参照する
  base: "./",
  build: {
    // 古いブラウザ向けの先読みの補助は、インラインのスクリプトになり CSP で止まるので入れない
    modulePreload: { polyfill: false },
  },
  worker: { format: "es" },
  plugins: [webManifest(mode === "trial")],
  test: {
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
  },
}));
