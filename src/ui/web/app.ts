// 画面の動き。元の nekopatch.html（2026-10-21 に受け取ったもの）の画面の処理を写したもの。
// 遊び方と見た目は変えない（ナンとの合意 2026-10-21 の 6）。足したのは「記録」の画面の、保存の状態と書き出し・読み込み。
// 2026-10-23 に、同じ盤面をもう一度遊ぶ仕組み（記録の一覧の「遊ぶ」、並べ替え、クリアの画面の「もう一度この盤面」）を足した。
// ブラウザの機能（保存、問題作りの Worker、保存領域の頼み、ファイルの書き出し）は env を通して使い、テストでは偽物に差し替える。

import {
  attacks,
  type BoardSort,
  boardRows,
  type Category,
  type CellState,
  type ClearRecord,
  compareWin,
  conflicts,
  encodeBoard,
  exportFileName,
  exportText,
  formatTime as fmt,
  historyRows,
  importRecords,
  LEVEL_NAMES,
  LEVELS,
  nextHint,
  type PlayingPuzzle,
  type Puzzle,
  parseExport,
  REGION_NAMES,
  recordKey,
  restorePuzzle,
  SIZES,
  summarize,
} from "../../core/index.ts";
import {
  type PersistApi,
  type PersistState,
  persistMessage,
  requestPersist,
} from "./persistence.ts";
import type { SaveStore } from "./save-store.ts";

export interface AppEnv {
  readonly store: SaveStore;
  /** 確かめ用のページか */
  readonly trial: boolean;
  /** 問題を作る（Worker で作る。ページの動きを止めないため） */
  generate(N: number, diff: number): Promise<Puzzle>;
  readonly persistApi: PersistApi | undefined;
  /** 文字をファイルにして、端末に保存させる */
  download(fileName: string, text: string): void;
  /** ほかのタブ（ホーム画面のアプリを含む）が保存データを書き換えたら、listener を呼ぶ */
  onStorageChange(listener: () => void, signal: AbortSignal): void;
  now(): number;
}

export interface App {
  /** 進行中の処理（問題作り、保存領域の頼み、ファイルの読み込み）が終わるのを待つ。テスト用 */
  whenIdle(): Promise<void>;
  /** 時計と、文書全体へのつなぎ（キー操作など）を止める。テスト用 */
  stop(): void;
}

const DEFAULT_MESSAGE =
  "クリックで ×、もう一度で 猫、もう一度で 空白。<b>なぞると×を一気に</b>付けられます。";

export const IMPORT_MESSAGES = {
  unreadable: "このファイルは読み込めませんでした。今の記録はそのままです。",
  saveFailed: "記録を保存できませんでした。今の記録はそのままです。",
  noneAdded: "記録を読み込みました。同じ記録がもう入っていたので、増えた記録はありません。",
  added: (n: number) => `記録を読み込みました。増えた記録は ${n} 件です。`,
} as const;

export const PLAY_MESSAGES = {
  confirm: "もう一度押すと、遊びかけの盤面をやめて、この盤面を始めます。",
  broken: "この盤面は遊べませんでした。くろに相談してください。",
} as const;

/** 記録の一覧を、何行ずつ出すか */
const LIST_PAGE = 30;
/** 遊びかけのときの「遊ぶ」の確かめを、何ミリ秒待つか */
const PLAY_CONFIRM_MS = 5000;

/** 記録の一覧の並び。new は新しい順（1 回 1 行）、ほかは盤面ごと */
type ListSort = "new" | BoardSort;

type DragMode = "paint" | "erase" | "pendX" | "pendCat";

export function startApp(doc: Document, env: AppEnv): App {
  function $<T extends HTMLElement = HTMLElement>(id: string): T {
    const el = doc.getElementById(id);
    if (el === null) throw new Error(`画面に #${id} がありません`);
    return el as T;
  }
  const boardEl = $("board");
  const sizeSel = $<HTMLSelectElement>("size");
  const diffSel = $<HTMLSelectElement>("diff");
  const autoX = $<HTMLInputElement>("autoX");
  const applyBtn = $<HTMLButtonElement>("applyBtn");
  const recPanel = $("recPanel");
  const recFile = $<HTMLInputElement>("recFile");
  const recSort = $<HTMLSelectElement>("recSort");
  const recFilter = $<HTMLSelectElement>("recFilter");

  const pending = new Set<Promise<unknown>>();
  const stopped = new AbortController();
  const listen = { signal: stopped.signal };
  function track(p: Promise<unknown>): void {
    pending.add(p);
    p.finally(() => pending.delete(p)).catch(() => {});
  }

  // ---------- 問題作り ----------
  const cache = new Map<string, Promise<Puzzle>>();
  function prefetch(N: number, diff: number): void {
    const k = `${N}-${diff}`;
    if (!cache.has(k)) cache.set(k, env.generate(N, diff));
  }
  function takePuzzle(N: number, diff: number): Promise<Puzzle> {
    const k = `${N}-${diff}`;
    const p = cache.get(k) ?? env.generate(N, diff);
    cache.delete(k);
    return p;
  }

  // ---------- 状態 ----------
  let P: PlayingPuzzle | null = null;
  let st: CellState[] = [];
  let undo: CellState[][] = [];
  let redo: CellState[][] = [];
  let elapsed = 0;
  let startT = 0;
  let running = false;
  let won = false;
  let solvedCount = 0;
  let cellsEl: HTMLDivElement[] = [];
  let pendingStep: { readonly cells: readonly number[]; readonly to: 1 | 2 } | null = null;
  let hints = 0;
  let records: ClearRecord[] = env.store.loadRecords();
  let boards: Map<string, string> = env.store.loadBoards();
  let saveFailed = false;
  /** 問題作りの頼みの番号。あとから別の盤面を始めたら、前に頼んだ問題は使わない */
  let puzzleRequest = 0;
  let persistState: PersistState | null = null;

  const cellState = (i: number): CellState => st[i] ?? 0;
  const cellEl = (i: number): HTMLDivElement | undefined => cellsEl[i];

  function markSaved(ok: boolean): void {
    if (!ok) saveFailed = true;
    $("recSaveError").hidden = !saveFailed;
  }

  /**
   * ほかのタブで増えた記録とクリアの数を取り込む。同じゲームを 2 つのタブで開いていても、
   * 片方の古い写しで、もう片方の記録を上書きしないため（記録は保存してあるものが一番新しい）
   */
  function syncFromStore(): void {
    records = env.store.loadRecords();
    boards = env.store.loadBoards();
    solvedCount = Math.max(solvedCount, env.store.storedSolvedCount());
    $("solved").textContent = String(solvedCount);
  }

  function save(): void {
    solvedCount = Math.max(solvedCount, env.store.storedSolvedCount());
    markSaved(
      env.store.saveGame({
        puzzle: P,
        st,
        elapsed: curElapsed(),
        won,
        solvedCount,
        hints,
        autoX: autoX.checked,
        size: Number(sizeSel.value),
        diff: Number(diffSel.value),
      }),
    );
  }

  function curElapsed(): number {
    return elapsed + (running ? env.now() - startT : 0);
  }
  const timer = setInterval(() => {
    $("timer").textContent = fmt(curElapsed());
  }, 500);
  function startTimer(): void {
    if (!running && !won) {
      running = true;
      startT = env.now();
    }
  }
  function stopTimer(): void {
    if (running) {
      elapsed += env.now() - startT;
      running = false;
    }
  }
  doc.addEventListener(
    "visibilitychange",
    () => {
      if (doc.hidden) {
        stopTimer();
        save();
      } else if (P !== null && !won) startTimer();
    },
    listen,
  );

  // ---------- 描く ----------
  function buildBoard(p: PlayingPuzzle): void {
    const N = p.N;
    boardEl.style.setProperty("--n", String(N));
    boardEl.innerHTML = "";
    cellsEl = [];
    const E = "var(--edge)";
    const w = N >= 9 ? 2.5 : 3;
    const regAt = (i: number) => p.reg[i];
    for (let i = 0; i < N * N; i++) {
      const r = Math.floor(i / N);
      const c = i % N;
      const g = regAt(i);
      const d = doc.createElement("div");
      d.className = "cell";
      d.dataset.i = String(i);
      d.setAttribute("role", "gridcell");
      d.style.background = `var(--r${g})`;
      const sh = ["inset 0 0 0 .5px rgba(0,0,0,.18)"];
      if (r > 0 && regAt(i - N) !== g) sh.push(`inset 0 ${w}px 0 ${E}`);
      if (r < N - 1 && regAt(i + N) !== g) sh.push(`inset 0 -${w}px 0 ${E}`);
      if (c > 0 && regAt(i - 1) !== g) sh.push(`inset ${w}px 0 0 ${E}`);
      if (c < N - 1 && regAt(i + 1) !== g) sh.push(`inset -${w}px 0 0 ${E}`);
      d.style.boxShadow = sh.join(",");
      boardEl.appendChild(d);
      cellsEl.push(d);
    }
  }

  function render(popSet?: ReadonlySet<number>): void {
    if (P === null) return;
    const p = P;
    const { bad, count } = conflicts(p, st);
    cellsEl.forEach((d, i) => {
      const v = cellState(i);
      const want = v === 2 ? "cat" : v === 1 ? "x" : "";
      if (d.dataset.v !== want) {
        d.dataset.v = want;
        d.innerHTML =
          v === 2
            ? '<svg viewBox="0 0 100 100"><use href="#catIcon"/></svg>'
            : v === 1
              ? '<svg viewBox="0 0 10 10"><use href="#xIcon"/></svg>'
              : "";
        d.classList.toggle("x", v === 1);
      }
      d.classList.toggle("bad", bad.has(i));
      d.classList.toggle("pop", popSet?.has(i) === true && v === 2);
      d.setAttribute(
        "aria-label",
        `${Math.floor(i / p.N) + 1}行${(i % p.N) + 1}列 ${REGION_NAMES[p.reg[i] ?? 0]} ${v === 2 ? "猫" : v === 1 ? "×" : "空白"}`,
      );
    });
    $("catCount").textContent = `${count}/${p.N}`;
    $<HTMLButtonElement>("undoBtn").disabled = undo.length === 0;
    $<HTMLButtonElement>("redoBtn").disabled = redo.length === 0;
    $("solved").textContent = String(solvedCount);
    if (!won && count === p.N && bad.size === 0) onWin(p);
  }
  function clearMarks(): void {
    for (const d of cellsEl) d.classList.remove("focus", "target", "wrong");
    pendingStep = null;
    applyBtn.hidden = true;
  }
  function say(html: string): void {
    $("msgText").innerHTML = html;
  }

  // ---------- 問題の始まりと終わり ----------
  function setPuzzle(p: Puzzle, diff: number, keepState: boolean): void {
    const playing: PlayingPuzzle = { N: p.N, reg: p.reg, cats: p.cats, level: p.level, diff };
    P = playing;
    won = false;
    $("win").hidden = true;
    if (!keepState) {
      st = new Array<CellState>(playing.N * playing.N).fill(0);
      elapsed = 0;
      hints = 0;
    }
    $("hintCount").textContent = String(hints);
    undo = [];
    redo = [];
    running = false;
    buildBoard(playing);
    clearMarks();
    render();
    say(DEFAULT_MESSAGE);
    if (!won) startTimer();
    $("timer").textContent = fmt(curElapsed());
    save();
    prefetch(playing.N, diff);
  }
  function newPuzzle(): void {
    const N = Number(sizeSel.value);
    const diff = Number(diffSel.value);
    const request = ++puzzleRequest;
    stopTimer();
    $("loading").hidden = false;
    $("win").hidden = true;
    track(
      takePuzzle(N, diff).then((p) => {
        if (request !== puzzleRequest) return;
        $("loading").hidden = true;
        setPuzzle(p, diff, false);
      }),
    );
  }
  /** 前に遊んだ盤面を、何も置いていない状態から始める。大きさと難しさの選択も、その盤面に合わせる */
  function replay(p: Puzzle, diff: number): void {
    puzzleRequest++;
    stopTimer();
    sizeSel.value = String(p.N);
    diffSel.value = String(diff);
    $("loading").hidden = true;
    setPuzzle(p, diff, false);
    boardEl.scrollIntoView?.({ behavior: "smooth", block: "center" });
  }
  function versusPrev(diff: number): string {
    return diff < 0
      ? `前回より <span class="faster">${fmt(-diff)} 速い</span>`
      : diff > 0
        ? `前回より <span class="slower">${fmt(diff)} 遅い</span>`
        : "前回と同じタイム";
  }
  function onWin(p: PlayingPuzzle): void {
    won = true;
    stopTimer();
    syncFromStore();
    clearMarks();
    const lv = LEVEL_NAMES[p.diff] ?? "";
    const rec: ClearRecord = { at: env.now(), n: p.N, d: p.diff, t: elapsed, h: hints };
    const code = encodeBoard(p.N, p.reg);
    const cmp = compareWin(records, rec, boards, code);
    // 「クリア ○ 問」は、初めて解いた盤面の数（ナンとの合意 2026-10-23）
    if (cmp.kind === "first") solvedCount++;
    // 盤面の形を先に保存する。盤面の保存に失敗しても、記録は残る（もう一度遊べないだけ）
    boards.set(recordKey(rec), code);
    const boardSaved = env.store.saveBoards(boards);
    records.push(rec);
    const recorded = env.store.saveRecords(records);
    markSaved(boardSaved && recorded);
    $("winText").textContent = `${p.N}×${p.N}・${lv}　タイム ${fmt(elapsed)}　ヒント ${hints}回`;
    let text: string;
    if (cmp.kind === "replay") {
      text = `この盤面 ${cmp.nth} 回目　${versusPrev(elapsed - cmp.prev.t)}　ベスト ${fmt(cmp.best)}`;
      if (cmp.isBest) text = `<b>この盤面の自己ベスト！</b>　${text}`;
    } else if (cmp.prev !== null) {
      text = `${versusPrev(elapsed - cmp.prev.t)}　平均 ${fmt(cmp.avg)}（${cmp.count}回）`;
      if (cmp.isBest) text = `<b>自己ベスト！</b>　${text}`;
    } else text = "この盤面・難しさで初めてのクリア！";
    $("winCompare").innerHTML = text;
    if (!recPanel.hidden) renderHist();
    $("win").hidden = false;
    say(
      recorded
        ? "全部の猫が見つかりました！"
        : "全部の猫が見つかりました！（記録を保存できませんでした。「記録」を見てください）",
    );
    $("solved").textContent = String(solvedCount);
    save();
  }

  // ---------- 盤面の操作 ----------
  function pushUndo(before: CellState[]): void {
    undo.push(before);
    if (undo.length > 300) undo.shift();
    redo = [];
  }
  function autoXAround(p: PlayingPuzzle, i: number): void {
    if (!autoX.checked) return;
    for (const j of attacks(p.N, p.reg, i)) if (cellState(j) === 0) st[j] = 1;
  }
  let drag: {
    id: number;
    start: number;
    last: number;
    before: CellState[];
    mode: DragMode;
  } | null = null;
  function cellAt(x: number, y: number): number {
    const el = doc.elementFromPoint(x, y);
    const c = el?.closest<HTMLElement>(".cell");
    return c !== null && c !== undefined && boardEl.contains(c) ? Number(c.dataset.i) : -1;
  }
  boardEl.addEventListener("pointerdown", (e) => {
    if (won || P === null || e.button > 0) return;
    const i = cellAt(e.clientX, e.clientY);
    if (i < 0) return;
    e.preventDefault();
    boardEl.setPointerCapture(e.pointerId);
    clearMarks();
    startTimer();
    const before = st.slice();
    const s = cellState(i);
    let mode: DragMode;
    if (s === 0) {
      st[i] = 1;
      mode = "paint";
    } else if (s === 1) mode = "pendX";
    else mode = "pendCat";
    drag = { id: e.pointerId, start: i, last: i, before, mode };
    render();
  });
  function visit(i: number): void {
    if (drag === null || P === null || i < 0 || i === drag.last) return;
    // 指を速く動かしたときに飛んだマスを、まっすぐ埋める
    const N = P.N;
    const a = drag.last;
    const ar = Math.floor(a / N);
    const ac = a % N;
    const br = Math.floor(i / N);
    const bc = i % N;
    const steps = Math.max(Math.abs(br - ar), Math.abs(bc - ac));
    const path: number[] = [];
    for (let k = 1; k <= steps; k++) {
      const r = Math.round(ar + ((br - ar) * k) / steps);
      const c = Math.round(ac + ((bc - ac) * k) / steps);
      path.push(r * N + c);
    }
    drag.last = i;
    if (drag.mode === "pendX") {
      drag.mode = "erase";
      st[drag.start] = 0;
    } else if (drag.mode === "pendCat") drag.mode = "paint";
    for (const j of path) {
      if (drag.mode === "paint" && cellState(j) === 0) st[j] = 1;
      else if (drag.mode === "erase" && cellState(j) === 1) st[j] = 0;
    }
    render();
  }
  boardEl.addEventListener("pointermove", (e) => {
    if (drag === null || e.pointerId !== drag.id) return;
    const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
    for (const ev of evs.length > 0 ? evs : [e]) visit(cellAt(ev.clientX, ev.clientY));
  });
  function endDrag(e: PointerEvent): void {
    if (drag === null || e.pointerId !== drag.id || P === null) return;
    const d = drag;
    const pop = new Set<number>();
    if (d.mode === "pendX") {
      st[d.start] = 2;
      pop.add(d.start);
      autoXAround(P, d.start);
    } else if (d.mode === "pendCat") st[d.start] = 0;
    if (st.some((v, k) => v !== d.before[k])) pushUndo(d.before);
    drag = null;
    render(pop);
    save();
  }
  boardEl.addEventListener("pointerup", endDrag);
  boardEl.addEventListener("pointercancel", endDrag);
  boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

  function doUndo(): void {
    if (won) return;
    const prev = undo.pop();
    if (prev === undefined) return;
    redo.push(st.slice());
    st = prev;
    clearMarks();
    render();
    save();
  }
  function doRedo(): void {
    if (won) return;
    const next = redo.pop();
    if (next === undefined) return;
    undo.push(st.slice());
    st = next;
    clearMarks();
    render();
    save();
  }
  $("undoBtn").onclick = doUndo;
  $("redoBtn").onclick = doRedo;
  $("clearXBtn").onclick = () => {
    if (won) return;
    const b = st.slice();
    st = st.map((v) => (v === 1 ? 0 : v));
    if (st.some((v, k) => v !== b[k])) pushUndo(b);
    clearMarks();
    render();
    save();
  };
  let resetArmed = 0;
  $("resetBtn").onclick = () => {
    if (won) return;
    if (env.now() - resetArmed > 3000) {
      resetArmed = env.now();
      say("もう一度「最初から」を押すと、盤面を全部消します。");
      return;
    }
    resetArmed = 0;
    const b = st.slice();
    st = st.map(() => 0);
    pushUndo(b);
    clearMarks();
    render();
    save();
    say("盤面を消しました。「戻す」で元に戻せます。");
  };
  $("newBtn").onclick = newPuzzle;
  $("winNext").onclick = newPuzzle;
  $("winRetry").onclick = () => {
    if (P !== null && won) replay(P, P.diff);
  };
  sizeSel.onchange = () => {
    prefetch(Number(sizeSel.value), Number(diffSel.value));
    newPuzzle();
  };
  diffSel.onchange = () => {
    prefetch(Number(sizeSel.value), Number(diffSel.value));
    newPuzzle();
  };
  autoX.onchange = save;

  // ---------- 記録 ----------
  let listLimit = LIST_PAGE;
  for (const n of SIZES)
    for (const d of LEVELS) {
      const o = doc.createElement("option");
      o.value = `${n}-${d}`;
      o.textContent = `${n}×${n} ${LEVEL_NAMES[d] ?? ""}`;
      recFilter.append(o);
    }
  function listFilter(): Category | null {
    if (recFilter.value === "all") return null;
    const [n = 0, d = 0] = recFilter.value.split("-").map(Number);
    return { n, d };
  }
  function renderHist(): void {
    const summary = summarize(records, boards);
    const curK = `${Number(sizeSel.value)}-${Number(diffSel.value)}`;
    if (summary.length === 0) {
      $("recSummary").innerHTML =
        '<p class="empty">まだ記録がありません。1問クリアするとここに出ます。</p>';
      $("recList").innerHTML = "";
      $("recMore").hidden = true;
      return;
    }
    let t =
      "<table><thead><tr><th>盤面・難しさ</th><th>回数</th><th>平均</th><th>ベスト</th><th>前回</th><th>平均ヒント</th></tr></thead><tbody>";
    for (const g of summary) {
      t += `<tr class="${`${g.n}-${g.d}` === curK ? "cur" : ""}"><td>${g.n}×${g.n} ${LEVEL_NAMES[g.d] ?? ""}</td><td>${g.count}</td><td>${fmt(g.avg)}</td><td>${fmt(g.best)}</td><td>${fmt(g.last)}</td><td>${g.avgHints.toFixed(1)}</td></tr>`;
    }
    $("recSummary").innerHTML = `${t}</tbody></table>`;
    renderList();
  }
  /** 盤面のセル（大きさ・難しさ、盤面 ID、何回目か） */
  function boardCell(n: number, d: number, id: string | null, nth: number): string {
    const times = nth > 1 ? `<span class="nth">${nth}回目</span>` : "";
    return `<td>${n}×${n} ${LEVEL_NAMES[d] ?? ""}<br><span class="bid">${id ?? "—"}</span>${times}</td>`;
  }
  function playCell(n: number, d: number, code: string | null): string {
    // 符号は base64url の文字だけなので、属性にそのまま書ける
    return code === null
      ? "<td></td>"
      : `<td><button type="button" class="play" data-n="${n}" data-d="${d}" data-b="${code}">遊ぶ</button></td>`;
  }
  /** 記録の一覧。新しい順は 1 回 1 行で、同じ盤面の前回（初めての盤面は、同じ盤面・難しさの前回）との比べを付ける */
  function renderList(): void {
    const sort = recSort.value as ListSort;
    const filter = listFilter();
    let l: string;
    let more: boolean;
    let count: number;
    if (sort === "new") {
      const res = historyRows(records, boards, filter, listLimit);
      ({ more } = res);
      count = res.rows.length;
      l =
        "<table><thead><tr><th>日時</th><th>盤面</th><th>タイム</th><th>前回比</th><th>ヒント</th><th></th></tr></thead><tbody>";
      for (const { record: h, code, id, nth, diff: df } of res.rows) {
        const dt = new Date(h.at);
        const ds = `${dt.getMonth() + 1}/${dt.getDate()} ${dt.getHours()}:${String(dt.getMinutes()).padStart(2, "0")}`;
        let c = "—";
        if (df !== null)
          c =
            df < 0
              ? `<span class="faster">−${fmt(-df)}</span>`
              : df > 0
                ? `<span class="slower">+${fmt(df)}</span>`
                : "±0:00";
        l += `<tr><td>${ds}</td>${boardCell(h.n, h.d, id, nth)}<td>${fmt(h.t)}</td><td>${c}</td><td>${h.h}</td>${playCell(h.n, h.d, code)}</tr>`;
      }
    } else {
      const res = boardRows(records, boards, filter, sort, listLimit);
      ({ more } = res);
      count = res.rows.length;
      l =
        "<table><thead><tr><th>盤面</th><th>初回</th><th>ベスト</th><th>回数</th><th>最少ヒント</th><th></th></tr></thead><tbody>";
      for (const g of res.rows)
        l += `<tr>${boardCell(g.n, g.d, g.id, 1)}<td>${fmt(g.first)}</td><td>${fmt(g.best)}</td><td>${g.count}</td><td>${g.minHints}</td>${playCell(g.n, g.d, g.code)}</tr>`;
    }
    $("recList").innerHTML =
      count > 0
        ? `${l}</tbody></table>`
        : `<p class="empty">${sort === "new" ? "この盤面・難しさの記録は、まだありません。" : "もう一度遊べる盤面は、まだありません。"}</p>`;
    $("recMore").hidden = !more;
  }
  recSort.onchange = () => {
    listLimit = LIST_PAGE;
    renderList();
  };
  recFilter.onchange = recSort.onchange;
  $("recMore").onclick = () => {
    listLimit += LIST_PAGE;
    renderList();
  };

  // ---------- 記録の一覧から、同じ盤面をもう一度遊ぶ ----------
  let playArmed: { readonly key: string; readonly at: number } | null = null;
  function showPlayMessage(text: string | null): void {
    const el = $("recPlayMsg");
    el.textContent = text ?? "";
    el.hidden = text === null;
  }
  function disarmPlay(): void {
    playArmed = null;
    for (const b of $("recList").querySelectorAll<HTMLButtonElement>("button.play"))
      b.textContent = "遊ぶ";
    showPlayMessage(null);
  }
  $("recList").addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>("button.play");
    if (btn === null || btn === undefined) return;
    const n = Number(btn.dataset.n);
    const d = Number(btn.dataset.d);
    const code = btn.dataset.b ?? "";
    const key = `${n}|${d}|${code}`;
    // 遊んでいる途中（クリアしていない盤面に、猫か × を置いている）なら、もう一度押してから始める
    const busy = P !== null && !won && st.some((v) => v !== 0);
    const armed =
      playArmed !== null && playArmed.key === key && env.now() - playArmed.at <= PLAY_CONFIRM_MS;
    if (busy && !armed) {
      disarmPlay();
      const at = env.now();
      playArmed = { key, at };
      btn.textContent = "もう一度押す";
      showPlayMessage(PLAY_MESSAGES.confirm);
      setTimeout(() => {
        if (playArmed?.at === at) disarmPlay();
      }, PLAY_CONFIRM_MS);
      return;
    }
    disarmPlay();
    const p = restorePuzzle(n, code);
    if (p === null) {
      showPlayMessage(PLAY_MESSAGES.broken);
      return;
    }
    replay(p, d);
  });
  function renderKeep(): void {
    $("recKeep").textContent = persistMessage(persistState);
  }
  function checkPersist(): void {
    track(
      requestPersist(env.persistApi).then((state) => {
        persistState = state;
        renderKeep();
      }),
    );
  }
  $("recBtn").onclick = () => {
    recPanel.hidden = !recPanel.hidden;
    if (!recPanel.hidden) {
      listLimit = LIST_PAGE;
      disarmPlay();
      renderHist();
      // 押したときにも頼み直す（Chrome は、操作の中で頼むと通しやすい）
      if (persistState !== "persisted") checkPersist();
      recPanel.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };
  $("recClose").onclick = () => {
    recPanel.hidden = true;
  };
  let clearArmed = 0;
  $("recClear").onclick = () => {
    if (env.now() - clearArmed > 3000) {
      clearArmed = env.now();
      $("recClear").textContent = "もう一度押すと消します";
      setTimeout(() => {
        $("recClear").textContent = "記録を全部消す";
      }, 3000);
      return;
    }
    clearArmed = 0;
    records = [];
    boards = new Map();
    // 記録を先に消す（盤面の形だけが残っても害は無い）
    markSaved(env.store.saveRecords(records) && env.store.saveBoards(boards));
    $("recClear").textContent = "記録を全部消す";
    renderHist();
  };

  // ---------- 書き出しと読み込み（機種変更のとき） ----------
  function showImportMessage(text: string): void {
    const el = $("recImportMsg");
    el.textContent = text;
    el.hidden = false;
  }
  $("recExport").onclick = () => {
    syncFromStore();
    const now = new Date(env.now());
    env.download(exportFileName(now), exportText({ solvedCount, records, boards }, now));
  };
  $("recImport").onclick = () => recFile.click();
  recFile.onchange = () => {
    const file = recFile.files?.[0];
    if (file === undefined) return;
    track(
      file.text().then(
        (text) => importText(text),
        () => importText(null),
      ),
    );
    recFile.value = "";
  };
  function importText(text: string | null): void {
    const data = text === null ? null : parseExport(text);
    if (data === null) {
      showImportMessage(IMPORT_MESSAGES.unreadable);
      return;
    }
    syncFromStore();
    const { data: merged, added } = importRecords({ solvedCount, records, boards }, data);
    const next = [...merged.records];
    const nextBoards = new Map(merged.boards);
    // 盤面の形を先に保存する（記録の保存に失敗しても、盤面の形が余るだけで害は無い）
    if (!env.store.saveBoards(nextBoards) || !env.store.saveRecords(next)) {
      showImportMessage(IMPORT_MESSAGES.saveFailed);
      return;
    }
    records = next;
    boards = nextBoards;
    solvedCount = merged.solvedCount;
    $("solved").textContent = String(solvedCount);
    save();
    renderHist();
    showImportMessage(added > 0 ? IMPORT_MESSAGES.added(added) : IMPORT_MESSAGES.noneAdded);
  }

  // ---------- ヒント ----------
  $("hintBtn").onclick = () => {
    if (P === null || won) return;
    const p = P;
    clearMarks();
    hints++;
    $("hintCount").textContent = String(hints);
    save();
    const hint = nextHint(p, st);
    if (hint === null) return;
    if (hint.kind === "wrong") {
      for (const i of hint.cells) cellEl(i)?.classList.add("wrong");
      say(`赤くゆれているマスが間違っています（${hint.cells.length}か所）。`);
      return;
    }
    if (hint.kind === "reveal") {
      cellEl(hint.cell)?.classList.add("target");
      say("ここに猫がいます。");
      pendingStep = { cells: [hint.cell], to: 2 };
      applyBtn.textContent = "猫を置く";
      applyBtn.hidden = false;
      return;
    }
    const step = hint.step;
    for (const i of step.focus) cellEl(i)?.classList.add("focus");
    for (const i of step.cells) cellEl(i)?.classList.add("target");
    say(step.msg);
    pendingStep = step;
    applyBtn.textContent = step.to === 2 ? "猫を置く" : "この×を付ける";
    applyBtn.hidden = false;
  };
  applyBtn.onclick = () => {
    if (pendingStep === null || P === null) return;
    const step = pendingStep;
    const b = st.slice();
    const pop = new Set<number>();
    for (const i of step.cells) {
      st[i] = step.to;
      if (step.to === 2) {
        pop.add(i);
        autoXAround(P, i);
      }
    }
    pushUndo(b);
    clearMarks();
    render(pop);
    save();
  };

  doc.addEventListener(
    "keydown",
    (e) => {
      if ((e.target as HTMLElement | null)?.tagName === "SELECT") return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if ((e.ctrlKey || e.metaKey) && k === "y") {
        e.preventDefault();
        doRedo();
      } else if (!e.ctrlKey && !e.metaKey && k === "n") newPuzzle();
      else if (!e.ctrlKey && !e.metaKey && k === "h") $("hintBtn").click();
    },
    listen,
  );

  // ---------- 起動 ----------
  $("trialNote").hidden = !env.trial;
  const saved = env.store.loadGame();
  if (saved !== null) {
    autoX.checked = saved.autoX;
    if (saved.size !== null) sizeSel.value = String(saved.size);
    if (saved.diff !== null) diffSel.value = String(saved.diff);
    solvedCount = saved.solvedCount;
  }
  $("recUnreadable").hidden = !env.store.unreadableFound;
  if (saved?.playing) {
    st = saved.playing.st;
    elapsed = saved.playing.elapsed;
    hints = saved.playing.hints;
    setPuzzle(saved.playing.puzzle, saved.playing.puzzle.diff, true);
  } else newPuzzle();
  renderKeep();
  checkPersist();
  env.onStorageChange(() => {
    syncFromStore();
    if (!recPanel.hidden) renderHist();
  }, stopped.signal);

  return {
    async whenIdle() {
      while (pending.size > 0) await Promise.allSettled([...pending]);
    },
    stop() {
      stopped.abort();
      clearInterval(timer);
    },
  };
}
