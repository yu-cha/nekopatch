// 画面の動き。元の nekopatch.html（2026-10-21 に受け取ったもの）の画面の処理を写したもの。
// 遊び方と見た目は変えない（ナンとの合意 2026-10-21 の 6）。足したのは「記録」の画面の、保存の状態と書き出し・読み込み。
// 2026-10-23 に、同じ盤面をもう一度遊ぶ仕組み（記録の一覧の「遊ぶ」、並べ替え、クリアの画面の「もう一度この盤面」）を足した。
// 2026-10-23 に、記録の備考（ひと言と「難」）と「自動×」の印（クリアの画面の書く欄、記録の一覧の ✎）を足した。
// ナンが書いた備考の文は、HTML の文字列に混ぜず、要素を作ったあとで textContent か value で入れる（判断 c995）。
// ブラウザの機能（保存、問題作りの Worker、保存領域の頼み、ファイルの書き出し）は env を通して使い、テストでは偽物に差し替える。

import {
  attacks,
  type BoardSort,
  boardRows,
  type Category,
  type CellState,
  type ClearRecord,
  changeNote,
  compareWin,
  conflicts,
  encodeBoard,
  exportFileName,
  exportText,
  formatTime as fmt,
  hasRemark,
  historyRows,
  importRecords,
  LEVEL_NAMES,
  LEVELS,
  type NoteChange,
  nextHint,
  type PlayingPuzzle,
  type Puzzle,
  parseExport,
  REGION_NAMES,
  type RecordNote,
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
  /** ブラウザの確かめの窓（OK／キャンセル）を出し、OK なら true */
  confirm(message: string): boolean;
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

/** クリアの画面の「保存」を押したあとの知らせ */
export const WIN_SAVED_MESSAGES = {
  saved: "保存しました",
  failed: "保存できませんでした。「記録」を見てください",
} as const;

/** 「記録を全部消す」の最後の確かめ（ブラウザの確かめの窓） */
export const CLEAR_CONFIRM_MESSAGE =
  "記録を全部消します。消した記録は戻せません。本当に消しますか？";

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
  const recList = $("recList");
  const winMemo = $<HTMLInputElement>("winMemo");
  const winHard = $<HTMLButtonElement>("winHard");

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
  let notes: Map<string, RecordNote> = env.store.loadNotes();
  /** この問題で「猫の周りに自動で×」を ON のまま猫を置いたか（「戻す」「最初から」でも戻さない） */
  let autoXUsed = false;
  /** クリアの画面の書く欄が備考を書く記録の鍵。クリアの画面を出していなければ null */
  let winKey: string | null = null;
  /** 記録の一覧で ✎ を押して、書く欄を開いている記録の鍵 */
  let editingKey: string | null = null;
  /** 書く欄を開いているあいだに、ほかのタブで保存データが変わった（閉じたら一覧を作り直す） */
  let listStale = false;
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
    notes = env.store.loadNotes();
    solvedCount = Math.max(solvedCount, env.store.storedSolvedCount());
    $("solved").textContent = String(solvedCount);
  }

  /**
   * key の記録の備考と印を変えて保存する。ほかのタブが書いた分を消さないよう、保存してあるものを読み直してから変える。
   * 記録がもう無ければ（ほかのタブで全部消した）、書かない。保存できた（変える所が無かった）ら true
   */
  function updateNote(key: string, change: NoteChange): boolean {
    syncFromStore();
    if (!records.some((r) => recordKey(r) === key)) return false;
    const next = changeNote(notes, key, change);
    if (JSON.stringify(next.get(key)) === JSON.stringify(notes.get(key))) return true;
    notes = next;
    const ok = env.store.saveNotes(notes);
    markSaved(ok);
    return ok;
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
        autoXUsed,
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
        // 書きかけの備考は、ほかのアプリに切り替えたときにも残す（決定を押していなくても）
        commitMemos();
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
    winKey = null;
    $("win").hidden = true;
    if (!keepState) {
      st = new Array<CellState>(playing.N * playing.N).fill(0);
      elapsed = 0;
      hints = 0;
      autoXUsed = false;
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
    commitWinMemo();
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
    commitWinMemo();
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
    const key = recordKey(rec);
    // 盤面の形と、備考と印を先に保存する。どちらかの保存に失敗しても、記録は残る（もう一度遊べない、印が付かないだけ）
    boards.set(key, code);
    const boardSaved = env.store.saveBoards(boards);
    let noteSaved = true;
    if (autoXUsed) {
      notes = changeNote(notes, key, { autoX: true });
      noteSaved = env.store.saveNotes(notes);
    }
    records.push(rec);
    const recorded = env.store.saveRecords(records);
    markSaved(boardSaved && noteSaved && recorded);
    winKey = key;
    winMemo.value = "";
    winMemoShown = "";
    winHard.setAttribute("aria-pressed", "false");
    $("winSaved").hidden = true;
    showPrevNote(cmp.prev);
    $("winText").textContent =
      `${p.N}×${p.N}・${lv}　タイム ${fmt(elapsed)}　ヒント ${hints}回${autoXUsed ? "　自動×" : ""}`;
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
  /** 猫を置いたときに呼ぶ。「猫の周りに自動で×」が ON なら、周りに × を付け、この問題で使ったと覚える */
  function autoXAround(p: PlayingPuzzle, i: number): void {
    if (!autoX.checked) return;
    autoXUsed = true;
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

  // ---------- 備考と印（ナンとの合意 2026-10-23） ----------
  /** 備考（「難」の印と文）を el の後ろに足す。文は textContent で入れる（HTML として扱わない） */
  function appendRemark(el: HTMLElement, note: RecordNote): void {
    if (note.hard === true) {
      const mark = doc.createElement("span");
      mark.className = "hard";
      mark.textContent = "難";
      el.append(mark);
      if (note.memo !== undefined) el.append(" ");
    }
    if (note.memo !== undefined) el.append(note.memo);
  }
  /** クリアの画面に、比べている前回の記録の備考を出す。前回が無いか、備考が無ければ出さない */
  function showPrevNote(prev: ClearRecord | null): void {
    const el = $("winPrevNote");
    const note = prev === null ? undefined : notes.get(recordKey(prev));
    el.textContent = "";
    el.hidden = note === undefined || !hasRemark(note);
    if (note === undefined || el.hidden) return;
    el.append("前回の備考: ");
    appendRemark(el, note);
  }
  /** 欄に出してから変えていない文（変えていなければ保存しない。ほかの所で書いた備考を、空の欄で消さないため） */
  let winMemoShown = "";
  /** クリアの画面の欄の文を保存する。保存できた（変えていなかった）ら true */
  function commitWinMemo(): boolean {
    if (winKey === null) return false;
    if (winMemo.value === winMemoShown) return true;
    const ok = updateNote(winKey, { memo: winMemo.value });
    winMemoShown = notes.get(winKey)?.memo ?? "";
    winMemo.value = winMemoShown;
    if (!recPanel.hidden && editingKey === null) renderList();
    return ok;
  }
  winMemo.addEventListener("change", () => commitWinMemo());
  // 「保存」を押したら、保存したことを見せる（ナンとの合意 2026-10-25。クリアの画面は閉じない）
  $("winSave").onclick = () => {
    if (winKey === null) return;
    const ok = commitWinMemo();
    const el = $("winSaved");
    el.textContent = ok ? WIN_SAVED_MESSAGES.saved : WIN_SAVED_MESSAGES.failed;
    el.hidden = false;
  };
  winMemo.addEventListener("input", () => {
    $("winSaved").hidden = true;
  });
  winHard.onclick = () => {
    if (winKey === null) return;
    commitWinMemo();
    updateNote(winKey, { hard: winHard.getAttribute("aria-pressed") !== "true" });
    winHard.setAttribute("aria-pressed", String(notes.get(winKey)?.hard === true));
    if (!recPanel.hidden && editingKey === null) renderList();
  };
  // 書く欄で決定（Enter）を押したら、欄から外してキーボードを閉じる（欄から外れると change で保存する）
  for (const el of [winMemo, recList])
    el.addEventListener("keydown", (e) => {
      const target = e.target as HTMLElement | null;
      if (e.key === "Enter" && target?.classList.contains("memoInput") === true) target.blur();
    });

  /** 記録の一覧の書く欄。開いていなければ null */
  function editorInput(): HTMLInputElement | null {
    return recList.querySelector<HTMLInputElement>("input.memoInput");
  }
  let editorShown = "";
  /** 記録の一覧の書く欄の文を保存する */
  function commitEditor(): void {
    const input = editorInput();
    if (editingKey === null || input === null || input.value === editorShown) return;
    updateNote(editingKey, { memo: input.value });
    editorShown = notes.get(editingKey)?.memo ?? "";
    input.value = editorShown;
  }
  /** 書きかけの備考を、全部保存する */
  function commitMemos(): void {
    commitWinMemo();
    commitEditor();
  }
  /** 記録の一覧の書く欄を、key の記録で開く（null なら閉じる） */
  function openEditor(key: string | null): void {
    commitEditor();
    editingKey = key;
    if (listStale) {
      listStale = false;
      renderHist();
    } else renderList();
    if (key !== null) editorInput()?.focus();
  }
  recList.addEventListener("click", (e) => {
    const btn = (e.target as Element | null)?.closest<HTMLButtonElement>("button");
    const key = btn?.dataset.k;
    if (btn === null || btn === undefined || key === undefined) return;
    if (btn.classList.contains("noteBtn")) openEditor(editingKey === key ? null : key);
    else if (btn.classList.contains("noteClose")) openEditor(null);
    else if (btn.classList.contains("hardBtn")) {
      commitEditor();
      syncFromStore();
      updateNote(key, { hard: notes.get(key)?.hard !== true });
      renderList();
    }
  });
  recList.addEventListener("change", (e) => {
    if ((e.target as Element | null)?.classList.contains("memoInput") === true) commitEditor();
  });

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
  // 記録の一覧は、スマホの幅（360px ほど）でも「遊ぶ」まで見えるよう、セルを 2 段にして列を減らす
  /** 盤面のセル（大きさ・難しさと、下の段に盤面 ID と何回目か。盤面ごとの並びでは「難」も） */
  function boardCell(n: number, d: number, id: string | null, nth: number, hard = false): string {
    const times = nth > 1 ? `<span class="nth">${nth}回目</span>` : "";
    const mark = hard ? '<span class="hard">難</span>' : "";
    return `<td class="board">${n}×${n} ${LEVEL_NAMES[d] ?? ""}<span class="sub"><span class="bid">${id ?? "—"}</span>${times}${mark}</span></td>`;
  }
  /**
   * 新しい順の 1 行のあとに足す行。✎ で開いた記録には書く欄、備考のある記録には備考の行。
   * 文と欄の値は、表を作ったあとで入れる（fillNotes）。鍵は数と | だけなので、属性にそのまま書ける
   */
  function noteRow(key: string, note: RecordNote | undefined): string {
    if (editingKey === key)
      return `<tr class="noteEdit"><td></td><td colspan="5"><div class="noteEditor"><button type="button" class="hardBtn" data-k="${key}" aria-pressed="${note?.hard === true}">難</button><input type="text" class="memoInput" data-k="${key}" maxlength="30" placeholder="ひと言（30 文字まで）" aria-label="備考（ひと言）" autocomplete="off" enterkeyhint="done"><button type="button" class="noteClose" data-k="${key}">閉じる</button></div></td></tr>`;
    return hasRemark(note)
      ? `<tr class="noteRow"><td></td><td colspan="5" class="remark" data-k="${key}"></td></tr>`
      : "";
  }
  /** 表を作ったあとで、備考の行に「難」と文を、書く欄に今の文を入れる */
  function fillNotes(): void {
    for (const el of recList.querySelectorAll<HTMLElement>("td.remark")) {
      const note = notes.get(el.dataset.k ?? "");
      if (note !== undefined) appendRemark(el, note);
    }
    const input = editorInput();
    if (input === null) editingKey = null;
    else if (editingKey !== null) {
      editorShown = notes.get(editingKey)?.memo ?? "";
      input.value = editorShown;
    }
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
        '<table><thead><tr><th class="edit"></th><th>日時</th><th class="board">盤面</th><th>タイム<span class="sub">前回比</span></th><th>ヒント</th><th></th></tr></thead><tbody>';
      for (const { record: h, code, id, nth, diff: df } of res.rows) {
        const k = recordKey(h);
        const note = notes.get(k);
        const dt = new Date(h.at);
        const ds = `${dt.getMonth() + 1}/${dt.getDate()}<span class="sub">${dt.getHours()}:${String(dt.getMinutes()).padStart(2, "0")}</span>`;
        let c = "—";
        if (df !== null)
          c =
            df < 0
              ? `<span class="faster">−${fmt(-df)}</span>`
              : df > 0
                ? `<span class="slower">+${fmt(df)}</span>`
                : "±0:00";
        const ax = note?.autoX === true ? '<span class="sub">自動×</span>' : "";
        l += `<tr><td class="edit"><button type="button" class="noteBtn" data-k="${k}" aria-label="備考を書く" aria-expanded="${editingKey === k}">✎</button></td><td>${ds}</td>${boardCell(h.n, h.d, id, nth)}<td>${fmt(h.t)}<span class="sub df">${c}</span></td><td>${h.h}${ax}</td>${playCell(h.n, h.d, code)}</tr>${noteRow(k, note)}`;
      }
    } else {
      const res = boardRows(records, boards, filter, sort, listLimit, notes);
      ({ more } = res);
      count = res.rows.length;
      l =
        '<table><thead><tr><th class="board">盤面</th><th>初回</th><th>ベスト</th><th>回数</th><th>最少<br>ヒント</th><th></th></tr></thead><tbody>';
      for (const g of res.rows)
        l += `<tr>${boardCell(g.n, g.d, g.id, 1, g.hard)}<td>${fmt(g.first)}</td><td>${fmt(g.best)}</td><td>${g.count}</td><td>${g.minHints}</td>${playCell(g.n, g.d, g.code)}</tr>`;
    }
    $("recList").innerHTML =
      count > 0
        ? `${l}</tbody></table>`
        : `<p class="empty">${sort === "new" ? "この盤面・難しさの記録は、まだありません。" : "もう一度遊べる盤面は、まだありません。"}</p>`;
    fillNotes();
    $("recMore").hidden = !more;
  }
  recSort.onchange = () => {
    commitEditor();
    editingKey = null;
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
    commitEditor();
    editingKey = null;
    listStale = false;
    if (!recPanel.hidden) {
      listLimit = LIST_PAGE;
      disarmPlay();
      $("recClearConfirm").hidden = true;
      renderHist();
      // 押したときにも頼み直す（Chrome は、操作の中で頼むと通しやすい）
      if (persistState !== "persisted") checkPersist();
      recPanel.scrollIntoView?.({ behavior: "smooth", block: "start" });
    }
  };
  $("recClose").onclick = () => {
    commitEditor();
    editingKey = null;
    recPanel.hidden = true;
  };
  // 「記録を全部消す」は、間違って押して何年分もの記録を失わないよう、記録の画面の一番下に置き、
  // 押す → 注意の文と「本当に全部消す」 → ブラウザの確かめの窓、の 3 回で消す（ナンとの合意 2026-10-23）
  $("recClear").onclick = () => {
    $("recClearConfirm").hidden = false;
  };
  $("recClearNo").onclick = () => {
    $("recClearConfirm").hidden = true;
  };
  $("recClearYes").onclick = () => {
    const yes = env.confirm(CLEAR_CONFIRM_MESSAGE);
    $("recClearConfirm").hidden = true;
    if (!yes) return;
    records = [];
    boards = new Map();
    notes = new Map();
    editingKey = null;
    // 記録を先に消す（盤面の形や備考だけが残っても害は無い）
    markSaved(
      env.store.saveRecords(records) && env.store.saveBoards(boards) && env.store.saveNotes(notes),
    );
    renderHist();
  };

  // ---------- 書き出しと読み込み（機種変更のとき） ----------
  function showImportMessage(text: string): void {
    const el = $("recImportMsg");
    el.textContent = text;
    el.hidden = false;
  }
  $("recExport").onclick = () => {
    commitMemos();
    syncFromStore();
    const now = new Date(env.now());
    env.download(exportFileName(now), exportText({ solvedCount, records, boards, notes }, now));
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
    commitMemos();
    syncFromStore();
    const { data: merged, added } = importRecords({ solvedCount, records, boards, notes }, data);
    const next = [...merged.records];
    const nextBoards = new Map(merged.boards);
    const nextNotes = new Map(merged.notes);
    // 盤面の形と備考を先に保存する（記録の保存に失敗しても、盤面の形や備考が余るだけで害は無い）
    if (
      !env.store.saveBoards(nextBoards) ||
      !env.store.saveNotes(nextNotes) ||
      !env.store.saveRecords(next)
    ) {
      showImportMessage(IMPORT_MESSAGES.saveFailed);
      return;
    }
    records = next;
    boards = nextBoards;
    notes = nextNotes;
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
      const target = e.target as HTMLElement | null;
      // 選ぶ欄と、文字を打つ欄（備考）の上では、盤面のキー操作にしない
      if (target?.tagName === "SELECT" || target?.tagName === "TEXTAREA") return;
      if (target?.tagName === "INPUT" && (target as HTMLInputElement).type === "text") return;
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
    autoXUsed = saved.playing.autoXUsed;
    setPuzzle(saved.playing.puzzle, saved.playing.puzzle.diff, true);
  } else newPuzzle();
  renderKeep();
  checkPersist();
  env.onStorageChange(() => {
    syncFromStore();
    if (recPanel.hidden) return;
    // 書く欄を開いているあいだは、作り直さない（書きかけの文とキーボードを消さないため）。閉じたら作り直す
    if (editingKey !== null) listStale = true;
    else renderHist();
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
