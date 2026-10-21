// クリアの記録。保存の形を読む・書く、成績をまとめる、機種変更のときのファイルに書き出す・読み込む。
// 保存の形は、作り直す前（2026-10-21 まで）と同じ JSON の配列のまま変えない（ナンの今までの記録をそのまま読むため）。
// 数の上限は置かない（ナンとの合意 2026-10-21 の 2）。

import { LEVELS, SIZES } from "./play.ts";

/** 1 回のクリア。at は日時（ミリ秒）、n は盤面の大きさ、d は難しさ、t はタイム（ミリ秒）、h はヒントの回数 */
export interface ClearRecord {
  readonly at: number;
  readonly n: number;
  readonly d: number;
  readonly t: number;
  readonly h: number;
}

/** クリアの記録と「クリア ○ 問」の数。書き出すファイルの中身 */
export interface RecordsData {
  readonly solvedCount: number;
  readonly records: readonly ClearRecord[];
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

/** 盤面・難しさごとにまとめる。盤面の小さい順、同じ盤面なら難しさの低い順 */
export function summarize(records: readonly ClearRecord[]): CategorySummary[] {
  const acc = new Map<
    string,
    { n: number; d: number; count: number; sumT: number; best: number; last: number; sumH: number }
  >();
  for (const r of records) {
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

/** 最近の記録の 1 行。diff は、同じ盤面・難しさの 1 つ前の記録とのタイムの差（無ければ null） */
export interface RecentRow {
  readonly record: ClearRecord;
  readonly diff: number | null;
}

/** 新しい順に limit 件 */
export function recentRows(records: readonly ClearRecord[], limit = 30): RecentRow[] {
  const rows: RecentRow[] = [];
  for (let i = records.length - 1; i >= 0 && rows.length < limit; i--) {
    const r = records[i];
    if (r === undefined) continue;
    let diff: number | null = null;
    for (let j = i - 1; j >= 0; j--) {
      const p = records[j];
      if (p !== undefined && p.n === r.n && p.d === r.d) {
        diff = r.t - p.t;
        break;
      }
    }
    rows.push({ record: r, diff });
  }
  return rows;
}

/** クリアしたときの、同じ盤面・難しさの前の記録との比べ */
export interface WinComparison {
  /** 同じ盤面・難しさの 1 つ前の記録。初めてなら null */
  readonly prev: ClearRecord | null;
  /** 今回を含めた平均と回数 */
  readonly avg: number;
  readonly count: number;
  /** 前の記録が全部、今回より遅い（初めてのときは false） */
  readonly isBest: boolean;
}

/** previous は今回を含まない、それまでの記録 */
export function compareWin(previous: readonly ClearRecord[], rec: ClearRecord): WinComparison {
  const same = previous.filter((h) => h.n === rec.n && h.d === rec.d);
  const prev = same[same.length - 1] ?? null;
  const count = same.length + 1;
  const avg = (same.reduce((a, b) => a + b.t, 0) + rec.t) / count;
  return { prev, avg, count, isBest: prev !== null && same.every((h) => h.t > rec.t) };
}

/** 書き出すファイルの種類の印。読み込むときに、ねこパッチの記録のファイルかを見分ける */
export const RECORDS_FILE_FORMAT = "nekopatch-records";
export const RECORDS_FILE_VERSION = 1;

/** 書き出すファイルの中身。記録は 1 件を 1 行にして、人が開いても読めるようにする */
export function exportText(data: RecordsData, exportedAt: Date): string {
  const head = [
    `"format": ${JSON.stringify(RECORDS_FILE_FORMAT)}`,
    `"version": ${RECORDS_FILE_VERSION}`,
    `"exportedAt": ${JSON.stringify(exportedAt.toISOString())}`,
    `"solvedCount": ${data.solvedCount}`,
  ];
  const lines = data.records.map((r) => `    ${JSON.stringify(normalize(r))}`);
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
  if (!Array.isArray(f.records) || !f.records.every(isClearRecord)) return null;
  return { solvedCount: f.solvedCount, records: f.records.map(normalize) };
}

/**
 * 読み込んだファイルの記録を、今の記録に足す。
 * - 同じ記録（recordKey が同じ）は 2 つにしない。added は新しく増えた件数
 * - 記録は日時の順に並べる
 * - 「クリア ○ 問」は、ファイルの数に、今の記録のうちファイルに無いもの（新しいスマホでだけクリアした分）の数を足す。
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
  const fileKeys = new Set(file.records.map(recordKey));
  const onlyHere = current.records.filter((r) => !fileKeys.has(recordKey(r))).length;
  const records =
    fresh.length === 0
      ? [...current.records]
      : [...current.records, ...fresh].sort((a, b) => a.at - b.at);
  return {
    data: {
      solvedCount: Math.max(current.solvedCount, file.solvedCount + onlyHere),
      records,
    },
    added: fresh.length,
  };
}
