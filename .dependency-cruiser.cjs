// 依存の向きの検査（~/git/knowledge/decisions/2026-10-17-201005-902a-separate-logic-and-ui.md、798a）
// src/core: ロジック。UI にも外部の部品にも依存しない。
// src/ui/<UI の種類>: UI。ロジックは src/core/index.ts からだけ使う。ほかの UI には依存しない。
/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "core-depends-only-on-core",
      comment:
        "ロジック（src/core）は、src/core の中だけに依存する。UI、Node.js の組み込み、npm の部品は使わない（テストは除く）",
      severity: "error",
      from: { path: "^src/core/", pathNot: "\\.test\\.ts$" },
      to: { pathNot: "^src/core/" },
    },
    {
      name: "ui-uses-core-index-only",
      comment: "UI は、ロジックの公開する入口 src/core/index.ts だけを使う",
      severity: "error",
      from: { path: "^src/ui/" },
      to: { path: "^src/core/", pathNot: "^src/core/index\\.ts$" },
    },
    {
      name: "ui-independent-of-other-ui",
      comment: "UI どうしは依存しない（例: src/ui/web は src/ui/tui を使わない）",
      severity: "error",
      from: { path: "^src/ui/([^/]+)/" },
      to: { path: "^src/ui/", pathNot: "^src/ui/$1/" },
    },
    {
      name: "no-circular",
      comment: "循環する依存を作らない",
      severity: "error",
      from: {},
      to: { circular: true },
    },
    {
      name: "not-to-unresolvable",
      comment: "解決できない import を書かない",
      severity: "error",
      from: {},
      to: { couldNotResolve: true },
    },
  ],
  options: {
    doNotFollow: { path: "node_modules" },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: "tsconfig.json" },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
    },
  },
};
