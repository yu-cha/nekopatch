// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { type ClearRecord, generate, type Puzzle, solutionCells } from "../../core/index.ts";
import { type App, type AppEnv, IMPORT_MESSAGES, startApp } from "./app.ts";
import { persistMessage } from "./persistence.ts";
import { MAIN_KEYS, SaveStore, TRIAL_KEYS, trialStorage } from "./save-store.ts";
import { MemoryStorage, seededRandom } from "./test-support.ts";

const html = readFileSync(join(import.meta.dirname, "../../../index.html"), "utf8");
const body = html.match(/<body>([\s\S]*)<\/body>/)?.[1] ?? "";

const $ = (id: string) => {
  const el = document.getElementById(id);
  if (el === null) throw new Error(`#${id} がありません`);
  return el;
};
const text = (id: string) => $(id).textContent ?? "";
const click = (id: string) => $(id).click();

/** 2026-10-22 10:00（日本の時刻で書き出しのファイル名が決まるよう、その土地の時刻で作る） */
const TODAY = new Date(2026, 9, 22, 10, 0).getTime();

/** 盤面の大きさと難しさごとに、決まった問題 */
function fixedPuzzle(N: number, diff: number): Puzzle {
  return generate(N, diff, 0, seededRandom(N * 10 + diff));
}

interface Harness {
  readonly app: App;
  readonly kv: MemoryStorage;
  readonly downloads: { fileName: string; text: string }[];
  readonly persistCalls: () => number;
  readonly clock: { now: number };
}

interface Options {
  readonly kv?: MemoryStorage;
  readonly trial?: boolean;
  /** 消さないよう頼む機能。none なら機能が無い */
  readonly persist?: { readonly persisted: boolean; readonly grant: boolean } | "none";
}

const running: App[] = [];

async function start(options: Options = {}): Promise<Harness> {
  const kv = options.kv ?? new MemoryStorage();
  const clock = { now: TODAY };
  const now = () => clock.now;
  const downloads: { fileName: string; text: string }[] = [];
  let calls = 0;
  const persist = options.persist ?? { persisted: false, grant: true };
  let granted = persist !== "none" && persist.persisted;
  const env: AppEnv = {
    store: options.trial
      ? new SaveStore(trialStorage(kv), TRIAL_KEYS, now)
      : new SaveStore(kv, MAIN_KEYS, now),
    trial: options.trial ?? false,
    generate: async (N, diff) => fixedPuzzle(N, diff),
    persistApi:
      persist === "none"
        ? undefined
        : {
            persisted: async () => granted,
            persist: async () => {
              calls++;
              granted = persist.grant;
              return granted;
            },
          },
    download: (fileName, t) => {
      downloads.push({ fileName, text: t });
    },
    now,
  };
  const app = startApp(document, env);
  running.push(app);
  await app.whenIdle();
  return { app, kv, downloads, persistCalls: () => calls, clock };
}

/** 作り直す前の版が保存した形の記録 */
function oldHistory(records: readonly ClearRecord[]): string {
  return JSON.stringify(records);
}

/** 作り直す前の版が保存した形の遊びかけの状態 */
function oldGame(fields: Record<string, unknown>): string {
  return JSON.stringify({
    P: null,
    st: [],
    elapsed: 0,
    won: false,
    solvedCount: 0,
    hints: 0,
    autoX: false,
    size: "8",
    diff: "2",
    ...fields,
  });
}

const A: ClearRecord = { at: 1760000000000, n: 6, d: 1, t: 95000, h: 1 };
const A2: ClearRecord = { at: 1760000600000, n: 6, d: 1, t: 80000, h: 0 };
const B: ClearRecord = { at: 1760100000000, n: 8, d: 2, t: 200000, h: 2 };
const C: ClearRecord = { at: 1760200000000, n: 8, d: 2, t: 170000, h: 0 };

/** 記録 3 件と「クリア 812 問」がある、作り直す前の保存 */
function threeRecords(): MemoryStorage {
  return new MemoryStorage({
    [MAIN_KEYS.history]: oldHistory([A, A2, B]),
    [MAIN_KEYS.game]: oldGame({ solvedCount: 812 }),
  });
}

/** 成績の表の行（盤面・難しさ、回数、平均、ベスト、前回、平均ヒント） */
function summaryRows(): string[][] {
  return [...document.querySelectorAll("#recSummary tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
  );
}

function storedRecords(kv: MemoryStorage, key = MAIN_KEYS.history): ClearRecord[] {
  return JSON.parse(kv.getItem(key) ?? "[]");
}

async function importFile(h: Harness, content: string): Promise<void> {
  const input = $("recFile") as HTMLInputElement;
  const file = new File([content], "nekopatch-records.json", { type: "application/json" });
  Object.defineProperty(input, "files", { value: [file], configurable: true });
  input.dispatchEvent(new Event("change"));
  await h.app.whenIdle();
}

/** ヒントと「この×を付ける」「猫を置く」を繰り返して解く */
function solveWithHints(): void {
  for (let n = 0; n < 300 && $("win").hidden; n++) {
    click("hintBtn");
    if (!$("applyBtn").hidden) click("applyBtn");
  }
}

/** 画面を作り直す。happy-dom 21 は、最初の option の前に改行がある select で、selected の位置を 1 つ取り違える
 * （盤面の大きさが 8×8 ではなく 7×7 になる）。本物のブラウザと同じ選択にそろえる */
function resetPage(): void {
  document.body.innerHTML = body;
  ($("size") as HTMLSelectElement).value = "8";
  ($("diff") as HTMLSelectElement).value = "2";
}

beforeEach(resetPage);

afterEach(() => {
  for (const app of running.splice(0)) app.stop();
});

describe("記録を数の上限なく残す", () => {
  it("501 回目のクリアのあとも、最初の記録が残る", async () => {
    const first: ClearRecord = { at: 1700000000000, n: 8, d: 2, t: 30000, h: 0 };
    const others = Array.from({ length: 499 }, (_, i) => ({
      at: 1700000000000 + (i + 1) * 60000,
      n: 8,
      d: 2,
      t: 61000 + i,
      h: 0,
    }));
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: oldHistory([first, ...others]) });
    const h = await start({ kv });

    h.clock.now += 120000; // 2 分かけて解く
    solveWithHints();
    expect($("win").hidden).toBe(false);

    const saved = storedRecords(kv);
    expect(saved).toHaveLength(501);
    expect(saved[0]).toEqual(first);
    expect(saved[500]).toMatchObject({ n: 8, d: 2, t: 120000 });

    click("recBtn");
    const row = summaryRows().find((r) => r[0] === "8×8 ふつう");
    expect(row?.[1]).toBe("501");
    expect(row?.[3]).toBe("0:30");
  });
});

describe("今までの記録を引き継ぐ", () => {
  it("作り直す前の記録とクリアの数を、そのまま読む", async () => {
    await start({ kv: threeRecords() });
    expect(text("solved")).toBe("812");
    click("recBtn");
    expect(summaryRows()).toEqual([
      ["6×6 かんたん", "2", "1:27", "1:20", "1:20", "0.5"],
      ["8×8 ふつう", "1", "3:20", "3:20", "3:20", "2.0"],
    ]);
    expect(document.querySelectorAll("#recList tbody tr")).toHaveLength(3);
  });

  it("作り直す前の遊びかけの盤面を、続きから遊べる", async () => {
    const p = fixedPuzzle(6, 1);
    const sol = [...solutionCells(p)];
    const cat = sol[0] ?? 0;
    const crosses = [...Array(36).keys()].filter((i) => !sol.includes(i)).slice(0, 2);
    const st = new Array(36).fill(0);
    st[cat] = 2;
    for (const i of crosses) st[i] = 1;
    const kv = new MemoryStorage({
      [MAIN_KEYS.game]: oldGame({
        P: { N: p.N, reg: p.reg, cats: p.cats, level: p.level, diff: 1 },
        st,
        elapsed: 5000,
        hints: 1,
        solvedCount: 7,
        size: "6",
        diff: "1",
      }),
    });
    await start({ kv });

    const cells = [...document.querySelectorAll<HTMLElement>("#board .cell")];
    expect(cells).toHaveLength(36);
    expect(cells.map((c) => c.dataset.v)).toEqual(st.map((v) => ["", "x", "cat"][v]));
    expect(text("hintCount")).toBe("1");
    expect(text("catCount")).toBe("1/6");
    expect(text("solved")).toBe("7");
    expect(($("size") as HTMLSelectElement).value).toBe("6");
  });
});

describe("読めない保存データを消さない", () => {
  it("読めない記録は、消さずに別の場所に残す", async () => {
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: '[{"at":1,' });
    await start({ kv });
    expect(kv.getItem(`${MAIN_KEYS.history}-unreadable-${TODAY}`)).toBe('[{"at":1,');
    click("recBtn");
    expect($("recUnreadable").hidden).toBe(false);
    expect(text("recUnreadable")).toBe(
      "読めない記録がありました。消さずに別の場所に残してあります。くろに相談してください。",
    );
  });

  it("読めない記録が無ければ、知らせを出さない", async () => {
    await start({ kv: threeRecords() });
    click("recBtn");
    expect($("recUnreadable").hidden).toBe(true);
    expect($("recSaveError").hidden).toBe(true);
  });

  it("記録を保存できなかったら、記録の画面で知らせる", async () => {
    const kv = new MemoryStorage();
    await start({ kv });
    kv.failWrites = true;
    solveWithHints();
    click("recBtn");
    expect($("recSaveError").hidden).toBe(false);
    expect(text("msgText")).toContain("記録を保存できませんでした");
  });
});

describe("保存データを消さないよう頼む", () => {
  it("頼みが通ったら、記録の画面にそう出す", async () => {
    const h = await start({ persist: { persisted: false, grant: true } });
    click("recBtn");
    await h.app.whenIdle();
    expect(text("recKeep")).toBe("この Chrome に、記録を消さないよう頼んであります。");
    expect(h.persistCalls()).toBe(1);
  });

  it("頼みが通らなければ、ホーム画面への追加を案内する", async () => {
    const h = await start({ persist: { persisted: false, grant: false } });
    click("recBtn");
    await h.app.whenIdle();
    expect(text("recKeep")).toBe(
      "Chrome は、スマホの空きが少なくなると、記録を消すことがあります。Chrome のメニュー（︙）から「ホーム画面に追加」をして、このゲームをホーム画面に置くと、記録が消えにくくなります。",
    );
    // 開いたときと「記録」を押したときに頼む
    expect(h.persistCalls()).toBe(2);
  });

  it("頼む機能が無いブラウザでは、頼めないことを出す", async () => {
    const h = await start({ persist: "none" });
    click("recBtn");
    await h.app.whenIdle();
    expect(text("recKeep")).toBe("このブラウザには、記録を消さないよう頼めません。");
  });

  it("一度通っていれば、頼み直さない", async () => {
    const h = await start({ persist: { persisted: true, grant: true } });
    click("recBtn");
    await h.app.whenIdle();
    expect(text("recKeep")).toBe(persistMessage("persisted"));
    expect(h.persistCalls()).toBe(0);
  });
});

describe("記録を書き出す", () => {
  it("書き出したファイルに、記録とクリアの数が入る", async () => {
    const h = await start({ kv: threeRecords() });
    click("recBtn");
    click("recExport");
    expect(h.downloads).toHaveLength(1);
    const [download] = h.downloads;
    expect(download?.fileName).toBe("nekopatch-records-2026-10-22.json");
    const file = JSON.parse(download?.text ?? "");
    expect(file.solvedCount).toBe(812);
    expect(file.records).toEqual([A, A2, B]);
  });
});

describe("記録を読み込む", () => {
  async function exportFrom(kv: MemoryStorage): Promise<string> {
    const h = await start({ kv });
    click("recBtn");
    click("recExport");
    return h.downloads[0]?.text ?? "";
  }

  it("記録の無いブラウザで読み込むと、一覧・平均・ベストが元と同じになる", async () => {
    const records = Array.from({ length: 40 }, (_, i) => ({
      at: 1760000000000 + i * 3600000,
      n: 6 + (i % 5),
      d: 1 + (i % 3),
      t: 40000 + ((i * 7919) % 300000),
      h: i % 4,
    }));
    const kv = new MemoryStorage({
      [MAIN_KEYS.history]: oldHistory(records),
      [MAIN_KEYS.game]: oldGame({ solvedCount: 45 }),
    });
    const h1 = await start({ kv });
    click("recBtn");
    const summary = $("recSummary").innerHTML;
    const recent = $("recList").innerHTML;
    click("recExport");
    const file = h1.downloads[0]?.text ?? "";
    h1.app.stop();

    resetPage();
    const empty = new MemoryStorage();
    const h2 = await start({ kv: empty });
    click("recBtn");
    await importFile(h2, file);

    expect($("recSummary").innerHTML).toBe(summary);
    expect($("recList").innerHTML).toBe(recent);
    expect(text("solved")).toBe("45");
    expect(storedRecords(empty)).toEqual(records);
  });

  it("同じファイルを 2 回読み込んでも、記録もクリアの数も増えない", async () => {
    const file = await exportFrom(threeRecords());
    resetPage();
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: oldHistory([C]) });
    const h = await start({ kv });
    click("recBtn");
    await importFile(h, file);
    const afterFirst = { records: storedRecords(kv), solved: text("solved") };
    expect(afterFirst.records).toHaveLength(4);

    await importFile(h, file);
    expect(storedRecords(kv)).toEqual(afterFirst.records);
    expect(text("solved")).toBe(afterFirst.solved);
    expect(text("recImportMsg")).toBe(IMPORT_MESSAGES.noneAdded);
    expect(text("recImportMsg")).toBe(
      "記録を読み込みました。同じ記録がもう入っていたので、増えた記録はありません。",
    );
  });

  it("壊れたファイルを読み込んでも、今の記録は変わらない", async () => {
    const kv = threeRecords();
    const h = await start({ kv });
    const before = kv.getItem(MAIN_KEYS.history);
    click("recBtn");
    await importFile(h, '{"format": "nekopatch-records", "version": 1, "records": [{"at": 17');
    expect(text("recImportMsg")).toBe(
      "このファイルは読み込めませんでした。今の記録はそのままです。",
    );
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before);
    expect(text("solved")).toBe("812");
    expect(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "").solvedCount).toBe(812);
  });

  it("ねこパッチの記録でないファイルを読み込んでも、今の記録は変わらない", async () => {
    const kv = threeRecords();
    const h = await start({ kv });
    const before = kv.getItem(MAIN_KEYS.history);
    click("recBtn");
    await importFile(h, JSON.stringify({ name: "ほかのアプリ", records: [A] }));
    expect(text("recImportMsg")).toBe(IMPORT_MESSAGES.unreadable);
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before);
  });

  it("読み込んで増えた記録の数を知らせる", async () => {
    const file = await exportFrom(threeRecords());
    resetPage();
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: oldHistory([A]) });
    const h = await start({ kv });
    click("recBtn");
    await importFile(h, file);
    expect(text("recImportMsg")).toBe("記録を読み込みました。増えた記録は 2 件です。");
    expect(storedRecords(kv)).toEqual([A, A2, B]);
  });

  it("読み込んだ記録を保存できなければ、今の記録のままにする", async () => {
    const file = await exportFrom(threeRecords());
    resetPage();
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: oldHistory([C]) });
    const h = await start({ kv });
    click("recBtn");
    kv.failWrites = true;
    await importFile(h, file);
    expect(text("recImportMsg")).toBe(IMPORT_MESSAGES.saveFailed);
    expect(storedRecords(kv)).toEqual([C]);
    expect(document.querySelectorAll("#recList tbody tr")).toHaveLength(1);
  });
});

describe("確かめ用のページ", () => {
  it("確かめ用のページは、最初に本物の記録を写して使う", async () => {
    const kv = threeRecords();
    const before = new Map(kv.items);
    await start({ kv, trial: true });
    expect(text("solved")).toBe("812");
    click("recBtn");
    expect(summaryRows().map((r) => r.slice(0, 2))).toEqual([
      ["6×6 かんたん", "2"],
      ["8×8 ふつう", "1"],
    ]);
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before.get(MAIN_KEYS.history));
    expect(kv.getItem(MAIN_KEYS.game)).toBe(before.get(MAIN_KEYS.game));
  });

  it("確かめ用のページは、本物のキーに書かない", async () => {
    const kv = threeRecords();
    const before = new Map(kv.items);
    const file = JSON.stringify({
      format: "nekopatch-records",
      version: 1,
      solvedCount: 900,
      records: [C],
    });
    const h = await start({ kv, trial: true });
    click("recBtn");
    await importFile(h, file);
    expect(storedRecords(kv, TRIAL_KEYS.history)).toEqual([A, A2, B, C]);
    solveWithHints();
    click("recClear");
    click("recClear");
    expect(storedRecords(kv, TRIAL_KEYS.history)).toEqual([]);

    for (const key of [MAIN_KEYS.history, MAIN_KEYS.game])
      expect(kv.getItem(key)).toBe(before.get(key));
    expect(kv.keysStartingWith("nekopatch-").filter((k) => !before.has(k))).toEqual([
      TRIAL_KEYS.game,
      TRIAL_KEYS.history,
    ]);
    expect(() => trialStorage(kv).setItem(MAIN_KEYS.history, "[]")).toThrow();
  });

  it("確かめ用のページには、確かめ用だと出す", async () => {
    await start({ trial: true });
    expect($("trialNote").hidden).toBe(false);
    expect(text("trialNote")).toBe(
      "確かめ用のページです。ここで遊んだ記録や読み込んだ記録は、本物のねこパッチには入りません。",
    );
    running.splice(0).forEach((app) => {
      app.stop();
    });
    resetPage();
    await start();
    expect($("trialNote").hidden).toBe(true);
  });
});
