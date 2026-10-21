import { describe, expect, it } from "vitest";
import {
  allTasksDone,
  findProblems,
  replacedRequirements,
  scenarioNames,
  testTitles,
  withoutRequirements,
} from "./check-scenarios.ts";

const spec = (path: string, ...names: string[]) => ({
  path,
  text: names.map((n) => `#### Scenario: ${n}\n- **WHEN** x\n- **THEN** y\n`).join("\n"),
});
const test = (title: string) => ({ path: "t.test.ts", text: `it("${title}", f)` });

describe("check-scenarios", () => {
  it("spec.md からシナリオ名を取り出す", () => {
    expect(
      scenarioNames("### Requirement: R\n\n#### Scenario: 例その一  \n\n#### Scenario: 例その二\n"),
    ).toEqual(["例その一", "例その二"]);
  });

  it("テストファイルから it と test の名前を取り出す", () => {
    const text = `it("検査用の名前1", () => {});\ntest('検査用の名前2', () => {});\nit(\`検査用の\\\`名前3\\\`\`, () => {});`;
    expect(testTitles(text)).toEqual(["検査用の名前1", "検査用の名前2", "検査用の`名前3`"]);
  });

  it("tasks.md のチェックボックスがすべて x なら完了とみなす", () => {
    expect(allTasksDone("## 1\n\n- [x] 1.1 a\n- [ X ] 1.2 b\n")).toBe(true);
    expect(allTasksDone("## 1\n\n- [x] 1.1 a\n- [ ] 1.2 b\n")).toBe(false);
    expect(allTasksDone("## 1\n\n- [~] 1.1 a\n")).toBe(false);
    expect(allTasksDone("チェックボックスが無い")).toBe(false);
  });

  it("すべてのシナリオにテストがあれば問題なし", () => {
    const groups = [{ name: "g", specs: [spec("a/spec.md", "検査用の名前X")], requireTests: true }];
    expect(findProblems(groups, [test("検査用の名前X")])).toEqual({ errors: [], warnings: [] });
  });

  it("テストが必須のまとまりでは、テストが無いシナリオを失敗として報告する", () => {
    const groups = [{ name: "g", specs: [spec("a/spec.md", "検査用の名前Y")], requireTests: true }];
    expect(findProblems(groups, [])).toEqual({
      errors: ["a/spec.md: シナリオ「検査用の名前Y」に対応するテストがありません"],
      warnings: [],
    });
  });

  it("作業中のまとまりでは、テストが無いシナリオを警告として報告する", () => {
    const groups = [
      { name: "g", specs: [spec("a/spec.md", "検査用の名前W")], requireTests: false },
    ];
    expect(findProblems(groups, [])).toEqual({
      errors: [],
      warnings: ["a/spec.md: シナリオ「検査用の名前W」に対応するテストがありません"],
    });
  });

  it("同じまとまりの中で重複したシナリオ名は、作業中でも失敗として報告する", () => {
    const groups = [
      {
        name: "g",
        specs: [spec("a/spec.md", "検査用の名前Z"), spec("b/spec.md", "検査用の名前Z")],
        requireTests: false,
      },
    ];
    expect(findProblems(groups, [test("検査用の名前Z")])).toEqual({
      errors: ["g: シナリオ「検査用の名前Z」が重複しています（a/spec.md と b/spec.md）"],
      warnings: [],
    });
  });

  it("変更提案の差分から、消す・置き換える要件の名前を取り出す", () => {
    const delta = [
      "## ADDED Requirements",
      "### Requirement: 足す",
      "## MODIFIED Requirements",
      "### Requirement: 置き換える ",
      "## REMOVED Requirements",
      "### Requirement: 消す",
    ].join("\n");
    expect(replacedRequirements(delta)).toEqual(["置き換える", "消す"]);
  });

  it("本体の仕様から、指定した要件の部分だけを除く", () => {
    const main = [
      "# s",
      "## Requirements",
      "### Requirement: 残す",
      "#### Scenario: 検査用の残る",
      "### Requirement: 消す",
      "#### Scenario: 検査用の消える",
      "## 別の節",
      "#### Scenario: 検査用の節の後",
    ].join("\n");
    expect(scenarioNames(withoutRequirements(main, new Set(["消す"])))).toEqual([
      "検査用の残る",
      "検査用の節の後",
    ]);
  });
});
