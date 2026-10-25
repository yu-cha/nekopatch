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
  parseSavedGame,
  REGION_NAMES,
  type RecordNote,
  recordKey,
  solutionCells,
} from "../../core/index.ts";
import {
  type App,
  type AppEnv,
  CLEAR_CONFIRM_MESSAGE,
  IMPORT_MESSAGES,
  PLAY_MESSAGES,
  SHARE_MESSAGES,
  SHARED_MESSAGES,
  startApp,
  WIN_SAVED_MESSAGES,
} from "./app.ts";
import { persistMessage } from "./persistence.ts";
import { MAIN_KEYS, SaveStore, TRIAL_KEYS, trialStorage } from "./save-store.ts";
import type { ShareResult } from "./share.ts";
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
  /** 共有の画面に渡した文 */
  readonly shares: string[];
  /** 開いているページの # の後ろが、送られてきた盤面のリンクに変わった（hashchange） */
  readonly openLink: (fragment: string) => Promise<void>;
}

interface Options {
  readonly kv?: MemoryStorage;
  readonly trial?: boolean;
  /** ブラウザの確かめの窓で OK を押すか（既定は OK） */
  readonly confirmAnswer?: boolean;
  /** 消さないよう頼む機能。none なら機能が無い */
  readonly persist?: { readonly persisted: boolean; readonly grant: boolean } | "none";
  /** 開いたときのアドレスの # の後ろ（送られてきた盤面のリンク）。無ければリンクでない */
  readonly link?: string;
  /** 共有の画面に渡したときの結果（既定は shared） */
  readonly shareResult?: ShareResult;
}

/** 本物のページのアドレス（確かめ用のページは preview/） */
const PAGE = "https://yu-cha.github.io/nekopatch/";
const TRIAL_PAGE = "https://yu-cha.github.io/nekopatch/preview/";

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
  const shares: string[] = [];
  let link: string | null = options.link ?? null;
  let linkListener = () => {};
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
    pageUrl: options.trial ? TRIAL_PAGE : PAGE,
    takeLink: () => {
      const l = link;
      link = null;
      return l;
    },
    onLinkChange: (listener) => {
      linkListener = listener;
    },
    share: async (t) => {
      shares.push(t);
      return options.shareResult ?? "shared";
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
    shares,
    openLink: async (fragment) => {
      link = fragment;
      linkListener();
      await app.whenIdle();
    },
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

    for (const key of Object.values(MAIN_KEYS))
      expect(kv.getItem(key)).toBe(before.get(key) ?? null);
    expect(kv.keysStartingWith("nekopatch-").filter((k) => !before.has(k))).toEqual([
      TRIAL_KEYS.game,
      TRIAL_KEYS.history,
      TRIAL_KEYS.boards,
      TRIAL_KEYS.notes,
      TRIAL_KEYS.received,
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
/** 新しい順の一覧の行の、タイムと前回比（列は ✎、日時、盤面、タイム、ヒント、遊ぶ） */
function listTimes(): [string, string][] {
  return [...document.querySelectorAll("#recList tbody tr")].map((tr) => {
    const cell = tr.querySelectorAll("td")[3];
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
    // 列は、✎、日時、盤面（盤面 ID と何回目か）、タイム（前回比）、ヒント、遊ぶ
    const rows = listRows();
    expect(rows[0]?.[2]).toContain("2回目");
    expect(rows[1]?.[2]).not.toContain("回目");
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

// ---------- 記録に備考を書く（record-notes） ----------

/** 記録と、その備考と印を保存した状態（ほかのキーも足せる） */
function withNotes(
  records: readonly ClearRecord[],
  notes: [ClearRecord, RecordNote][],
  extra: Record<string, string> = {},
): MemoryStorage {
  return new MemoryStorage({
    [MAIN_KEYS.history]: oldHistory(records),
    [MAIN_KEYS.notes]: JSON.stringify(Object.fromEntries(notes.map(([r, n]) => [recordKey(r), n]))),
    ...extra,
  });
}
function storedNotes(kv: MemoryStorage, key = MAIN_KEYS.notes): Record<string, RecordNote> {
  return JSON.parse(kv.getItem(key) ?? "{}");
}
/** 欄に文字を入れる。change を付けると、欄から外れたとき（決定、欄の外を押す）と同じ */
function typeInto(input: HTMLElement, value: string, change = true): void {
  (input as HTMLInputElement).value = value;
  if (change) input.dispatchEvent(new Event("change", { bubbles: true }));
}
/** 新しい順の一覧で、記録 r の行 */
function recordRow(r: ClearRecord): HTMLTableRowElement {
  const row = [...document.querySelectorAll<HTMLTableRowElement>("#recList tbody tr")].find(
    (tr) => tr.querySelector<HTMLElement>("button.noteBtn")?.dataset.k === recordKey(r),
  );
  if (row === undefined) throw new Error(`${recordKey(r)} の行がありません`);
  return row;
}
/** 記録 r の行のすぐ下の備考の行の文字。備考の行が無ければ null */
function remarkOf(r: ClearRecord): string | null {
  const next = recordRow(r).nextElementSibling;
  return next?.classList.contains("noteRow") === true ? (next.textContent ?? "") : null;
}
function clickNote(r: ClearRecord): void {
  recordRow(r).querySelector<HTMLButtonElement>("button.noteBtn")?.click();
}
function editor(): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>("#recList input.memoInput");
  if (input === null) throw new Error("書く欄が開いていません");
  return input;
}
function clickInEditor(cls: "hardBtn" | "noteClose"): void {
  const btn = document.querySelector<HTMLButtonElement>(`#recList button.${cls}`);
  if (btn === null) throw new Error(`書く欄に ${cls} がありません`);
  btn.click();
}
function setAutoX(on: boolean): void {
  const box = $("autoX") as HTMLInputElement;
  box.checked = on;
  box.dispatchEvent(new Event("change"));
}
function catsOnBoard(): number {
  return document.querySelectorAll('#board .cell[data-v="cat"]').length;
}
/** ヒントの「この×を付ける」「猫を置く」で、猫を 1 匹置くまで進める */
function placeOneCatWithHints(): void {
  const before = catsOnBoard();
  for (let n = 0; n < 300 && catsOnBoard() === before; n++) {
    click("hintBtn");
    if (!$("applyBtn").hidden) click("applyBtn");
  }
  expect(catsOnBoard()).toBeGreaterThan(before);
}
/** ほかのアプリに切り替える（ページが隠れる） */
function goBackground(): void {
  Object.defineProperty(document, "hidden", { value: true, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
  Object.defineProperty(document, "hidden", { value: false, configurable: true });
}
/** 新しい順の一覧の、記録 r のヒントの欄の下の段 */
function hintSubOf(r: ClearRecord): string | null {
  return recordRow(r).querySelectorAll("td")[4]?.querySelector(".sub")?.textContent ?? null;
}

describe("クリアの画面で備考を書く", () => {
  it("クリアの画面で書いたひと言を、その記録の備考として残す", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    // 決定を押さずに「次の問題」を押しても、書いた文は残る
    typeInto($("winMemo"), "左下で迷った", false);
    click("winNext");
    await h.app.whenIdle();
    const [r] = storedRecords(kv);
    if (r === undefined) throw new Error("記録がありません");
    expect(storedNotes(kv)).toEqual({ [recordKey(r)]: { memo: "左下で迷った" } });
    click("recBtn");
    expect(remarkOf(r)).toBe("左下で迷った");
  });

  it("クリアの画面の保存を押すと、書いた文を保存して、保存しましたと出す", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    const key = recordKey(storedRecords(kv)[0] ?? A);
    expect($("winSaved").hidden).toBe(true);
    // 決定も欄の外も押さずに「保存」を押す
    typeInto($("winMemo"), "左下で迷った", false);
    click("winSave");
    expect(storedNotes(kv)).toEqual({ [key]: { memo: "左下で迷った" } });
    expect($("winSaved").hidden).toBe(false);
    expect(text("winSaved")).toBe("保存しました");
    expect(WIN_SAVED_MESSAGES.saved).toBe("保存しました");
    expect($("win").hidden).toBe(false);
    // 書き足すと、「保存しました」は消える
    typeInto($("winMemo"), "左下で迷った！", false);
    $("winMemo").dispatchEvent(new Event("input", { bubbles: true }));
    expect($("winSaved").hidden).toBe(true);
    // 次にクリアしたときは、「保存しました」は出ていない
    click("winSave");
    click("winNext");
    await h.app.whenIdle();
    solveTaking(h, 65000);
    expect($("winSaved").hidden).toBe(true);
    expect(($("winMemo") as HTMLInputElement).value).toBe("");
  });

  it("備考を保存できなければ、保存しましたとは出さない", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    kv.failWrites = true;
    typeInto($("winMemo"), "左下で迷った", false);
    click("winSave");
    expect(text("winSaved")).toBe("保存できませんでした。「記録」を見てください");
    expect($("recSaveError").hidden).toBe(false);
  });

  it("クリアの画面の難を押すと印が付き、もう一度押すと外れる", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    const key = recordKey(storedRecords(kv)[0] ?? A);
    expect($("winHard").getAttribute("aria-pressed")).toBe("false");
    click("winHard");
    expect($("winHard").getAttribute("aria-pressed")).toBe("true");
    expect(storedNotes(kv)).toEqual({ [key]: { hard: true } });
    click("winHard");
    expect($("winHard").getAttribute("aria-pressed")).toBe("false");
    expect(storedNotes(kv)).toEqual({});
  });

  it("何も書かずに次へ進むと、備考は付かない", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    click("winNext");
    await h.app.whenIdle();
    expect(storedRecords(kv)).toHaveLength(1);
    expect(storedNotes(kv)).toEqual({});
  });

  it("備考の文は、前後の空白と改行を除き、30 文字までにする", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    const key = recordKey(storedRecords(kv)[0] ?? A);
    typeInto($("winMemo"), "  左下で\n迷った  ");
    expect(storedNotes(kv)[key]).toEqual({ memo: "左下で迷った" });
    expect(($("winMemo") as HTMLInputElement).value).toBe("左下で迷った");
    typeInto($("winMemo"), "あ".repeat(40));
    expect(storedNotes(kv)[key]).toEqual({ memo: "あ".repeat(30) });
    // 画面の欄にも、30 文字の上限がある
    expect($("winMemo").getAttribute("maxlength")).toBe("30");
  });

  it("ほかのアプリに切り替えても、書きかけの備考は残る", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    solveTaking(h, 65000);
    typeInto($("winMemo"), "あとで見る", false);
    goBackground();
    const key = recordKey(storedRecords(kv)[0] ?? A);
    expect(storedNotes(kv)).toEqual({ [key]: { memo: "あとで見る" } });
  });
});

describe("記録の一覧から備考を書き直す", () => {
  it("記録の一覧の✎で、前の記録にもあとから備考を書ける", async () => {
    const kv = threeRecords();
    await start({ kv });
    click("recBtn");
    // 一番下の行が、6×6 かんたんの古い方（A）
    const rows = document.querySelectorAll<HTMLElement>("#recList tbody tr button.noteBtn");
    expect(rows[rows.length - 1]?.dataset.k).toBe(recordKey(A));
    clickNote(A);
    expect(document.activeElement).toBe(editor());
    typeInto(editor(), "サクサク解けた", false);
    clickInEditor("noteClose");
    expect(storedNotes(kv)).toEqual({ [recordKey(A)]: { memo: "サクサク解けた" } });
    expect(document.querySelector("#recList input.memoInput")).toBeNull();
    expect(remarkOf(A)).toBe("サクサク解けた");
    // 記録の形は変わらない
    expect(storedRecords(kv)).toEqual([A, A2, B]);
  });

  it("記録の一覧の✎で、備考を書き直したり消したりできる", async () => {
    const kv = withNotes([A], [[A, { memo: "左下で迷った", hard: true }]]);
    await start({ kv });
    click("recBtn");
    expect(remarkOf(A)).toBe("難 左下で迷った");
    clickNote(A);
    expect(editor().value).toBe("左下で迷った");
    expect(document.querySelector("#recList .hardBtn")?.getAttribute("aria-pressed")).toBe("true");
    typeInto(editor(), "");
    clickInEditor("noteClose");
    expect(remarkOf(A)).toBe("難");
    expect(storedNotes(kv)).toEqual({ [recordKey(A)]: { hard: true } });

    clickNote(A);
    clickInEditor("hardBtn");
    // 「難」を押しても、書く欄は開いたまま
    expect(document.querySelector("#recList .hardBtn")?.getAttribute("aria-pressed")).toBe("false");
    clickInEditor("noteClose");
    expect(remarkOf(A)).toBeNull();
    expect(storedNotes(kv)).toEqual({});
  });

  it("✎ をもう一度押すと、書く欄を閉じる", async () => {
    await start({ kv: threeRecords() });
    click("recBtn");
    clickNote(B);
    expect(editor()).not.toBeNull();
    expect(recordRow(B).querySelector(".noteBtn")?.getAttribute("aria-expanded")).toBe("true");
    clickNote(B);
    expect(document.querySelector("#recList input.memoInput")).toBeNull();
  });

  it("書く欄を開いているあいだに、ほかのタブで保存データが変わっても、書く欄は消えない", async () => {
    const kv = threeRecords();
    const h = await start({ kv });
    click("recBtn");
    clickNote(B);
    typeInto(editor(), "書きかけ", false);
    kv.setItem(MAIN_KEYS.notes, JSON.stringify({ [recordKey(A)]: { memo: "ほかのタブ" } }));
    h.notifyOtherTab();
    expect(editor().value).toBe("書きかけ");
    clickInEditor("noteClose");
    expect(remarkOf(A)).toBe("ほかのタブ");
    expect(remarkOf(B)).toBe("書きかけ");
  });
});

describe("備考を記録の一覧に出す", () => {
  it("備考は、記録の行のすぐ下に、難の印と文を並べて出す", async () => {
    const r0 = play(0, 300000);
    const r1 = play(1, 200000);
    const r2 = play(2, 100000);
    await start({
      kv: withNotes(
        [r0, r1, r2],
        [
          [r0, { memo: "左下で迷った", hard: true }],
          [r2, { memo: "サクサク" }],
        ],
      ),
    });
    click("recBtn");
    const rows = [...document.querySelectorAll<HTMLElement>("#recList tbody tr")].map((tr) =>
      tr.classList.contains("noteRow")
        ? `備考 ${tr.textContent}`
        : `記録 ${tr.querySelector<HTMLElement>(".noteBtn")?.dataset.k}`,
    );
    expect(rows).toEqual([
      `記録 ${recordKey(r2)}`,
      "備考 サクサク",
      `記録 ${recordKey(r1)}`,
      `記録 ${recordKey(r0)}`,
      "備考 難 左下で迷った",
    ]);
    expect(document.querySelector("#recList tr.noteRow .hard")?.textContent).toBe("難");
  });

  it("備考の文字は、HTML として扱わない", async () => {
    await start({ kv: withNotes([A], [[A, { memo: "<img src=x><b>太</b>" }]]) });
    click("recBtn");
    expect(remarkOf(A)).toBe("<img src=x><b>太</b>");
    expect($("recList").querySelector("img, b")).toBeNull();
    // 書く欄にも、文字のまま入る
    clickNote(A);
    expect(editor().value).toBe("<img src=x><b>太</b>");
    expect($("recList").querySelector("img, b")).toBeNull();
  });

  it("盤面ごとの並びでは、難が付いた盤面の行に難と出す", async () => {
    const a1 = play(0, 300000);
    const a2 = play(1, 200000);
    const b1 = play(2, 100000);
    const kv = withBoards([
      [a1, PA],
      [a2, PA],
      [b1, PB],
    ]);
    kv.setItem(
      MAIN_KEYS.notes,
      JSON.stringify({ [recordKey(a1)]: { hard: true }, [recordKey(b1)]: { memo: "楽勝" } }),
    );
    await start({ kv });
    click("recBtn");
    choose("recSort", "slow");
    const marks = [...document.querySelectorAll("#recList tbody tr")].map((tr) => [
      tr.querySelector(".bid")?.textContent,
      tr.querySelector(".hard")?.textContent ?? "",
    ]);
    expect(marks).toEqual([
      [idOf(PA), "難"],
      [idOf(PB), ""],
    ]);
    expect(text("recList")).not.toContain("楽勝");
    expect(document.querySelector("#recList button.noteBtn")).toBeNull();
  });
});

describe("前回の備考をクリアの画面に出す", () => {
  it("初めての盤面をクリアしたら、同じ大きさ・難しさの前回の備考を出す", async () => {
    const r = play(0, 300000);
    const h = await start({ kv: withNotes([r], [[r, { memo: "左下で迷った", hard: true }]]) });
    solveTaking(h, 60000);
    expect($("winPrevNote").hidden).toBe(false);
    expect(text("winPrevNote")).toBe("前回の備考: 難 左下で迷った");
  });

  it("同じ盤面をもう一度クリアしたら、その盤面の前回の備考を出す", async () => {
    const a1 = play(0, 300000);
    const b1 = play(1, 200000);
    const kv = withBoards([
      [a1, PA],
      [b1, PB],
    ]);
    kv.setItem(
      MAIN_KEYS.notes,
      JSON.stringify({
        [recordKey(a1)]: { memo: "左下で迷った" },
        [recordKey(b1)]: { memo: "楽勝" },
      }),
    );
    const h = await start({ kv });
    click("recBtn");
    clickPlay(idOf(PA));
    solveTaking(h, 90000);
    expect(text("winCompare")).toContain("この盤面 2 回目");
    expect(text("winPrevNote")).toBe("前回の備考: 左下で迷った");
  });

  it("前回の記録に備考が無ければ、前回の備考は出さない", async () => {
    const h = await start({ kv: withNotes([play(0, 300000)], []) });
    solveTaking(h, 60000);
    expect($("winPrevNote").hidden).toBe(true);
    expect(text("winPrevNote")).toBe("");
  });
});

describe("自動×を使ったかの印を残す", () => {
  it("自動×をONにして猫を置いてクリアすると、自動×の印が残る", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    setAutoX(true);
    solveTaking(h, 65000);
    expect(text("winText")).toMatch(/^8×8・ふつう　タイム 1:05　ヒント \d+回　自動×$/);
    const [r] = storedRecords(kv);
    if (r === undefined) throw new Error("記録がありません");
    expect(storedNotes(kv)).toEqual({ [recordKey(r)]: { autoX: true } });
    click("recBtn");
    expect(hintSubOf(r)).toBe("自動×");
    // 自動×の印だけなら、備考の行は出さない
    expect(remarkOf(r)).toBeNull();
  });

  it("途中で自動×をOFFにしても、ONのまま猫を置いていれば印が残る", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    setAutoX(true);
    placeOneCatWithHints();
    setAutoX(false);
    // 「戻す」「最初から」を押しても消えない
    click("undoBtn");
    click("resetBtn");
    click("resetBtn");
    solveTaking(h, 65000);
    expect(text("winText")).toContain("自動×");
    expect(Object.values(storedNotes(kv))).toEqual([{ autoX: true }]);
  });

  it("自動×をONにしても、猫を置く前にOFFにすれば印は付かない", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    setAutoX(true);
    setAutoX(false);
    solveTaking(h, 65000);
    expect(text("winText")).not.toContain("自動×");
    expect(storedNotes(kv)).toEqual({});
    click("recBtn");
    expect(hintSubOf(storedRecords(kv)[0] ?? A)).toBeNull();
  });

  it("遊びかけの盤面を開き直しても、自動×を使ったことは続く", async () => {
    const kv = new MemoryStorage();
    const first = await start({ kv });
    setAutoX(true);
    placeOneCatWithHints();
    setAutoX(false);
    first.app.stop();
    resetPage();
    const h = await start({ kv });
    expect(catsOnBoard()).toBeGreaterThan(0);
    solveTaking(h, 65000);
    expect(Object.values(storedNotes(kv))).toEqual([{ autoX: true }]);
  });

  it("新しい問題は、自動×の印の無い状態から始める", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    setAutoX(true);
    placeOneCatWithHints();
    setAutoX(false);
    click("newBtn");
    await h.app.whenIdle();
    solveTaking(h, 65000);
    expect(storedNotes(kv)).toEqual({});
  });

  it("自動×の印があっても、成績と前回との比べは分けない", async () => {
    const h = await start({ kv: withNotes([play(0, 300000)], []) });
    setAutoX(true);
    solveTaking(h, 180000);
    expect(text("winCompare")).toContain("前回より 2:00 速い　平均 4:00（2回）");
    click("recBtn");
    expect(summaryRows().find((r) => r[0] === "8×8 ふつう")?.[1]).toBe("2");
  });
});

describe("備考と印は、記録とは別のキーに置く", () => {
  it("備考と印は、記録とは別のキーに置き、記録の形は変えない", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    setAutoX(true);
    solveTaking(h, 65000);
    click("winHard");
    typeInto($("winMemo"), "左下で迷った");
    click("winNext");
    await h.app.whenIdle();
    const [r] = storedRecords(kv);
    if (r === undefined) throw new Error("記録がありません");
    expect(Object.keys(r)).toEqual(["at", "n", "d", "t", "h"]);
    expect(kv.getItem(MAIN_KEYS.notes)).toBe(
      `{"${recordKey(r)}":{"memo":"左下で迷った","hard":true,"autoX":true}}`,
    );
  });

  it("備考を知らない版が記録を保存し直しても、備考と印は残る", async () => {
    const r1 = play(0, 300000);
    const kv = withNotes([r1], [[r1, { memo: "左下で迷った" }]]);
    const notes = kv.getItem(MAIN_KEYS.notes);
    // 今配信している版は、5 つの値だけの形で記録を保存し直す
    kv.setItem(MAIN_KEYS.history, oldHistory([r1, play(1, 200000)]));
    await start({ kv });
    expect(kv.getItem(MAIN_KEYS.notes)).toBe(notes);
    click("recBtn");
    expect(remarkOf(r1)).toBe("左下で迷った");
  });

  it("別のタブで書いた備考を、古い写しで消さない", async () => {
    const kv = withNotes([A, B], []);
    await start({ kv });
    click("recBtn");
    // このタブがまだ知らないうちに、ほかのタブが A に備考を書く（storage の出来事は届いていない）
    kv.setItem(MAIN_KEYS.notes, JSON.stringify({ [recordKey(A)]: { memo: "一つ目" } }));
    clickNote(B);
    typeInto(editor(), "二つ目");
    clickInEditor("noteClose");
    expect(storedNotes(kv)).toEqual({
      [recordKey(A)]: { memo: "一つ目" },
      [recordKey(B)]: { memo: "二つ目" },
    });
    expect(remarkOf(A)).toBe("一つ目");
  });

  it("読めない備考の保存データは、消さずに別の場所に残す", async () => {
    const kv = withNotes([A], [], { [MAIN_KEYS.notes]: '{"1":' });
    await start({ kv });
    expect(kv.getItem(`${MAIN_KEYS.notes}-unreadable-${TODAY}`)).toBe('{"1":');
    click("recBtn");
    expect(listRows()).toHaveLength(1);
    expect($("recUnreadable").hidden).toBe(false);
    expect(text("recUnreadable")).toBe(
      "読めない記録がありました。消さずに別の場所に残してあります。くろに相談してください。",
    );
  });

  it("確かめ用のページは、備考と印を確かめ用のキーに置く", async () => {
    const kv = withNotes([A], [[A, { memo: "本物" }]]);
    const before = kv.getItem(MAIN_KEYS.notes);
    await start({ kv, trial: true });
    click("recBtn");
    expect(remarkOf(A)).toBe("本物");
    clickNote(A);
    typeInto(editor(), "確かめ");
    clickInEditor("noteClose");
    expect(storedNotes(kv, TRIAL_KEYS.notes)).toEqual({ [recordKey(A)]: { memo: "確かめ" } });
    expect(kv.getItem(MAIN_KEYS.notes)).toBe(before);
  });
});

describe("備考と印を書き出し・読み込みで移す", () => {
  /** ねこパッチの記録のファイル（版 1） */
  function fileOf(records: readonly object[], solvedCount = records.length): string {
    return JSON.stringify({ format: "nekopatch-records", version: 1, solvedCount, records });
  }

  it("書き出したファイルに、備考と印が入る", async () => {
    const r1 = play(0, 300000);
    const r2 = play(1, 200000);
    const h = await start({
      kv: withNotes([r1, r2], [[r1, { memo: "左下で迷った", hard: true, autoX: true }]]),
    });
    click("recBtn");
    click("recExport");
    const fileText = h.downloads[0]?.text ?? "";
    const lines = fileText.split("\n").filter((l) => l.includes('"at"'));
    expect(lines[0]).toContain('"memo":"左下で迷った","hard":true,"autoX":true');
    expect(lines[1]).not.toMatch(/memo|hard|autoX/);
    expect(JSON.parse(fileText).version).toBe(1);
  });

  it("読み込むと、書き出したスマホの備考と印が移る", async () => {
    const r1 = play(0, 300000);
    const r2 = play(1, 200000);
    const r3 = play(2, 100000);
    const first = await start({
      kv: withNotes(
        [r1, r2, r3],
        [
          [r1, { memo: "左下で迷った", hard: true }],
          [r2, { autoX: true }],
          [r3, { memo: "楽勝", autoX: true }],
        ],
      ),
    });
    click("recBtn");
    const rowsBefore = [...document.querySelectorAll("#recList tbody tr")].map(
      (tr) => tr.textContent,
    );
    click("recExport");
    const fileText = first.downloads[0]?.text ?? "";
    first.app.stop();
    resetPage();

    const h = await start({ kv: new MemoryStorage() });
    click("recBtn");
    await importFile(h, fileText);
    const rowsAfter = [...document.querySelectorAll("#recList tbody tr")].map(
      (tr) => tr.textContent,
    );
    expect(rowsAfter).toEqual(rowsBefore);
    expect(hintSubOf(r2)).toBe("自動×");
    expect(remarkOf(r1)).toBe("難 左下で迷った");
  });

  it("同じ記録があれば、今のスマホに備考が無いときだけファイルの備考を使う", async () => {
    const kv = withNotes([A, B], [[A, { memo: "今の" }]]);
    const h = await start({ kv });
    click("recBtn");
    await importFile(
      h,
      fileOf([
        { ...A, memo: "古い", hard: true, autoX: true },
        { ...B, memo: "楽勝" },
      ]),
    );
    expect(storedNotes(kv)).toEqual({
      [recordKey(A)]: { memo: "今の", autoX: true },
      [recordKey(B)]: { memo: "楽勝" },
    });
    expect(remarkOf(A)).toBe("今の");
    expect(hintSubOf(A)).toBe("自動×");
  });

  it("備考と印の無い前のファイルも読み込める", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    click("recBtn");
    await importFile(h, fileOf([A, B]));
    expect(text("recImportMsg")).toBe("記録を読み込みました。増えた記録は 2 件です。");
    expect(storedRecords(kv)).toEqual([A, B]);
    expect(storedNotes(kv)).toEqual({});
  });

  it("備考が読めないファイルは、何も読み込まない", async () => {
    const kv = withNotes([C], [[C, { memo: "今の" }]]);
    const before = new Map(kv.items);
    const h = await start({ kv });
    click("recBtn");
    await importFile(h, fileOf([A, { ...B, memo: 3 }]));
    expect(text("recImportMsg")).toBe(
      "このファイルは読み込めませんでした。今の記録はそのままです。",
    );
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before.get(MAIN_KEYS.history));
    expect(kv.getItem(MAIN_KEYS.notes)).toBe(before.get(MAIN_KEYS.notes));
  });
});

describe("記録を全部消すと、備考と印も消す", () => {
  it("記録を全部消すと、備考と印も消える", async () => {
    const kv = withNotes(
      [A, B],
      [
        [A, { memo: "左下で迷った", autoX: true }],
        [B, { autoX: true }],
      ],
    );
    await start({ kv });
    click("recBtn");
    click("recClear");
    click("recClearYes");
    expect(kv.getItem(MAIN_KEYS.history)).toBe("[]");
    expect(kv.getItem(MAIN_KEYS.notes)).toBe("{}");
  });
});

describe("備考の欄でのキー操作は、盤面の操作にしない", () => {
  it("備考の欄でnやhを打っても、新しい問題やヒントにならない", async () => {
    const h = await start({ kv: threeRecords() });
    // 遊びかけにする（ヒントで × か猫を 1 つ置く）
    click("hintBtn");
    click("applyBtn");
    const marks = boardMarks();
    const regions = boardRegions();
    click("recBtn");
    clickNote(B);
    for (const init of [
      { key: "n" },
      { key: "h" },
      { key: "z", ctrlKey: true },
      { key: "y", ctrlKey: true },
    ])
      editor().dispatchEvent(new KeyboardEvent("keydown", { ...init, bubbles: true }));
    await h.app.whenIdle();
    expect(boardRegions()).toEqual(regions);
    expect(boardMarks()).toEqual(marks);
    expect(text("hintCount")).toBe("1");
    // 欄の外では、今までどおりキーで操作できる
    document.body.dispatchEvent(new KeyboardEvent("keydown", { key: "h", bubbles: true }));
    expect(text("hintCount")).toBe("2");
  });

  it("備考の欄で決定を押すと、欄から外れて保存する", async () => {
    const kv = threeRecords();
    await start({ kv });
    click("recBtn");
    clickNote(B);
    const input = editor();
    input.value = "決定で保存";
    let blurred = false;
    input.addEventListener("blur", () => {
      blurred = true;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    expect(blurred).toBe(true);
    expect(storedNotes(kv)).toEqual({ [recordKey(B)]: { memo: "決定で保存" } });
  });
});

describe("今までの記録を引き継ぐ（自動×の欄）", () => {
  const OLD_FIELDS = ["P", "st", "elapsed", "won", "solvedCount", "hints", "autoX", "size", "diff"];

  it("自動×を使っていない遊びかけの盤面は、作り直す前と同じ欄で保存する", async () => {
    const kv = new MemoryStorage();
    await start({ kv });
    click("hintBtn");
    click("applyBtn");
    expect(Object.keys(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "{}"))).toEqual(OLD_FIELDS);
  });

  it("自動×を使った遊びかけの盤面は、欄を 1 つ足して保存し、前の版も読める", async () => {
    const kv = new MemoryStorage();
    await start({ kv });
    setAutoX(true);
    placeOneCatWithHints();
    const raw = kv.getItem(MAIN_KEYS.game) ?? "{}";
    const saved = JSON.parse(raw);
    expect(Object.keys(saved)).toEqual([...OLD_FIELDS, "autoXUsed"]);
    expect(saved.autoXUsed).toBe(true);
    expect(parseSavedGame(raw).game?.playing?.autoXUsed).toBe(true);
    // 前の版は、足した欄を読み飛ばす。足した欄を除いた値も、同じ遊びかけの盤面として読める
    const { autoXUsed: _, ...old } = saved;
    const asOld = parseSavedGame(JSON.stringify(old));
    expect(asOld.intact).toBe(true);
    expect(asOld.game?.playing?.st).toEqual(saved.st);
    expect(asOld.game?.playing?.autoXUsed).toBe(false);
  });
});

// ---------- 盤面をほかの人と共有する（share-board） ----------

/** 盤面 p（難しさ d）を送るリンクの # の後ろ。sender は送った人のタイム（秒）とヒントの回数。null ならタイムの無いリンク */
function linkOf(
  p: Puzzle,
  sender: { readonly t: number; readonly h: number } | null = { t: 205, h: 0 },
  d = 2,
): string {
  const base = `n=${p.N}&d=${d}&b=${codeOf(p)}`;
  return sender === null ? base : `${base}&t=${sender.t}&h=${sender.h}`;
}
/** 共有の画面に渡した最後の文の行 */
function lastShared(h: Harness): string[] {
  const t = h.shares[h.shares.length - 1];
  if (t === undefined) throw new Error("共有の画面に何も渡していません");
  return t.split("\n");
}
function storedReceived(kv: MemoryStorage, key = MAIN_KEYS.received): Record<string, unknown> {
  return JSON.parse(kv.getItem(key) ?? "{}");
}
/** 盤面のマス i を指で 1 回押す（空白 → ×、× → 猫、猫 → 空白） */
function tapCell(i: number): void {
  const board = $("board");
  const cell = board.querySelectorAll<HTMLElement>(".cell")[i] ?? null;
  const original = document.elementFromPoint;
  document.elementFromPoint = () => cell;
  board.dispatchEvent(new PointerEvent("pointerdown", { pointerId: 1, button: 0, bubbles: true }));
  board.dispatchEvent(new PointerEvent("pointerup", { pointerId: 1, button: 0, bubbles: true }));
  document.elementFromPoint = original;
}
/** 盤面 p の答えでないマス（× を付けてもよいマス） */
function notSolution(p: Puzzle): number[] {
  const sol = [...solutionCells(p)];
  return [...Array(p.N * p.N).keys()].filter((i) => !sol.includes(i));
}
/** ヒントを使わずに、今の盤面 p を ms かけて解く（答えのマスを 2 回ずつ押して猫を置く） */
function solveByHand(h: Harness, p: Puzzle, ms: number): void {
  h.clock.now += ms;
  for (const i of solutionCells(p)) {
    tapCell(i);
    tapCell(i);
  }
  expect($("win").hidden).toBe(false);
}
/** 送られてきた盤面の案内の「この盤面を遊ぶ」を押す */
function playShared(): void {
  expect($("shared").hidden).toBe(false);
  click("sharedPlay");
}
/** 一覧の行 tr の「送る」を押す */
function clickSend(tr: Element): void {
  const btn = tr.querySelector<HTMLButtonElement>("button.send");
  if (btn === null) throw new Error("「送る」がありません");
  btn.click();
}
/** 新しい順の一覧で、記録 r の行のすぐ下の、もらった盤面の行の文字。無ければ null */
function receivedOf(r: ClearRecord): string | null {
  return recordRow(r).nextElementSibling?.querySelector("td.receivedNote")?.textContent ?? null;
}
/** 盤面 A を送ってくれた人の印（3:25・ヒント 0 回）がある記録 r */
function receivedA(r: ClearRecord): Record<string, string> {
  return {
    [MAIN_KEYS.received]: JSON.stringify({
      [recordKey(r)]: { senderTime: 205000, senderHints: 0 },
    }),
  };
}

describe("盤面を送る文とリンク", () => {
  it("クリアの画面の、この盤面を送るで、タイムとヒントを付けて送る", async () => {
    const h = await start();
    const p = fixedPuzzle(8, 2, 0);
    solveByHand(h, p, 205800);
    click("winShare");
    await h.app.whenIdle();
    expect(lastShared(h)).toEqual([
      `ねこパッチの盤面 ${idOf(p)}（8×8・ふつう）`,
      "3:25・ヒント 0 回でクリア。挑戦してみて！",
      `${PAGE}?openExternalBrowser=1#n=8&d=2&b=${codeOf(p)}&t=205&h=0`,
    ]);
  });

  it("送る文とリンクには、日時と備考を入れない", async () => {
    const r: ClearRecord = { at: TODAY, n: 8, d: 2, t: 90000, h: 1 };
    const kv = withBoards([[r, PA]], {
      [MAIN_KEYS.notes]: JSON.stringify({ [recordKey(r)]: { memo: "左下で迷った", hard: true } }),
    });
    const h = await start({ kv });
    click("recBtn");
    clickSend(recordRow(r));
    await h.app.whenIdle();
    const sent = h.shares.join("\n");
    expect(sent).toContain(idOf(PA));
    for (const word of ["左下で迷った", "難", "10/22", "10:00", String(TODAY)])
      expect(sent).not.toContain(word);
  });
});

describe("盤面を送る場所", () => {
  it("遊んでいる途中に送ると、タイムの代わりにこれ解ける？と書く", async () => {
    const h = await start();
    const p = fixedPuzzle(8, 2, 0);
    for (const i of notSolution(p).slice(0, 2)) tapCell(i);
    h.clock.now += 70000;
    click("shareBtn");
    await h.app.whenIdle();
    expect(lastShared(h)).toEqual([
      `ねこパッチの盤面 ${idOf(p)}（8×8・ふつう）`,
      "これ解ける？",
      `${PAGE}?openExternalBrowser=1#n=8&d=2&b=${codeOf(p)}`,
    ]);
  });

  it("記録の一覧の新しい順の行からは、その回のタイムを付けて送る", async () => {
    const a1 = play(0, 300000, 2);
    const a2 = play(1, 90000, 0);
    const h = await start({
      kv: withBoards([
        [a1, PA],
        [a2, PA],
      ]),
    });
    click("recBtn");
    clickSend(recordRow(a2));
    await h.app.whenIdle();
    const [, body, link] = lastShared(h);
    expect(body).toBe("1:30・ヒント 0 回でクリア。挑戦してみて！");
    expect(link?.endsWith("&t=90&h=0")).toBe(true);
  });

  it("盤面ごとの行からは、初回のタイムを付けて送る", async () => {
    const a1 = play(0, 300000, 2);
    const a2 = play(1, 90000, 0);
    const h = await start({
      kv: withBoards([
        [a1, PA],
        [a2, PA],
      ]),
    });
    click("recBtn");
    choose("recSort", "slow");
    const [row] = document.querySelectorAll("#recList tbody tr");
    if (row === undefined) throw new Error("行がありません");
    clickSend(row);
    await h.app.whenIdle();
    const [, body, link] = lastShared(h);
    expect(body).toBe("5:00・ヒント 2 回でクリア。挑戦してみて！");
    expect(link?.endsWith("&t=300&h=2")).toBe(true);
  });

  it("盤面の形が無い記録の行には、送るが出ない", async () => {
    const old = play(0, 100000);
    const nw = play(1, 120000);
    await start({
      kv: withBoards([
        [old, null],
        [nw, PA],
      ]),
    });
    click("recBtn");
    expect(document.querySelectorAll("#recList button.send")).toHaveLength(1);
    expect(recordRow(nw).querySelector("button.send")).not.toBeNull();
    expect(recordRow(old).querySelector("button.send")).toBeNull();
  });
});

describe("共有の画面が無ければ、文を写す", () => {
  it("写したら、写しましたと出す", async () => {
    const h = await start({ shareResult: "copied" });
    solveTaking(h, 65000);
    click("winShare");
    await h.app.whenIdle();
    expect($("winShareMsg").hidden).toBe(false);
    expect(text("winShareMsg")).toBe(SHARE_MESSAGES.copied);
    expect(SHARE_MESSAGES.copied).toBe("写しました。LINE などに貼ってください。");
  });

  it("共有の画面で送るか閉じたら、何も出さない", async () => {
    for (const shareResult of ["shared", "cancelled"] as const) {
      resetPage();
      const h = await start({ shareResult });
      solveTaking(h, 65000);
      click("winShare");
      await h.app.whenIdle();
      expect(h.shares).toHaveLength(1);
      expect($("winShareMsg").hidden).toBe(true);
      h.app.stop();
    }
  });

  it("送れなければ、送れませんでしたと出す", async () => {
    const r = play(0, 100000);
    const h = await start({ shareResult: "failed", kv: withBoards([[r, PA]]) });
    click("recBtn");
    clickSend(recordRow(r));
    await h.app.whenIdle();
    expect($("recPlayMsg").hidden).toBe(false);
    expect(text("recPlayMsg")).toBe("送れませんでした。くろに相談してください。");
  });

  it("盤面の下の送るで写したら、盤面の下に写しましたと出す", async () => {
    const h = await start({ shareResult: "copied" });
    click("shareBtn");
    await h.app.whenIdle();
    expect(text("msgText")).toBe(SHARE_MESSAGES.copied);
  });
});

describe("リンクを開くと、送られてきた盤面の案内を出す", () => {
  it("リンクを開くと、送られてきた盤面と送ってくれた人のタイムが出る", async () => {
    await start({ link: linkOf(PA) });
    expect($("shared").hidden).toBe(false);
    expect($("shared").querySelector("h2")?.textContent).toBe("送られてきた盤面");
    expect(text("sharedBoard")).toBe(`8×8・ふつう　${idOf(PA)}`);
    expect($("sharedSender").hidden).toBe(false);
    expect(text("sharedSender")).toBe("送ってくれた人: 3:25・ヒント 0 回");
    expect($("sharedBusy").hidden).toBe(true);
    expect($("sharedPlay").hidden).toBe(false);
    expect(text("sharedPlay")).toBe("この盤面を遊ぶ");
    expect(text("sharedNo")).toBe("やめる");
  });

  it("タイムの無いリンクでは、送ってくれた人のタイムを出さない", async () => {
    await start({ link: linkOf(PA, null) });
    expect($("shared").hidden).toBe(false);
    expect(text("sharedBoard")).toBe(`8×8・ふつう　${idOf(PA)}`);
    expect($("sharedSender").hidden).toBe(true);
  });

  it("この盤面を遊ぶで、送られてきた盤面を最初から遊べる", async () => {
    const kv = new MemoryStorage({ [MAIN_KEYS.game]: oldGame({ size: "6", diff: "1" }) });
    await start({ kv, link: linkOf(PA) });
    expect(document.querySelectorAll("#board .cell")).toHaveLength(36);
    playShared();
    expect($("shared").hidden).toBe(true);
    expect(boardRegions()).toEqual(PA.reg);
    expect(boardMarks().every((v) => v === "")).toBe(true);
    expect(text("timer")).toBe("0:00");
    expect(text("hintCount")).toBe("0");
    expect(($("size") as HTMLSelectElement).value).toBe("8");
    expect(($("diff") as HTMLSelectElement).value).toBe("2");
  });

  it("遊びかけの盤面があれば、やめになることを書き添える", async () => {
    const h = await start();
    const [x = 0] = notSolution(fixedPuzzle(8, 2, 0));
    tapCell(x);
    await h.openLink(linkOf(PA));
    expect($("sharedBusy").hidden).toBe(false);
    expect(text("sharedBusy")).toBe(SHARED_MESSAGES.busy);
    expect(SHARED_MESSAGES.busy).toBe("遊ぶと、今の遊びかけの盤面はやめになります。");
    playShared();
    expect(boardRegions()).toEqual(PA.reg);
  });

  it("やめるを押すと、今の盤面のまま、止めていた時間から続ける", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv });
    const p = fixedPuzzle(8, 2, 0);
    const [x = 0] = notSolution(p);
    tapCell(x);
    h.clock.now += 60000;
    await h.openLink(linkOf(PA));
    h.clock.now += 30000;
    click("sharedNo");
    expect($("shared").hidden).toBe(true);
    expect(boardRegions()).toEqual(p.reg);
    expect(boardMarks().filter((v) => v === "x")).toHaveLength(1);
    // 案内を出していた 30 秒は入らず、閉じたあとの 10 秒は入る
    h.clock.now += 10000;
    goBackground();
    expect(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "{}").elapsed).toBe(70000);
  });

  it("開けないリンクは、開けませんでしたと出す", async () => {
    const kv = new MemoryStorage({ [MAIN_KEYS.game]: oldGame({ size: "6", diff: "1" }) });
    const h = await start({ kv });
    await h.openLink(`n=8&d=2&b=${codeOf(PA).slice(1)}&t=205&h=0`);
    expect($("shared").hidden).toBe(false);
    expect($("shared").querySelector("h2")?.textContent).toBe("送られてきた盤面");
    expect(text("sharedBoard")).toBe("このリンクの盤面は開けませんでした。");
    expect(SHARED_MESSAGES.broken).toBe("このリンクの盤面は開けませんでした。");
    expect($("sharedPlay").hidden).toBe(true);
    expect($("sharedSender").hidden).toBe(true);
    expect(text("sharedNo")).toBe("閉じる");
    click("sharedNo");
    expect($("shared").hidden).toBe(true);
    expect(document.querySelectorAll("#board .cell")).toHaveLength(36);
    expect(($("size") as HTMLSelectElement).value).toBe("6");
  });

  it("ゲームを開いたまま別のリンクを開いても、案内が出る", async () => {
    const h = await start();
    expect($("shared").hidden).toBe(true);
    await h.openLink(linkOf(PA));
    expect($("shared").hidden).toBe(false);
    expect(text("sharedBoard")).toBe(`8×8・ふつう　${idOf(PA)}`);
  });
});

describe("もらった盤面をクリアしたら、送ってくれた人と比べる", () => {
  /** 盤面 A の 3:25・ヒント 0 回のリンクから遊び、ms かけてクリアしたときの比べの文 */
  async function versusAfter(
    ms: number,
    sender: { t: number; h: number } | null = { t: 205, h: 0 },
  ) {
    const h = await start({ link: linkOf(PA, sender) });
    playShared();
    solveByHand(h, PA, ms);
    return $("winVersus").hidden ? null : text("winVersus");
  }

  it("送ってくれた人より速ければ、速いと出す", async () => {
    expect(await versusAfter(175000)).toBe("送ってくれた人（3:25）より 0:30 速い！");
  });

  it("送ってくれた人より遅ければ、遅いと出す", async () => {
    expect(await versusAfter(240000)).toBe("送ってくれた人（3:25）より 0:35 遅い");
  });

  it("画面のタイムが同じなら、同じタイムと出す", async () => {
    expect(await versusAfter(205900)).toBe("送ってくれた人（3:25）と同じタイム！");
  });

  it("タイムの無いリンクの盤面は、送ってくれた人と比べない", async () => {
    expect(await versusAfter(175000, null)).toBeNull();
  });

  it("もらった盤面の途中でページを閉じても、続きから送ってくれた人と比べる", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv, link: linkOf(PA) });
    playShared();
    const [x = 0] = notSolution(PA);
    tapCell(x);
    h.app.stop();
    resetPage();
    const again = await start({ kv });
    expect(boardRegions()).toEqual(PA.reg);
    solveByHand(again, PA, 175000);
    expect(text("winVersus")).toBe("送ってくれた人（3:25）より 0:30 速い！");
  });

  it("もらった盤面のもう一度この盤面は、もらった盤面としない", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv, link: linkOf(PA) });
    playShared();
    solveByHand(h, PA, 100000);
    expect($("winVersus").hidden).toBe(false);
    click("winRetry");
    solveByHand(h, PA, 120000);
    expect($("winVersus").hidden).toBe(true);
    const [first, second] = storedRecords(kv);
    if (first === undefined || second === undefined) throw new Error("記録が 2 件ありません");
    click("recBtn");
    expect(receivedOf(first)).not.toBeNull();
    expect(receivedOf(second)).toBeNull();
  });
});

describe("もらった盤面の記録は、今までと同じ決まりで数える", () => {
  it("もらった盤面の記録は、初めての盤面として数える", async () => {
    const kv = withBoards([[play(0, 300000), null]], {
      [MAIN_KEYS.game]: oldGame({ solvedCount: 10 }),
    });
    const h = await start({ kv, link: linkOf(PA) });
    expect(text("solved")).toBe("10");
    playShared();
    solveByHand(h, PA, 180000);
    expect(text("solved")).toBe("11");
    click("recBtn");
    const row = summaryRows().find((r) => r[0] === "8×8 ふつう");
    expect(row?.[1]).toBe("2");
    expect(row?.[2]).toBe("4:00");
  });

  it("前に遊んだ盤面のリンクなら、もう一度遊んだ記録になる", async () => {
    const kv = withBoards([[play(0, 300000), PA]], {
      [MAIN_KEYS.game]: oldGame({ solvedCount: 1 }),
    });
    const h = await start({ kv, link: linkOf(PA, { t: 240, h: 0 }) });
    playShared();
    solveByHand(h, PA, 180000);
    expect(text("winCompare")).toBe(
      "この盤面の自己ベスト！　この盤面 2 回目　前回より 2:00 速い　ベスト 3:00",
    );
    expect(text("solved")).toBe("1");
  });
});

describe("記録の一覧に、もらった盤面と出す", () => {
  it("もらった盤面の記録の行に、送ってくれた人のタイムを出す", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv, link: linkOf(PA) });
    playShared();
    solveByHand(h, PA, 295000);
    const [r] = storedRecords(kv);
    if (r === undefined) throw new Error("記録がありません");
    click("recBtn");
    expect(receivedOf(r)).toBe("もらった盤面（送ってくれた人 3:25・ヒント 0 回）");
  });

  it("タイムの無いリンクの盤面の行には、もらった盤面とだけ出す", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv, link: linkOf(PA, null) });
    playShared();
    solveByHand(h, PA, 95000);
    const [r] = storedRecords(kv);
    if (r === undefined) throw new Error("記録がありません");
    click("recBtn");
    expect(receivedOf(r)).toBe("もらった盤面");
  });
});

describe("もらった盤面の印は、記録とは別のキーに置く", () => {
  it("もらった盤面の印は、記録とは別のキーに置く", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv, link: linkOf(PA) });
    playShared();
    solveByHand(h, PA, 95000);
    const [r] = storedRecords(kv);
    if (r === undefined) throw new Error("記録がありません");
    expect(Object.keys(r)).toEqual(["at", "n", "d", "t", "h"]);
    expect(storedReceived(kv)).toEqual({
      [recordKey(r)]: { senderTime: 205000, senderHints: 0 },
    });
  });

  it("読めないもらった盤面の保存データは、消さずに別の場所に残す", async () => {
    const kv = new MemoryStorage({
      [MAIN_KEYS.history]: oldHistory([C]),
      [MAIN_KEYS.received]: '{"1":',
    });
    await start({ kv });
    expect(kv.getItem(`${MAIN_KEYS.received}-unreadable-${TODAY}`)).toBe('{"1":');
    click("recBtn");
    expect(listRows()).toHaveLength(1);
    expect(document.querySelector("#recList td.receivedNote")).toBeNull();
    expect($("recUnreadable").hidden).toBe(false);
    expect(text("recUnreadable")).toBe(
      "読めない記録がありました。消さずに別の場所に残してあります。くろに相談してください。",
    );
  });

  it("確かめ用のページは、もらった盤面の印を確かめ用のキーに置き、確かめ用のリンクを送る", async () => {
    const kv = new MemoryStorage();
    const h = await start({ kv, trial: true, link: linkOf(PA) });
    playShared();
    solveByHand(h, PA, 95000);
    click("winShare");
    await h.app.whenIdle();
    expect(Object.keys(storedReceived(kv, TRIAL_KEYS.received))).toHaveLength(1);
    expect(kv.getItem(MAIN_KEYS.received)).toBeNull();
    expect(lastShared(h)[2]?.startsWith(`${TRIAL_PAGE}?openExternalBrowser=1#n=8&d=2&b=`)).toBe(
      true,
    );
  });
});

describe("もらった盤面の印を、書き出し・読み込みで移し、全部消すと消す", () => {
  const r1 = play(0, 295000);
  const r2 = play(1, 120000);

  it("書き出したファイルに、もらった盤面の印が入る", async () => {
    const h = await start({
      kv: withBoards(
        [
          [r1, PA],
          [r2, PB],
        ],
        receivedA(r1),
      ),
    });
    click("recBtn");
    click("recExport");
    const file = JSON.parse(h.downloads[0]?.text ?? "{}");
    expect(file.version).toBe(1);
    expect(file.records[0].received).toEqual({ senderTime: 205000, senderHints: 0 });
    expect(file.records[1]).not.toHaveProperty("received");
    expect(h.downloads[0]?.text).toContain('"received":{"senderTime":205000,"senderHints":0}');
  });

  it("読み込むと、もらった盤面の印も移る", async () => {
    const file = JSON.stringify({
      format: "nekopatch-records",
      version: 1,
      solvedCount: 1,
      records: [{ ...r1, b: codeOf(PA), received: { senderTime: 205000, senderHints: 0 } }],
    });
    const h = await start();
    click("recBtn");
    await importFile(h, file);
    expect(receivedOf(r1)).toBe("もらった盤面（送ってくれた人 3:25・ヒント 0 回）");
  });

  it("もらった盤面の印が読めないファイルは、何も読み込まない", async () => {
    const kv = threeRecords();
    const before = kv.getItem(MAIN_KEYS.history);
    const file = JSON.stringify({
      format: "nekopatch-records",
      version: 1,
      solvedCount: 1,
      records: [{ ...C, received: { senderTime: -1, senderHints: 0 } }],
    });
    const h = await start({ kv });
    click("recBtn");
    await importFile(h, file);
    expect(text("recImportMsg")).toBe(IMPORT_MESSAGES.unreadable);
    expect(kv.getItem(MAIN_KEYS.history)).toBe(before);
    expect(kv.getItem(MAIN_KEYS.received)).toBeNull();
  });

  it("記録を全部消すと、もらった盤面の印も消える", async () => {
    const kv = withBoards([[r1, PA]], receivedA(r1));
    await start({ kv });
    click("recBtn");
    click("recClear");
    click("recClearYes");
    expect(kv.getItem(MAIN_KEYS.history)).toBe("[]");
    expect(kv.getItem(MAIN_KEYS.received)).toBe("{}");
  });
});

describe("今までの記録を引き継ぐ（もらった盤面の欄）", () => {
  /** 作り直す前の版が保存していた欄 */
  const OLD_FIELDS = ["P", "st", "elapsed", "won", "solvedCount", "hints", "autoX", "size", "diff"];

  it("もらった盤面の遊びかけは、欄を 1 つ足して保存し、前の版も読める", async () => {
    const kv = new MemoryStorage();
    await start({ kv, link: linkOf(PA) });
    playShared();
    const [x = 0] = notSolution(PA);
    tapCell(x);
    const raw = kv.getItem(MAIN_KEYS.game) ?? "{}";
    const saved = JSON.parse(raw);
    expect(Object.keys(saved)).toEqual([...OLD_FIELDS, "received"]);
    expect(saved.received).toEqual({ senderTime: 205000, senderHints: 0 });
    expect(parseSavedGame(raw).game?.playing?.received).toEqual({
      sender: { time: 205000, hints: 0 },
    });
    // 前の版は、足した欄を読み飛ばす。足した欄を除いた値も、同じ遊びかけの盤面として読める
    const { received: _, ...old } = saved;
    const asOld = parseSavedGame(JSON.stringify(old));
    expect(asOld.intact).toBe(true);
    expect(asOld.game?.playing?.st).toEqual(saved.st);
    expect(asOld.game?.playing?.received).toBeNull();
  });

  it("もらった盤面でない遊びかけには、もらった盤面の欄を書かない", async () => {
    const kv = new MemoryStorage();
    await start({ kv });
    const [x = 0] = notSolution(fixedPuzzle(8, 2, 0));
    tapCell(x);
    expect(Object.keys(JSON.parse(kv.getItem(MAIN_KEYS.game) ?? "{}"))).toEqual(OLD_FIELDS);
  });
});
