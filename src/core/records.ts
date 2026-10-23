// クリアの記録。保存の形を読む・書く、成績をまとめる、機種変更のときのファイルに書き出す・読み込む。
// 保存の形は、作り直す前（2026-10-21 まで）と同じ JSON の配列のまま変えない（ナンの今までの記録をそのまま読むため）。
// 数の上限は置かない（ナンとの合意 2026-10-21 の 2）。
// 遊んだ盤面の形は、記録とは別に、記録の鍵ごとに持つ（判断 490d）。同じ盤面の 2 回目からを「もう一度遊んだ記録」とし、
// 成績の表と「クリア ○ 問」には数えない（ナンとの合意 2026-10-23）。
// 備考と「自動×」の印も、記録とは別に、記録の鍵ごとに持つ（notes.ts、判断 c995）。

import { boardId, isBoardCode } from "./board.ts";
import { mergeNotes, NO_NOTES, type Notes, type RecordNote, readNoteFields } from "./notes.ts";
import { LEVELS, SIZES } from "./play.ts";

/** 1 回のクリア。at は日時（ミリ秒）、n は盤面の大きさ、d は難しさ、t はタイム（ミリ秒）、h はヒントの回数 */
export interface ClearRecord {
  readonly at: number;
  readonly n: number;
  readonly d: number;
  readonly t: number;
  readonly h: number;
}

/** 遊んだ盤面の形。記録の鍵（recordKey）→ 盤面の符号（board.ts） */
export type Boards = ReadonlyMap<string, string>;

const NO_BOARDS: Boards = new Map();

/** クリアの記録と「クリア ○ 問」の数と、遊んだ盤面の形と、備考と印。書き出すファイルの中身 */
export interface RecordsData {
  readonly solvedCount: number;
  readonly records: readonly ClearRecord[];
  readonly boards: Boards;
  /** 備考と印。無ければ、どの記録にも無い */
  readonly notes?: Notes;
}

function isNonNegativeInteger(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

function isNonNegativeNumber(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x >= 0;
}

export function isClearRecord(x: unknown): x is ClearRecord {
  if (typeof x !== "object" || x === null) return false;
  const r = x as Record<string, unknown>;
  return (
    isNonNegativeNumber(r.at) &&
    typeof r.n === "number" &&
    SIZES.includes(r.n) &&
    typeof r.d === "number" &&
    LEVELS.includes(r.d) &&
    isNonNegativeNumber(r.t) &&
    isNonNegativeInteger(r.h)
  );
}

/** 記録の 5 つの値だけを取り出す（ほかの値が付いていても、保存や書き出しには入れない） */
function normalize(r: ClearRecord): ClearRecord {
  return { at: r.at, n: r.n, d: r.d, t: r.t, h: r.h };
}

/**
 * 保存してある記録を読む。intact が false なら、読めない部分があった（読めた記録だけを返す）。
 * そのときは、元の文字を別の場所に残してから書き直す（UI の役目）
 */
export function parseStoredHistory(raw: string | null): {
  records: ClearRecord[];
  intact: boolean;
} {
  if (raw === null) return { records: [], intact: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { records: [], intact: false };
  }
  if (!Array.isArray(parsed)) return { records: [], intact: false };
  const records = parsed.filter(isClearRecord).map(normalize);
  return { records, intact: records.length === parsed.length };
}

export function serializeHistory(records: readonly ClearRecord[]): string {
  return JSON.stringify(records.map(normalize));
}

/** 同じ記録かどうかを見分ける鍵。日時・盤面・難しさ・タイム・ヒントの回数が全部同じなら同じ記録 */
export function recordKey(r: ClearRecord): string {
  return `${r.at}|${r.n}|${r.d}|${r.t}|${r.h}`;
}

/** 盤面の形の鍵（記録の鍵）と符号として読めるか。鍵の 2 つ目の値が盤面の大きさ */
function isBoardEntry(key: string, code: unknown): code is string {
  const parts = key.split("|");
  return parts.length === 5 && isBoardCode(Number(parts[1]), code);
}

/**
 * 保存してある盤面の形を読む。intact が false なら、読めない部分があった（読めた分だけを返す）。
 * そのときは、元の文字を別の場所に残してから書き直す（UI の役目）
 */
export function parseStoredBoards(raw: string | null): {
  boards: Map<string, string>;
  intact: boolean;
} {
  const boards = new Map<string, string>();
  if (raw === null) return { boards, intact: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { boards, intact: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { boards, intact: false };
  let intact = true;
  for (const [key, code] of Object.entries(parsed)) {
    if (isBoardEntry(key, code)) boards.set(key, code);
    else intact = false;
  }
  return { boards, intact };
}

export function serializeBoards(boards: Boards): string {
  return JSON.stringify(Object.fromEntries(boards));
}

/** 1 回のクリアと、その盤面の何回目か */
export interface Play {
  readonly record: ClearRecord;
  /** 盤面の符号。盤面の形が無い記録は null */
  readonly code: string | null;
  /** 同じ盤面（大きさ・難しさ・符号が同じ）の何回目か。盤面の形が無い記録はいつも 1 */
  readonly nth: number;
}

/** 同じ盤面の記録をまとめる鍵 */
function boardGroup(r: ClearRecord, code: string): string {
  return `${r.n}|${r.d}|${code}`;
}

/** 記録を並びの順（日時の順）に見て、盤面ごとに何回目かを数える。2 回目からが「もう一度遊んだ記録」 */
export function classifyPlays(records: readonly ClearRecord[], boards: Boards): Play[] {
  const seen = new Map<string, number>();
  return records.map((record) => {
    const code = boards.size === 0 ? undefined : boards.get(recordKey(record));
    if (code === undefined) return { record, code: null, nth: 1 };
    const k = boardGroup(record, code);
    const nth = (seen.get(k) ?? 0) + 1;
    seen.set(k, nth);
    return { record, code, nth };
  });
}

/** 盤面の大きさと難しさ */
export interface Category {
  readonly n: number;
  readonly d: number;
}

function inCategory(r: ClearRecord, filter: Category | null): boolean {
  return filter === null || (r.n === filter.n && r.d === filter.d);
}

/** 同じ盤面・難しさごとの成績 */
export interface CategorySummary {
  readonly n: number;
  readonly d: number;
  readonly count: number;
  readonly avg: number;
  readonly best: number;
  /** 一番新しい記録のタイム */
  readonly last: number;
  readonly avgHints: number;
}

/** 盤面・難しさごとにまとめる。もう一度遊んだ記録は入れない。盤面の小さい順、同じ盤面なら難しさの低い順 */
export function summarize(
  records: readonly ClearRecord[],
  boards: Boards = NO_BOARDS,
): CategorySummary[] {
  const acc = new Map<
    string,
    { n: number; d: number; count: number; sumT: number; best: number; last: number; sumH: number }
  >();
  for (const { record: r, nth } of classifyPlays(records, boards)) {
    if (nth > 1) continue;
    const k = `${r.n}-${r.d}`;
    const g = acc.get(k);
    if (g === undefined) {
      acc.set(k, { n: r.n, d: r.d, count: 1, sumT: r.t, best: r.t, last: r.t, sumH: r.h });
    } else {
      g.count++;
      g.sumT += r.t;
      // 数が多くても止まらないよう、Math.min(...配列) は使わない
      if (r.t < g.best) g.best = r.t;
      g.last = r.t;
      g.sumH += r.h;
    }
  }
  return [...acc.values()]
    .sort((a, b) => a.n - b.n || a.d - b.d)
    .map((g) => ({
      n: g.n,
      d: g.d,
      count: g.count,
      avg: g.sumT / g.count,
      best: g.best,
      last: g.last,
      avgHints: g.sumH / g.count,
    }));
}

/** 記録の一覧（新しい順）の 1 行 */
export interface HistoryRow {
  readonly record: ClearRecord;
  /** 盤面の符号と盤面 ID。盤面の形が無い記録は null */
  readonly code: string | null;
  readonly id: string | null;
  /** 同じ盤面の何回目か */
  readonly nth: number;
  /**
   * 前回とのタイムの差。もう一度遊んだ記録は同じ盤面の前回と、
   * 初めての記録は同じ盤面・難しさの、初めて遊んだ記録の前回と比べる。比べる相手が無ければ null
   */
  readonly diff: number | null;
}

/** 一覧の行と、まだ出していない行があるか */
export interface Rows<T> {
  readonly rows: T[];
  readonly more: boolean;
}

/** 記録の一覧（新しい順）。filter の大きさ・難しさだけを、新しい方から limit 件 */
export function historyRows(
  records: readonly ClearRecord[],
  boards: Boards,
  filter: Category | null,
  limit: number,
): Rows<HistoryRow> {
  const plays = classifyPlays(records, boards);
  // 前回比は、一覧に出す行より前の記録とも比べるので、全部の記録について 1 回の走査で求める
  const diffs: (number | null)[] = [];
  const lastFirst = new Map<string, number>();
  const lastSame = new Map<string, number>();
  for (const { record: r, code, nth } of plays) {
    if (code !== null && nth > 1) {
      const k = boardGroup(r, code);
      const prev = lastSame.get(k);
      diffs.push(prev === undefined ? null : r.t - prev);
      lastSame.set(k, r.t);
      continue;
    }
    const k = `${r.n}-${r.d}`;
    const prev = lastFirst.get(k);
    diffs.push(prev === undefined ? null : r.t - prev);
    lastFirst.set(k, r.t);
    if (code !== null) lastSame.set(boardGroup(r, code), r.t);
  }
  const rows: HistoryRow[] = [];
  for (let i = plays.length - 1; i >= 0; i--) {
    const p = plays[i];
    if (p === undefined || !inCategory(p.record, filter)) continue;
    if (rows.length === limit) return { rows, more: true };
    rows.push({
      record: p.record,
      code: p.code,
      id: p.code === null ? null : boardId(p.record.n, p.code),
      nth: p.nth,
      diff: diffs[i] ?? null,
    });
  }
  return { rows, more: false };
}

/** 盤面ごとの並べ方。slow はベストの遅い順、fast は速い順、hints は一番少ないヒントの回数の多い順 */
export type BoardSort = "slow" | "fast" | "hints";

/** 盤面ごとの 1 行 */
export interface BoardRow {
  readonly n: number;
  readonly d: number;
  readonly code: string;
  readonly id: string;
  readonly count: number;
  /** 初回のタイム */
  readonly first: number;
  /** 一番速いタイム */
  readonly best: number;
  /** 一番少ないヒントの回数 */
  readonly minHints: number;
  /** 一番新しい記録の日時 */
  readonly lastAt: number;
  /** その盤面の記録に、1 回でも「難」の印があるか */
  readonly hard: boolean;
}

/** 盤面の形がある記録を、盤面ごとにまとめて並べる。filter の大きさ・難しさだけを、上から limit 件 */
export function boardRows(
  records: readonly ClearRecord[],
  boards: Boards,
  filter: Category | null,
  sort: BoardSort,
  limit: number,
  notes: Notes = NO_NOTES,
): Rows<BoardRow> {
  const acc = new Map<
    string,
    {
      n: number;
      d: number;
      code: string;
      count: number;
      first: number;
      best: number;
      minHints: number;
      lastAt: number;
      hard: boolean;
    }
  >();
  for (const { record: r, code } of classifyPlays(records, boards)) {
    if (code === null || !inCategory(r, filter)) continue;
    const k = boardGroup(r, code);
    const hard = notes.size > 0 && notes.get(recordKey(r))?.hard === true;
    const g = acc.get(k);
    if (g === undefined) {
      acc.set(k, {
        n: r.n,
        d: r.d,
        code,
        count: 1,
        first: r.t,
        best: r.t,
        minHints: r.h,
        lastAt: r.at,
        hard,
      });
    } else {
      g.count++;
      if (r.t < g.best) g.best = r.t;
      if (r.h < g.minHints) g.minHints = r.h;
      g.lastAt = r.at;
      if (hard) g.hard = true;
    }
  }
  const order: Record<BoardSort, (a: BoardRow, b: BoardRow) => number> = {
    slow: (a, b) => b.best - a.best,
    fast: (a, b) => a.best - b.best,
    hints: (a, b) => b.minHints - a.minHints || b.best - a.best,
  };
  const all = [...acc.values()]
    .map((g) => ({ ...g, id: boardId(g.n, g.code) }))
    .sort((a, b) => order[sort](a, b) || b.lastAt - a.lastAt);
  return { rows: all.slice(0, limit), more: all.length > limit };
}

/** クリアしたときの比べ */
export type WinComparison =
  /** 初めての盤面。同じ盤面・難しさの、初めて遊んだ記録と比べる */
  | {
      readonly kind: "first";
      /** 同じ盤面・難しさの、初めて遊んだ 1 つ前の記録。初めてなら null */
      readonly prev: ClearRecord | null;
      /** 今回を含めた平均と回数 */
      readonly avg: number;
      readonly count: number;
      /** 前の記録が全部、今回より遅い（初めてのときは false） */
      readonly isBest: boolean;
    }
  /** もう一度遊んだ盤面。同じ盤面の記録と比べる */
  | {
      readonly kind: "replay";
      /** 何回目か（2 から） */
      readonly nth: number;
      /** 同じ盤面の 1 つ前の記録 */
      readonly prev: ClearRecord;
      /** 今回を含めて一番速いタイム */
      readonly best: number;
      /** 同じ盤面の前の記録が全部、今回より遅い */
      readonly isBest: boolean;
    };

/** previous は今回を含まない、それまでの記録。code は今回の盤面の符号（盤面の形が無ければ null） */
export function compareWin(
  previous: readonly ClearRecord[],
  rec: ClearRecord,
  boards: Boards = NO_BOARDS,
  code: string | null = null,
): WinComparison {
  if (code !== null) {
    const same = previous.filter(
      (p) => p.n === rec.n && p.d === rec.d && boards.get(recordKey(p)) === code,
    );
    const prev = same[same.length - 1];
    if (prev !== undefined) {
      let best = rec.t;
      for (const p of same) if (p.t < best) best = p.t;
      return {
        kind: "replay",
        nth: same.length + 1,
        prev,
        best,
        isBest: same.every((p) => p.t > rec.t),
      };
    }
  }
  const same = classifyPlays(previous, boards)
    .filter((p) => p.nth === 1 && p.record.n === rec.n && p.record.d === rec.d)
    .map((p) => p.record);
  const prev = same[same.length - 1] ?? null;
  const count = same.length + 1;
  const avg = (same.reduce((a, b) => a + b.t, 0) + rec.t) / count;
  return {
    kind: "first",
    prev,
    avg,
    count,
    isBest: prev !== null && same.every((h) => h.t > rec.t),
  };
}

/** 書き出すファイルの種類の印。読み込むときに、ねこパッチの記録のファイルかを見分ける */
export const RECORDS_FILE_FORMAT = "nekopatch-records";
/**
 * 版は、前の版が無視すると困る変更のときだけ上げる。盤面の形（記録の欄 b）と、備考と印（memo、hard、autoX）は、
 * 無視されても困らないので 1 のまま（判断 490d、c995）
 */
export const RECORDS_FILE_VERSION = 1;

/**
 * 書き出すファイルの中身。記録は 1 件を 1 行にして、人が開いても読めるようにする。
 * 盤面の形がある記録には b を、備考か印がある記録には memo・hard・autoX のうちあるものを付ける
 */
export function exportText(data: RecordsData, exportedAt: Date): string {
  const head = [
    `"format": ${JSON.stringify(RECORDS_FILE_FORMAT)}`,
    `"version": ${RECORDS_FILE_VERSION}`,
    `"exportedAt": ${JSON.stringify(exportedAt.toISOString())}`,
    `"solvedCount": ${data.solvedCount}`,
  ];
  const notes = data.notes ?? NO_NOTES;
  const lines = data.records.map((r) => {
    const k = recordKey(r);
    const b = data.boards.get(k);
    const note = notes.get(k);
    return `    ${JSON.stringify({ ...normalize(r), ...(b === undefined ? {} : { b }), ...note })}`;
  });
  const records = lines.length === 0 ? `"records": []` : `"records": [\n${lines.join(",\n")}\n  ]`;
  return `{\n${[...head, records].map((l) => `  ${l}`).join(",\n")}\n}\n`;
}

/** 書き出すファイルの名前（その日の日付を入れる） */
export function exportFileName(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `nekopatch-records-${y}-${m}-${d}.json`;
}

/**
 * ファイルの記録の 1 行として読めるか。盤面の形（b）は無くてもよいが、あればその大きさの盤面の符号でなければならない。
 * 備考と印（memo は文字列、hard と autoX は真偽値）も、無くてもよいが、あれば読めなければならない
 */
function isFileRecord(x: unknown): x is ClearRecord & { readonly b?: string } {
  if (!isClearRecord(x)) return false;
  const b = (x as { b?: unknown }).b;
  return (
    (b === undefined || isBoardCode(x.n, b)) &&
    readNoteFields(x as unknown as Record<string, unknown>).ok
  );
}

/** 書き出したファイルを読む。ねこパッチの記録のファイルでない、または 1 か所でも読めないところがあれば null */
export function parseExport(text: string): RecordsData | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
  const f = parsed as Record<string, unknown>;
  if (f.format !== RECORDS_FILE_FORMAT || f.version !== RECORDS_FILE_VERSION) return null;
  if (!isNonNegativeInteger(f.solvedCount)) return null;
  if (!Array.isArray(f.records) || !f.records.every(isFileRecord)) return null;
  const records = f.records.map(normalize);
  const boards = new Map<string, string>();
  const notes = new Map<string, RecordNote>();
  f.records.forEach((r, i) => {
    const rec = records[i];
    if (rec === undefined) return;
    const k = recordKey(rec);
    if (r.b !== undefined) boards.set(k, r.b);
    const { note } = readNoteFields(r as unknown as Record<string, unknown>);
    if (note !== null) notes.set(k, note);
  });
  // 備考の無い前のファイルは、備考の欄を足す前と同じ値に読む
  return { solvedCount: f.solvedCount, records, boards, ...(notes.size > 0 ? { notes } : {}) };
}

/**
 * 読み込んだファイルの記録を、今の記録に足す。
 * - 同じ記録（recordKey が同じ）は 2 つにしない。added は新しく増えた件数
 * - 記録は日時の順に並べる
 * - 盤面の形は、同じ記録の鍵で足す（今の値があれば変えない）
 * - 備考と印は、同じ記録の鍵で合わせる（mergeNotes。今のスマホに備考があれば今のまま）
 * - 「クリア ○ 問」は、ファイルの数に、今の記録のうちファイルに無いもの（新しいスマホでだけクリアした分）の数を足す。
 *   もう一度遊んだ記録（読み込んだあとの記録で判断する）は足さない。
 *   今の数より減らさない。同じファイルを何回読み込んでも増えない（ナンの答え 2026-10-22）
 */
export function importRecords(
  current: RecordsData,
  file: RecordsData,
): { data: RecordsData; added: number } {
  const keys = new Set(current.records.map(recordKey));
  const fresh: ClearRecord[] = [];
  for (const r of file.records) {
    const k = recordKey(r);
    if (keys.has(k)) continue;
    keys.add(k);
    fresh.push(r);
  }
  const records =
    fresh.length === 0
      ? [...current.records]
      : [...current.records, ...fresh].sort((a, b) => a.at - b.at);
  const boards = new Map(current.boards);
  for (const [k, code] of file.boards) if (!boards.has(k)) boards.set(k, code);
  const fileKeys = new Set(file.records.map(recordKey));
  const here = new Set(current.records.map(recordKey));
  let onlyHere = 0;
  for (const { record, nth } of classifyPlays(records, boards)) {
    const k = recordKey(record);
    if (nth === 1 && here.has(k) && !fileKeys.has(k)) onlyHere++;
  }
  return {
    data: {
      solvedCount: Math.max(current.solvedCount, file.solvedCount + onlyHere),
      records,
      boards,
      notes: mergeNotes(current.notes ?? NO_NOTES, file.notes ?? NO_NOTES),
    },
    added: fresh.length,
  };
}
