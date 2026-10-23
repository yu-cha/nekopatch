// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  boardId,
  type ClearRecord,
  encodeBoard,
  generate,
  type Puzzle,
  REGION_NAMES,
  recordKey,
  solutionCells,
} from "../../core/index.ts";
import {
  type App,
  type AppEnv,
  CLEAR_CONFIRM_MESSAGE,
  IMPORT_MESSAGES,
  PLAY_MESSAGES,
  startApp,
} from "./app.ts";
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

/** 盤面の大きさと難しさごとに、決まった問題。k を変えると別の盤面になる */
function fixedPuzzle(N: number, diff: number, k = 0): Puzzle {
  return generate(N, diff, 0, seededRandom(N * 10 + diff + k * 1000));
}

interface Harness {
  readonly app: App;
  readonly kv: MemoryStorage;
  readonly downloads: { fileName: string; text: string }[];
  readonly persistCalls: () => number;
  readonly clock: { now: number };
  /** ほかのタブが保存データを書き換えたことを、このタブに知らせる（storage の出来事） */
  readonly notifyOtherTab: () => void;
  /** ブラウザの確かめの窓に出した文 */
  readonly confirms: string[];
}

interface Options {
  readonly kv?: MemoryStorage;
  readonly trial?: boolean;
  /** ブラウザの確かめの窓で OK を押すか（既定は OK） */
  readonly confirmAnswer?: boolean;
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
  let storageListener = () => {};
  const confirms: string[] = [];
  // 問題を作るたびに別の盤面にする（同じ盤面ばかりだと、もう一度遊んだ記録になる）
  let made = 0;
  const env: AppEnv = {
    store: options.trial
      ? new SaveStore(trialStorage(kv), TRIAL_KEYS, now)
      : new SaveStore(kv, MAIN_KEYS, now),
    trial: options.trial ?? false,
    generate: async (N, diff) => fixedPuzzle(N, diff, made++),
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
    onStorageChange: (listener) => {
      storageListener = listener;
    },
    now,
    confirm: (message) => {
      confirms.push(message);
      return options.confirmAnswer ?? true;
    },
  };
  const app = startApp(document, env);
  running.push(app);
  await app.whenIdle();
  return {
    app,
    kv,
    downloads,
    persistCalls: () => calls,
    clock,
    notifyOtherTab: () => storageListener(),
    confirms,
  };
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
  ($("recSort") as HTMLSelectElement).value = "new";
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

describe("ほかのタブで増えた記録を消さない", () => {
  /** ほかのタブが 1 問クリアして保存した、という状態にする（ほかのタブの盤面は保存しない） */
  function otherTabClears(kv: MemoryStorage, solvedCount: number): void {
    kv.setItem(MAIN_KEYS.history, oldHistory([...storedRecords(kv), C]));
    kv.setItem(MAIN_KEYS.game, oldGame({ solvedCount }));
  }

  it("別のタブでクリアした記録を、上書きで消さない", async () => {
    const kv = threeRecords();
    await start({ kv });
    // このタブがまだ知らないうちに、ほかのタブが 1 問クリアする（storage の出来事は届いていない）
    otherTabClears(kv, 813);
    solveWithHints();

    const saved = storedRecords(kv);
    expect(saved).toHaveLength(5);
    expect(saved.slice(0, 4)).toEqual([A, A2, B, C]);
    expect(text("solved")).toBe("814");
    expect(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "").solvedCount).toBe(814);
  });

  it("別のタブで増えた記録を、開いている記録の画面に出す", async () => {
    const kv = threeRecords();
    const h = await start({ kv });
    click("recBtn");
    expect(document.querySelectorAll("#recList tbody tr")).toHaveLength(3);

    otherTabClears(kv, 813);
    h.notifyOtherTab();
    expect(document.querySelectorAll("#recList tbody tr")).toHaveLength(4);
    expect(text("solved")).toBe("813");
  });

  it("ほかのタブのクリアの数が多ければ、遊びかけの保存で小さい数に戻さない", async () => {
    const kv = threeRecords();
    await start({ kv });
    otherTabClears(kv, 813);
    click("clearXBtn"); // 盤面を保存する操作
    expect(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "").solvedCount).toBe(813);
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
    expect(storedRecords(kv, TRIAL_KEYS.history)).toHaveLength(5);
    click("recClear");
    click("recClearYes");
    expect(storedRecords(kv, TRIAL_KEYS.history)).toEqual([]);

    for (const key of [MAIN_KEYS.history, MAIN_KEYS.game, MAIN_KEYS.boards])
      expect(kv.getItem(key)).toBe(before.get(key) ?? null);
    expect(kv.keysStartingWith("nekopatch-").filter((k) => !before.has(k))).toEqual([
      TRIAL_KEYS.game,
      TRIAL_KEYS.history,
      TRIAL_KEYS.boards,
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

// ---------- 同じ盤面をもう一度遊ぶ（replay-board） ----------

/** 前に遊んだ盤面（8×8・ふつう） */
const PA = fixedPuzzle(8, 2, 100);
const PB = fixedPuzzle(8, 2, 200);
const PC = fixedPuzzle(8, 2, 300);
const codeOf = (p: Puzzle) => encodeBoard(p.N, p.reg);

/** i 分目にクリアした 8×8・ふつう（ほかの大きさ・難しさも指定できる）の記録 */
function play(i: number, t: number, h = 0, n = 8, d = 2): ClearRecord {
  return { at: 1761300000000 + i * 60000, n, d, t, h };
}

/** 記録と、その盤面の形（盤面の形が無い記録は null）を保存した状態 */
function withBoards(
  entries: [ClearRecord, Puzzle | null][],
  extra: Record<string, string> = {},
): MemoryStorage {
  const boards: Record<string, string> = {};
  for (const [r, p] of entries) if (p !== null) boards[recordKey(r)] = codeOf(p);
  return new MemoryStorage({
    [MAIN_KEYS.history]: oldHistory(entries.map(([r]) => r)),
    [MAIN_KEYS.boards]: JSON.stringify(boards),
    ...extra,
  });
}

/** 一覧の行（セルの文字） */
function listRows(): string[][] {
  return [...document.querySelectorAll("#recList tbody tr")].map((tr) =>
    [...tr.querySelectorAll("td")].map((td) => td.textContent ?? ""),
  );
}
/** 一覧の行の盤面 ID */
function listIds(): string[] {
  return [...document.querySelectorAll("#recList tbody tr")].map(
    (tr) => tr.querySelector(".bid")?.textContent ?? "",
  );
}
/** 新しい順の一覧の行の、タイムと前回比 */
function listTimes(): [string, string][] {
  return [...document.querySelectorAll("#recList tbody tr")].map((tr) => {
    const cell = tr.querySelectorAll("td")[2];
    return [cell?.firstChild?.textContent ?? "", cell?.querySelector(".df")?.textContent ?? ""];
  });
}
function playButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>("#recList button.play")];
}
/** 一覧で、盤面 ID が id の最初の行の「遊ぶ」を押す */
function clickPlay(id: string): void {
  const row = [...document.querySelectorAll("#recList tbody tr")].find(
    (tr) => tr.querySelector(".bid")?.textContent === id,
  );
  const btn = row?.querySelector<HTMLButtonElement>("button.play");
  if (btn === null || btn === undefined) throw new Error(`${id} の「遊ぶ」がありません`);
  btn.click();
}
const idOf = (p: Puzzle) => boardId(p.N, codeOf(p));

/** 盤面のマスごとの色のエリアの番号（読み上げの名前から） */
function boardRegions(): number[] {
  return [...document.querySelectorAll<HTMLElement>("#board .cell")].map((c) =>
    REGION_NAMES.indexOf(c.getAttribute("aria-label")?.split(" ")[1] ?? ""),
  );
}
/** 盤面のマスごとの状態（"" は空白、"x"、"cat"） */
function boardMarks(): string[] {
  return [...document.querySelectorAll<HTMLElement>("#board .cell")].map((c) => c.dataset.v ?? "");
}

function choose(id: string, value: string): void {
  const el = $(id) as HTMLSelectElement;
  el.value = value;
  el.dispatchEvent(new Event("change"));
}

function storedBoards(kv: MemoryStorage, key = MAIN_KEYS.boards): Record<string, string> {
  return JSON.parse(kv.getItem(key) ?? "{}");
}

/** ms かけて、今の盤面を解く */
function solveTaking(h: Harness, ms: number): void {
  h.clock.now += ms;
  solveWithHints();
  expect($("win").hidden).toBe(false);
}

describe("遊んだ盤面の形を残す", () => {
  it("クリアした盤面の形を、記録とは別のキーに残す", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    const saved = storedRecords(kv);
    expect(saved).toHaveLength(1);
    const [rec] = saved;
    if (rec === undefined) throw new Error("記録がありません");
    expect(Object.keys(rec)).toEqual(["at", "n", "d", "t", "h"]);
    expect(rec).toMatchObject({ n: 8, d: 2, t: 65000 });
    // 最初の問題は、偽物の問題作りの 1 問目
    expect(storedBoards(kv)).toEqual({ [recordKey(rec)]: codeOf(fixedPuzzle(8, 2, 0)) });
  });

  it("盤面を知らない版が記録を保存し直しても、盤面の形は残る", async () => {
    const a1 = play(0, 300000);
    const kv = withBoards([[a1, PA]]);
    const boards = kv.getItem(MAIN_KEYS.boards);
    // 今配信している版は、5 つの値だけの形で記録を保存し直す
    kv.setItem(MAIN_KEYS.history, oldHistory([a1, play(1, 200000)]));
    await start({ kv });
    expect(kv.getItem(MAIN_KEYS.boards)).toBe(boards);
    click("recBtn");
    expect(listIds()).toEqual(["—", idOf(PA)]);
    expect(playButtons()).toHaveLength(1);
  });
});

describe("盤面 ID で盤面を見分ける", () => {
  it("同じ盤面には、いつも同じ盤面 ID がつく", async () => {
    await start({
      kv: withBoards([
        [play(0, 300000), PA],
        [play(1, 180000), PB],
        [play(2, 90000), PA],
      ]),
    });
    click("recBtn");
    const ids = listIds();
    expect(ids).toHaveLength(3);
    expect(ids[0]).toBe(ids[2]);
    expect(ids[1]).not.toBe(ids[0]);
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
  });

  it("盤面の形が無い記録には、遊ぶが出ない", async () => {
    await start({
      kv: withBoards([
        [play(0, 200000), null],
        [play(1, 300000), PA],
      ]),
    });
    click("recBtn");
    expect(listIds()).toEqual([idOf(PA), "—"]);
    const rows = [...document.querySelectorAll("#recList tbody tr")];
    expect(rows.map((tr) => tr.querySelector("button.play") !== null)).toEqual([true, false]);
  });
});

describe("記録の一覧から同じ盤面を遊ぶ", () => {
  it("記録の一覧の遊ぶで、同じ盤面を最初から遊べる", async () => {
    const h = await start({ kv: withBoards([[play(0, 300000), PA]]) });
    choose("size", "6");
    choose("diff", "1");
    await h.app.whenIdle();
    solveTaking(h, 30000);
    expect(text("hintCount")).not.toBe("0");

    click("recBtn");
    clickPlay(idOf(PA));
    expect(boardRegions()).toEqual(PA.reg);
    expect(boardMarks().every((v) => v === "")).toBe(true);
    expect($("win").hidden).toBe(true);
    expect(text("timer")).toBe("0:00");
    expect(text("hintCount")).toBe("0");
    expect(($("size") as HTMLSelectElement).value).toBe("8");
    expect(($("diff") as HTMLSelectElement).value).toBe("2");
  });

  it("遊んでいる途中なら、もう一度押してから始める", async () => {
    await start({ kv: withBoards([[play(0, 300000), PA]]) });
    // ヒントの 1 手を付けて、遊んでいる途中にする
    click("hintBtn");
    click("applyBtn");
    const marks = boardMarks();
    const regions = boardRegions();
    expect(marks.some((v) => v !== "")).toBe(true);

    click("recBtn");
    clickPlay(idOf(PA));
    expect(text("recPlayMsg")).toBe("もう一度押すと、遊びかけの盤面をやめて、この盤面を始めます。");
    expect($("recPlayMsg").hidden).toBe(false);
    expect(boardRegions()).toEqual(regions);
    expect(boardMarks()).toEqual(marks);

    clickPlay(idOf(PA));
    expect(boardRegions()).toEqual(PA.reg);
    expect(boardMarks().every((v) => v === "")).toBe(true);
    expect($("recPlayMsg").hidden).toBe(true);
  });

  it("確かめのあと時間がたったら、もう一度確かめる", async () => {
    const h = await start({ kv: withBoards([[play(0, 300000), PA]]) });
    click("hintBtn");
    click("applyBtn");
    const regions = boardRegions();
    click("recBtn");
    clickPlay(idOf(PA));
    h.clock.now += 6000;
    clickPlay(idOf(PA));
    expect(boardRegions()).toEqual(regions);
    expect(text("recPlayMsg")).toBe(PLAY_MESSAGES.confirm);
  });

  it("何も置いていなければ、すぐに始める", async () => {
    await start({ kv: withBoards([[play(0, 300000), PA]]) });
    expect(boardMarks().every((v) => v === "")).toBe(true);
    click("recBtn");
    clickPlay(idOf(PA));
    expect(boardRegions()).toEqual(PA.reg);
    expect($("recPlayMsg").hidden).toBe(true);
  });

  it("盤面の形が壊れていたら、遊ばずに知らせる", async () => {
    const a1 = play(0, 300000);
    // 文字と長さは合っているが、答えが無い盤面（全部が 1 つのエリア）
    const kv = new MemoryStorage({
      [MAIN_KEYS.history]: oldHistory([a1]),
      [MAIN_KEYS.boards]: JSON.stringify({
        [recordKey(a1)]: encodeBoard(8, new Array(64).fill(0)),
      }),
    });
    await start({ kv });
    const regions = boardRegions();
    click("recBtn");
    playButtons()[0]?.click();
    expect(text("recPlayMsg")).toBe(PLAY_MESSAGES.broken);
    expect(boardRegions()).toEqual(regions);
  });
});

describe("クリアの画面からもう一度遊ぶ", () => {
  it("クリアの画面のもう一度この盤面で、同じ盤面を最初から遊べる", async () => {
    const h = await start();
    solveTaking(h, 120000);
    const regions = boardRegions();
    expect(text("hintCount")).not.toBe("0");
    click("winRetry");
    expect($("win").hidden).toBe(true);
    expect(boardRegions()).toEqual(regions);
    expect(boardMarks().every((v) => v === "")).toBe(true);
    expect(text("timer")).toBe("0:00");
    expect(text("hintCount")).toBe("0");
  });
});

describe("もう一度遊んだ記録は、成績の表とクリアの数に数えない", () => {
  it("もう一度遊んだ記録は、成績の表に入れない", async () => {
    const kv = withBoards([
      [play(0, 300000), PA],
      [play(1, 180000), PB],
    ]);
    const h = await start({ kv });
    click("recBtn");
    clickPlay(idOf(PA));
    solveTaking(h, 90000);
    expect(storedRecords(kv)).toHaveLength(3);
    expect(summaryRows()).toEqual([["8×8 ふつう", "2", "4:00", "3:00", "3:00", "0.0"]]);
  });

  it("もう一度遊んでクリアしても、クリアの数は増えない", async () => {
    const kv = withBoards([[play(0, 300000), PA]], {
      [MAIN_KEYS.game]: oldGame({ solvedCount: 812 }),
    });
    const h = await start({ kv });
    click("recBtn");
    clickPlay(idOf(PA));
    solveTaking(h, 90000);
    expect(text("solved")).toBe("812");
    expect(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "").solvedCount).toBe(812);
    expect(storedRecords(kv)).toHaveLength(2);
  });

  it("初めての盤面をクリアしたら、クリアの数は増える", async () => {
    const kv = withBoards([[play(0, 300000), PA]], {
      [MAIN_KEYS.game]: oldGame({ solvedCount: 812 }),
    });
    const h = await start({ kv });
    solveTaking(h, 90000);
    expect(text("solved")).toBe("813");
  });

  it("盤面の形が無い記録は、初めての記録として数える", async () => {
    await start({
      kv: withBoards([
        [play(0, 120000), null],
        [play(1, 180000), null],
      ]),
    });
    click("recBtn");
    expect(summaryRows().map((r) => r.slice(0, 3))).toEqual([["8×8 ふつう", "2", "2:30"]]);
  });
});

describe("もう一度クリアしたら、同じ盤面の記録と比べる", () => {
  it("もう一度クリアしたら、その盤面の回数・前回・ベストを出す", async () => {
    const h = await start({
      kv: withBoards([
        [play(0, 65000), PA],
        [play(1, 105000), PA],
      ]),
    });
    click("recBtn");
    clickPlay(idOf(PA));
    solveTaking(h, 85000);
    expect(text("winCompare")).toBe("この盤面 3 回目　前回より 0:20 速い　ベスト 1:05");
  });

  it("その盤面で一番速ければ、この盤面の自己ベストと出す", async () => {
    const h = await start({ kv: withBoards([[play(0, 300000), PA]]) });
    click("recBtn");
    clickPlay(idOf(PA));
    solveTaking(h, 90000);
    expect(text("winCompare")).toBe(
      "この盤面の自己ベスト！　この盤面 2 回目　前回より 3:30 速い　ベスト 1:30",
    );
  });

  it("初めての盤面は、同じ大きさ・難しさの初めての記録とだけ比べる", async () => {
    const h = await start({
      kv: withBoards([
        [play(0, 300000), PA],
        [play(1, 90000), PA],
      ]),
    });
    // 最初に出ている問題（盤面 C）は、初めての盤面
    solveTaking(h, 360000);
    expect(text("winCompare")).toBe("前回より 1:00 遅い　平均 5:30（2回）");
  });
});

describe("記録の一覧を並べ替え、絞り込み、さかのぼる", () => {
  /** 8×8・ふつうで、盤面 A を 5:00、盤面 B を 3:00、A をもう一度 1:30 */
  function abA(): MemoryStorage {
    return withBoards([
      [play(0, 300000, 3), PA],
      [play(1, 180000, 1), PB],
      [play(2, 90000, 0), PA],
    ]);
  }
  /** 盤面ごとの行の、盤面 ID と、初回・ベスト・回数・最少ヒント */
  function boardList(): string[][] {
    return listRows().map((cells, i) => [listIds()[i] ?? "", ...cells.slice(1, 5)]);
  }

  it("盤面ごとに、ベストの遅い順に並べる", async () => {
    await start({ kv: abA() });
    click("recBtn");
    choose("recSort", "slow");
    expect(boardList()).toEqual([
      [idOf(PB), "3:00", "3:00", "1", "1"],
      [idOf(PA), "5:00", "1:30", "2", "0"],
    ]);
    expect(playButtons()).toHaveLength(2);
  });

  it("盤面ごとに、ベストの速い順に並べる", async () => {
    await start({ kv: abA() });
    click("recBtn");
    choose("recSort", "fast");
    expect(listIds()).toEqual([idOf(PA), idOf(PB)]);
  });

  it("盤面ごとに、一番少ないヒントの回数の多い順に並べる", async () => {
    await start({ kv: abA() });
    click("recBtn");
    choose("recSort", "hints");
    expect(boardList().map((r) => [r[0], r[4]])).toEqual([
      [idOf(PB), "1"],
      [idOf(PA), "0"],
    ]);
  });

  it("盤面の大きさと難しさで絞る", async () => {
    await start({
      kv: withBoards([
        [play(0, 300000), PA],
        [play(1, 60000, 0, 6, 1), null],
        [play(2, 180000), PB],
      ]),
    });
    click("recBtn");
    expect(listRows()).toHaveLength(3);
    choose("recFilter", "8-2");
    expect(listIds()).toEqual([idOf(PB), idOf(PA)]);
    choose("recFilter", "all");
    expect(listRows()).toHaveLength(3);
  });

  it("もっと見るで、古い記録までさかのぼれる", async () => {
    const records = Array.from({ length: 70 }, (_, i) => play(i, 60000 + i * 1000));
    await start({ kv: withBoards(records.map((r) => [r, null])) });
    click("recBtn");
    expect(listRows()).toHaveLength(30);
    expect($("recMore").hidden).toBe(false);
    click("recMore");
    expect(listRows()).toHaveLength(60);
    click("recMore");
    expect(listRows()).toHaveLength(70);
    expect($("recMore").hidden).toBe(true);
    // 一番古い記録まで出ている
    expect(listTimes().at(-1)).toEqual(["1:00", "—"]);
  });

  it("新しい順の前回比は、もう一度遊んだ行なら同じ盤面の前回と比べる", async () => {
    await start({ kv: abA() });
    click("recBtn");
    expect(listTimes()).toEqual([
      ["1:30", "−3:30"],
      ["3:00", "−2:00"],
      ["5:00", "—"],
    ]);
    // 列は、日時、盤面（盤面 ID と何回目か）、タイム（前回比）、ヒント、遊ぶ
    const rows = listRows();
    expect(rows[0]?.[1]).toContain("2回目");
    expect(rows[1]?.[1]).not.toContain("回目");
  });

  it("盤面ごとの並びには、盤面の形がある記録だけを出す", async () => {
    await start({
      kv: withBoards([
        [play(0, 120000), null],
        [play(1, 180000), null],
        [play(2, 300000), PA],
      ]),
    });
    click("recBtn");
    choose("recSort", "slow");
    expect(listIds()).toEqual([idOf(PA)]);
  });

  it("盤面ごとに並べる盤面がまだ無ければ、そう出す", async () => {
    await start({ kv: threeRecords() });
    click("recBtn");
    choose("recSort", "slow");
    expect(listRows()).toHaveLength(0);
    expect(text("recList")).toBe("もう一度遊べる盤面は、まだありません。");
  });
});

describe("盤面の形を書き出し・読み込みで移す", () => {
  async function exportFile(kv: MemoryStorage): Promise<string> {
    const h = await start({ kv });
    click("recBtn");
    click("recExport");
    return h.downloads[0]?.text ?? "";
  }

  it("書き出したファイルに、盤面の形が入る", async () => {
    const a1 = play(0, 300000);
    const old = play(1, 200000);
    const file = JSON.parse(
      await exportFile(
        withBoards([
          [a1, PA],
          [old, null],
        ]),
      ),
    );
    expect(file.version).toBe(1);
    expect(file.records).toEqual([{ ...a1, b: codeOf(PA) }, old]);
  });

  it("読み込むと、書き出したスマホで遊んだ盤面を遊べる", async () => {
    const file = await exportFile(
      withBoards([
        [play(0, 300000), PA],
        [play(1, 180000), PB],
      ]),
    );
    click("recBtn");
    const ids = listIds();
    running.splice(0).forEach((app) => {
      app.stop();
    });

    resetPage();
    const h = await start({ kv: new MemoryStorage() });
    click("recBtn");
    await importFile(h, file);
    expect(playButtons()).toHaveLength(2);
    expect(listIds()).toEqual(ids);
    expect(ids).toEqual([idOf(PB), idOf(PA)]);
  });

  it("盤面の形が無い前のファイルも読み込める", async () => {
    const file = JSON.stringify({
      format: "nekopatch-records",
      version: 1,
      exportedAt: "2026-10-22T01:00:00.000Z",
      solvedCount: 812,
      records: [A, A2, B],
    });
    const kv = new MemoryStorage();
    const h = await start({ kv });
    click("recBtn");
    await importFile(h, file);
    expect(storedRecords(kv)).toEqual([A, A2, B]);
    expect(listRows()).toHaveLength(3);
    expect(playButtons()).toHaveLength(0);
  });

  it("盤面の符号が読めないファイルは、何も読み込まない", async () => {
    const kv = withBoards([[play(0, 300000), PA]]);
    const before = new Map(kv.items);
    const h = await start({ kv });
    click("recBtn");
    const file = JSON.stringify({
      format: "nekopatch-records",
      version: 1,
      solvedCount: 2,
      records: [
        { ...play(5, 100000), b: codeOf(PB) },
        { ...play(6, 110000), b: codeOf(PC).slice(1) },
      ],
    });
    await importFile(h, file);
    expect(text("recImportMsg")).toBe(
      "このファイルは読み込めませんでした。今の記録はそのままです。",
    );
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before.get(MAIN_KEYS.history));
    expect(kv.getItem(MAIN_KEYS.boards)).toBe(before.get(MAIN_KEYS.boards));
  });
});

describe("記録を全部消すときは、3 回確かめる", () => {
  function twoBoards(): MemoryStorage {
    return withBoards([
      [play(0, 300000), PA],
      [play(1, 180000), PB],
    ]);
  }

  it("記録を全部消すボタンは一番下にあり、1 回押しただけでは消えない", async () => {
    const kv = twoBoards();
    const before = new Map(kv.items);
    const h = await start({ kv });
    click("recBtn");
    expect($("recPanel").lastElementChild?.id).toBe("recClearZone");
    expect($("recClearConfirm").hidden).toBe(true);
    click("recClear");
    expect($("recClearConfirm").hidden).toBe(false);
    expect(text("recClearConfirm")).toContain(
      "記録を全部消すと、元に戻せません。消す前に「記録を書き出す」でファイルにしておくと、あとで「記録を読み込む」で戻せます。",
    );
    expect(h.confirms).toEqual([]);
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before.get(MAIN_KEYS.history));
    // やめれば、注意の文も消える
    click("recClearNo");
    expect($("recClearConfirm").hidden).toBe(true);
    expect(kv.getItem(MAIN_KEYS.boards)).toBe(before.get(MAIN_KEYS.boards));
  });

  it("記録を全部消すと、盤面の形も消える", async () => {
    const kv = twoBoards();
    const h = await start({ kv });
    click("recBtn");
    click("recClear");
    click("recClearYes");
    expect(h.confirms).toEqual([CLEAR_CONFIRM_MESSAGE]);
    expect(h.confirms).toEqual(["記録を全部消します。消した記録は戻せません。本当に消しますか？"]);
    expect(kv.getItem(MAIN_KEYS.history)).toBe("[]");
    expect(kv.getItem(MAIN_KEYS.boards)).toBe("{}");
    expect(listRows()).toHaveLength(0);
  });

  it("確かめの窓でキャンセルすれば、記録は消えない", async () => {
    const kv = twoBoards();
    const before = new Map(kv.items);
    await start({ kv, confirmAnswer: false });
    click("recBtn");
    click("recClear");
    click("recClearYes");
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before.get(MAIN_KEYS.history));
    expect(kv.getItem(MAIN_KEYS.boards)).toBe(before.get(MAIN_KEYS.boards));
    expect(listRows()).toHaveLength(2);
    expect($("recClearConfirm").hidden).toBe(true);
  });
});

describe("読めない盤面の保存データを消さない", () => {
  it("読めない盤面の保存データは、消さずに別の場所に残す", async () => {
    const kv = new MemoryStorage({
      [MAIN_KEYS.history]: oldHistory([play(0, 300000)]),
      [MAIN_KEYS.boards]: '{"1":',
    });
    await start({ kv });
    expect(kv.getItem(`${MAIN_KEYS.boards}-unreadable-${TODAY}`)).toBe('{"1":');
    click("recBtn");
    expect(listRows()).toHaveLength(1);
    expect(playButtons()).toHaveLength(0);
    expect($("recUnreadable").hidden).toBe(false);
    expect(text("recUnreadable")).toBe(
      "読めない記録がありました。消さずに別の場所に残してあります。くろに相談してください。",
    );
  });
});

describe("確かめ用のページは、盤面の形も確かめ用のキーに置く", () => {
  it("確かめ用のページは、盤面の形を確かめ用のキーに置く", async () => {
    const kv = withBoards([[play(0, 300000), PA]]);
    const before = kv.getItem(MAIN_KEYS.boards);
    const h = await start({ kv, trial: true });
    click("recBtn");
    clickPlay(idOf(PA));
    solveTaking(h, 90000);
    expect(Object.values(storedBoards(kv, TRIAL_KEYS.boards))).toEqual([codeOf(PA), codeOf(PA)]);
    expect(kv.getItem(MAIN_KEYS.boards)).toBe(before);
  });
});
