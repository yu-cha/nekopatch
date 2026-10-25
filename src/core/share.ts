// 盤面をほかの人に送るリンクと文（ナンとの合意 2026-10-25、判断 73b0）。
// リンクの # の後ろに、盤面の大きさ・難しさ・符号と、送る人のタイム（秒）・ヒントの回数・自動×を使ったかを入れる。
// # の後ろはブラウザがサーバーに送らないので、ページの中だけで読む。
// もらった盤面の印（送った人のタイムとヒントの回数と自動×）は、記録とは別に、記録の鍵ごとに持つ（判断 73b0）。

import { boardId, restorePuzzle } from "./board.ts";
import { isRecordKey } from "./notes.ts";
import { formatTime, LEVEL_NAMES, LEVELS, SIZES } from "./play.ts";
import type { Puzzle } from "./puzzle.ts";

/** 送る人のタイム（ミリ秒）とヒントの回数と、「猫の周りに自動で×」を使って解いたか */
export interface SenderScore {
  readonly time: number;
  readonly hints: number;
  readonly autoX: boolean;
}

/** 送る盤面。d は選んだ難しさ（記録の d と同じ） */
export interface SharedBoard {
  readonly n: number;
  readonly d: number;
  readonly code: string;
  /** 送る人のタイムとヒントの回数。遊んでいる途中に送るなら null */
  readonly sender: SenderScore | null;
}

/** もらった盤面の印 */
export interface Received {
  /** 送った人のタイムとヒントの回数。タイムの無いリンク（遊んでいる途中に送られた盤面）なら null */
  readonly sender: SenderScore | null;
}

/** 記録の鍵 → もらった盤面の印 */
export type ReceivedBoards = ReadonlyMap<string, Received>;

export const NO_RECEIVED: ReceivedBoards = new Map();

/** LINE でタップしたときに、LINE の中のブラウザではなく、いつものブラウザで開くための LINE の決まり */
export const OPEN_EXTERNAL = "openExternalBrowser=1";

/** リンクのタイム（秒）とヒントの回数の、いちばん大きい値 */
const MAX_SECONDS = 359999;
const MAX_HINTS = 9999;

/** 送るリンクの # の後ろ。タイムは秒に切り捨てる（画面の「3:25」と同じ）。自動×を使って解いたときだけ x=1 を足す */
export function shareFragment(b: SharedBoard): string {
  const parts = [`n=${b.n}`, `d=${b.d}`, `b=${b.code}`];
  if (b.sender !== null) {
    parts.push(
      `t=${Math.min(MAX_SECONDS, Math.floor(b.sender.time / 1000))}`,
      `h=${Math.min(MAX_HINTS, b.sender.hints)}`,
    );
    if (b.sender.autoX) parts.push("x=1");
  }
  return parts.join("&");
}

/** 送るリンク。pageUrl は開いているページのアドレス（? と # の後ろを除いたもの） */
export function shareLink(pageUrl: string, b: SharedBoard): string {
  return `${pageUrl}?${OPEN_EXTERNAL}#${shareFragment(b)}`;
}

/** 盤面の大きさと難しさ（「8×8・普通」） */
export function boardLabel(n: number, d: number): string {
  return `${n}×${n}・${LEVEL_NAMES[d] ?? ""}`;
}

/** 送るタイムとヒントの回数と自動×（「3:25・ヒント 0 回」「3:25・ヒント 0 回・自動×」） */
export function scoreLabel(s: SenderScore): string {
  return `${formatTime(s.time)}・ヒント ${s.hints} 回${s.autoX ? "・自動×" : ""}`;
}

/** スマホの共有の画面に渡す、3 行の文。日時や備考は入れない */
export function shareText(pageUrl: string, b: SharedBoard): string {
  const head = `ねこパッチの盤面 ${boardId(b.n, b.code)}（${boardLabel(b.n, b.d)}）`;
  const body =
    b.sender === null ? "これ解ける？" : `${scoreLabel(b.sender)}でクリア。挑戦してみて！`;
  return `${head}\n${body}\n${shareLink(pageUrl, b)}`;
}

/** 10 進の 0 以上の整数（先頭に 0 を付けない、9 桁まで）。読めなければ null */
function readCount(s: string | undefined): number | null {
  return s !== undefined && /^(0|[1-9][0-9]{0,8})$/.test(s) ? Number(s) : null;
}

/**
 * 送るリンクの # の後ろを読む。盤面の大きさ・難しさが選べる値で、盤面の符号から答えがちょうど 1 つの問題を作り直せて、
 * タイムとヒントの回数が両方あるか両方無く、自動×の印（x=1）がタイムと一緒のときだけ、盤面と作り直した問題を返す。読めなければ null。
 * 知らない名前の欄は無視する（あとで欄を足しても、この版で開けるように）
 */
export function parseShareFragment(
  fragment: string,
): { readonly board: SharedBoard; readonly puzzle: Puzzle } | null {
  let s = fragment;
  // 欄の値は % を含まない文字だけなので、アプリが % で書き換えていても戻してから読む
  try {
    s = decodeURIComponent(fragment);
  } catch {
    return null;
  }
  const fields = new Map<string, string>();
  for (const part of s.split("&")) {
    const eq = part.indexOf("=");
    if (eq < 0) return null;
    const name = part.slice(0, eq);
    if (fields.has(name)) return null;
    fields.set(name, part.slice(eq + 1));
  }
  const n = readCount(fields.get("n"));
  const d = readCount(fields.get("d"));
  const code = fields.get("b");
  if (n === null || d === null || code === undefined || !SIZES.includes(n) || !LEVELS.includes(d))
    return null;
  const t = fields.get("t");
  const h = fields.get("h");
  const x = fields.get("x");
  if (x !== undefined && x !== "1") return null;
  let sender: SenderScore | null = null;
  if (t !== undefined || h !== undefined || x !== undefined) {
    const sec = readCount(t);
    const hints = readCount(h);
    if (sec === null || hints === null || sec > MAX_SECONDS || hints > MAX_HINTS) return null;
    sender = { time: sec * 1000, hints, autoX: x === "1" };
  }
  const puzzle = restorePuzzle(n, code);
  if (puzzle === null) return null;
  return { board: { n, d, code, sender }, puzzle };
}

/** 送った人とのタイムの差（ミリ秒）。画面に出るタイムどうしの差と同じになるよう、秒の単位で比べる。負なら速い */
export function versusSender(time: number, sender: SenderScore): number {
  return (Math.floor(time / 1000) - Math.floor(sender.time / 1000)) * 1000;
}

function isNonNegativeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/**
 * 保存やファイルの、もらった盤面の印を読む（{senderTime, senderHints}、自動×を使っていれば senderAutoX: true も。
 * タイムの無いリンクなら {}）。
 * 読めなければ null。知らない欄は無視する
 */
export function readReceived(x: unknown): Received | null {
  if (typeof x !== "object" || x === null || Array.isArray(x)) return null;
  const { senderTime, senderHints, senderAutoX } = x as Record<string, unknown>;
  if (senderTime === undefined && senderHints === undefined && senderAutoX === undefined)
    return { sender: null };
  if (!isNonNegativeInteger(senderTime) || !isNonNegativeInteger(senderHints)) return null;
  if (senderAutoX !== undefined && typeof senderAutoX !== "boolean") return null;
  return { sender: { time: senderTime, hints: senderHints, autoX: senderAutoX === true } };
}

/** 保存やファイルに書く形 */
export function receivedJson(r: Received): {
  senderTime?: number;
  senderHints?: number;
  senderAutoX?: true;
} {
  if (r.sender === null) return {};
  return {
    senderTime: r.sender.time,
    senderHints: r.sender.hints,
    ...(r.sender.autoX ? { senderAutoX: true } : {}),
  };
}

/**
 * 保存してある、もらった盤面の印を読む。intact が false なら、読めない部分があった（読めた分だけを返す）。
 * そのときは、元の文字を別の場所に残してから書き直す（UI の役目）
 */
export function parseStoredReceived(raw: string | null): {
  received: Map<string, Received>;
  intact: boolean;
} {
  const received = new Map<string, Received>();
  if (raw === null) return { received, intact: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { received, intact: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { received, intact: false };
  let intact = true;
  for (const [key, value] of Object.entries(parsed)) {
    const r = isRecordKey(key) ? readReceived(value) : null;
    if (r === null) intact = false;
    else received.set(key, r);
  }
  return { received, intact };
}

export function serializeReceived(received: ReceivedBoards): string {
  return JSON.stringify(Object.fromEntries([...received].map(([k, r]) => [k, receivedJson(r)])));
}

/** 読み込んだファイルの印を、今のものに足す。同じ記録の印が今のスマホにあれば、今のまま */
export function mergeReceived(
  current: ReceivedBoards,
  file: ReceivedBoards,
): Map<string, Received> {
  const out = new Map(current);
  for (const [key, r] of file) if (!out.has(key)) out.set(key, r);
  return out;
}
