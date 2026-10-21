// OpenSpec の各シナリオに、名前が完全に一致する自動テストがあるかを確かめる。
// 対象: openspec/specs/ と、アーカイブ前の openspec/changes/<変更名>/specs/ にある spec.md。
// テスト: src/ と scripts/ の *.test.ts にある `it("...")` と `test("...")`。
// 作業中の変更提案（tasks.md に未完了の項目がある）では、テストが無いことを警告にとどめる。
// 本体の仕様と、tasks.md がすべて完了した変更提案では、テストが無ければ失敗にする。
// アーカイブ前の変更提案が消す（REMOVED）・置き換える（MODIFIED）要件は、本体の仕様の側では確かめない。
// 置き換えた後の要件は、変更提案の側で確かめる（OpenSpec の MODIFIED はシナリオを消せないので、
// シナリオを消すときは REMOVED と ADDED にする。その間、消える側のテストを求めないため）。
import { existsSync, globSync, readFileSync } from "node:fs";

const SCENARIO = /^#### Scenario:\s*(.+?)\s*$/gm;
const TEST_TITLE = /\b(?:it|test)\(\s*(["'`])((?:\\.|(?!\1)[^\\])*)\1/g;
const CHECKBOX = /^\s*- \[([^\]]*)\]/gm;
const REQUIREMENT = /^### Requirement:\s*(.+?)\s*$/;
const SECTION = /^## (.+?)\s*$/;

export type SourceFile = { path: string; text: string };
export type SpecGroup = { name: string; specs: SourceFile[]; requireTests: boolean };
export type Report = { errors: string[]; warnings: string[] };

export function scenarioNames(text: string): string[] {
  return [...text.matchAll(SCENARIO)].map((m) => m[1] ?? "");
}

export function testTitles(text: string): string[] {
  return [...text.matchAll(TEST_TITLE)].map((m) => (m[2] ?? "").replace(/\\(.)/g, "$1"));
}

// OpenSpec と同じく、中身が x だけのチェックボックスを完了とみなす。
export function allTasksDone(tasksText: string): boolean {
  const boxes = [...tasksText.matchAll(CHECKBOX)].map((m) => (m[1] ?? "").trim().toLowerCase());
  return boxes.length > 0 && boxes.every((b) => b === "x");
}

/** 変更提案の差分の spec.md から、消す・置き換える（REMOVED / MODIFIED）要件の名前を取り出す */
export function replacedRequirements(deltaText: string): string[] {
  const names: string[] = [];
  let section = "";
  for (const line of deltaText.split("\n")) {
    const heading = SECTION.exec(line);
    if (heading !== null) {
      section = heading[1] ?? "";
      continue;
    }
    const requirement = REQUIREMENT.exec(line);
    if (requirement !== null && /^(REMOVED|MODIFIED) Requirements$/.test(section)) {
      names.push(requirement[1] ?? "");
    }
  }
  return names;
}

/** 本体の spec.md から、指定した要件の部分（見出しから次の要件か節の見出しの前まで）を除く */
export function withoutRequirements(specText: string, names: ReadonlySet<string>): string {
  const kept: string[] = [];
  let skipping = false;
  for (const line of specText.split("\n")) {
    const requirement = REQUIREMENT.exec(line);
    if (requirement !== null) {
      skipping = names.has(requirement[1] ?? "");
    } else if (SECTION.test(line)) {
      skipping = false;
    }
    if (!skipping) kept.push(line);
  }
  return kept.join("\n");
}

export function findProblems(groups: SpecGroup[], tests: SourceFile[]): Report {
  const titles = new Set(tests.flatMap((t) => testTitles(t.text)));
  const report: Report = { errors: [], warnings: [] };
  for (const group of groups) {
    const seen = new Map<string, string>();
    for (const spec of group.specs) {
      for (const name of scenarioNames(spec.text)) {
        const first = seen.get(name);
        if (first !== undefined) {
          report.errors.push(
            `${group.name}: シナリオ「${name}」が重複しています（${first} と ${spec.path}）`,
          );
          continue;
        }
        seen.set(name, spec.path);
        if (!titles.has(name)) {
          const message = `${spec.path}: シナリオ「${name}」に対応するテストがありません`;
          (group.requireTests ? report.errors : report.warnings).push(message);
        }
      }
    }
  }
  return report;
}

function read(path: string): SourceFile {
  return { path, text: readFileSync(path, "utf8") };
}

/** "openspec/changes/x/specs/a/b/spec.md" や "openspec/specs/a/b/spec.md" → "a/b" */
function capabilityOf(path: string): string {
  return path.replace(/^.*?\/specs\//, "").replace(/\/spec\.md$/, "");
}

function main(): void {
  const changes = globSync("openspec/changes/*/")
    .sort()
    .map((dir) => dir.replace(/\/$/, ""))
    .filter((name) => !name.endsWith("/archive"));

  // アーカイブ前の変更提案が消す・置き換える要件（能力ごと）
  const replaced = new Map<string, Set<string>>();
  for (const name of changes) {
    for (const path of globSync(`${name}/specs/**/spec.md`)) {
      const set = replaced.get(capabilityOf(path)) ?? new Set<string>();
      for (const requirement of replacedRequirements(readFileSync(path, "utf8"))) {
        set.add(requirement);
      }
      replaced.set(capabilityOf(path), set);
    }
  }

  const groups: SpecGroup[] = [
    {
      name: "openspec/specs",
      specs: globSync("openspec/specs/**/spec.md")
        .sort()
        .map(read)
        .map((spec) => ({
          ...spec,
          text: withoutRequirements(spec.text, replaced.get(capabilityOf(spec.path)) ?? new Set()),
        })),
      requireTests: true,
    },
  ];
  for (const name of changes) {
    const tasks = `${name}/tasks.md`;
    groups.push({
      name,
      specs: globSync(`${name}/specs/**/spec.md`).sort().map(read),
      requireTests: existsSync(tasks) && allTasksDone(readFileSync(tasks, "utf8")),
    });
  }
  const tests = globSync("{src,scripts}/**/*.test.ts").sort().map(read);

  const { errors, warnings } = findProblems(groups, tests);
  for (const w of warnings) console.warn(`警告（作業中の変更提案）: ${w}`);
  for (const e of errors) console.error(e);
  if (errors.length > 0) process.exit(1);
  const count = groups.flatMap((g) => g.specs).flatMap((s) => scenarioNames(s.text)).length;
  console.log(`シナリオとテストの対応: OK（${count} 件、警告 ${warnings.length} 件）`);
}

if (import.meta.main) main();
