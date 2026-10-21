import { describe, expect, it } from "vitest";
import {
  compareWin,
  exportFileName,
  exportText,
  importRecords,
  parseExport,
  parseStoredHistory,
  type RecordsData,
  recentRows,
  serializeHistory,
  summarize,
} from "./records.ts";
import { rec } from "./test-support.ts";

const A = rec(1761000000000, 6, 1, 90000, 1);
const B = rec(1761000100000, 8, 2, 200000, 0);
const C = rec(1761000200000, 8, 2, 150000, 2);

describe("記録の保存の形", () => {
  it("作り直す前と同じ形で保存する", () => {
    expect(serializeHistory([rec(1761100000000, 8, 2, 65432, 0)])).toBe(
      '[{"at":1761100000000,"n":8,"d":2,"t":65432,"h":0}]',
    );
  });

  it("保存した記録を読むと、同じ記録に戻る（上限で切らない）", () => {
    const many = Array.from({ length: 1200 }, (_, i) => rec(1761000000000 + i, 8, 2, 60000 + i));
    expect(parseStoredHistory(serializeHistory(many))).toEqual({ records: many, intact: true });
  });

  it("記録が無ければ、空で読めない部分も無い", () => {
    expect(parseStoredHistory(null)).toEqual({ records: [], intact: true });
  });

  it("余分な値が付いていても、5 つの値だけを読む", () => {
    const raw = JSON.stringify([{ ...A, extra: "x" }]);
    expect(parseStoredHistory(raw)).toEqual({ records: [A], intact: true });
  });
});

describe("成績のまとめ", () => {
  it("記録がとても多くても、成績をまとめられる", () => {
    const many = Array.from({ length: 200_000 }, (_, i) =>
      rec(1761000000000 + i, 6 + (i % 5), 1 + (i % 3), 30000 + (i % 1000) * 100),
    );
    const summary = summarize(many);
    expect(summary).toHaveLength(15);
    for (const g of summary) {
      expect(g.count).toBeGreaterThan(0);
      expect(g.best).toBeGreaterThanOrEqual(30000);
      expect(Number.isFinite(g.avg)).toBe(true);
    }
    expect(summary.reduce((a, g) => a + g.count, 0)).toBe(200_000);
  });

  it("盤面・難しさごとに、回数・平均・ベスト・前回・平均ヒントを出す", () => {
    expect(summarize([B, A, C])).toEqual([
      { n: 6, d: 1, count: 1, avg: 90000, best: 90000, last: 90000, avgHints: 1 },
      { n: 8, d: 2, count: 2, avg: 175000, best: 150000, last: 150000, avgHints: 1 },
    ]);
  });

  it("最近の記録は新しい順で、同じ盤面・難しさの前回とのタイムの差が付く", () => {
    expect(recentRows([B, A, C], 30)).toEqual([
      { record: C, diff: -50000 },
      { record: A, diff: null },
      { record: B, diff: null },
    ]);
    expect(recentRows([B, A, C], 2).map((r) => r.record)).toEqual([C, A]);
  });

  it("クリアしたときの比べ（前回、平均、自己ベスト）", () => {
    expect(compareWin([B, A], C)).toEqual({ prev: B, avg: 175000, count: 2, isBest: true });
    expect(compareWin([A], B)).toEqual({ prev: null, avg: 200000, count: 1, isBest: false });
  });
});

describe("書き出しと読み込み", () => {
  const data: RecordsData = { solvedCount: 812, records: [A, B, C] };

  it("書き出したファイルを読むと、同じ記録とクリアの数に戻る", () => {
    const text = exportText(data, new Date("2026-10-22T01:00:00Z"));
    expect(parseExport(text)).toEqual(data);
    const json = JSON.parse(text);
    expect(json.format).toBe("nekopatch-records");
    expect(json.version).toBe(1);
    expect(json.exportedAt).toBe("2026-10-22T01:00:00.000Z");
    // 記録は 1 件 1 行
    expect(text.split("\n").filter((l) => l.includes('"at"'))).toHaveLength(3);
  });

  it("記録が無くても書き出して読める", () => {
    const empty = { solvedCount: 0, records: [] };
    expect(parseExport(exportText(empty, new Date()))).toEqual(empty);
  });

  it("ファイルの名前には、その日の日付が入る", () => {
    expect(exportFileName(new Date(2026, 9, 22, 23, 59))).toBe("nekopatch-records-2026-10-22.json");
  });

  it("同じ記録は 2 つにしない", () => {
    const { data: merged, added } = importRecords(
      { solvedCount: 2, records: [A, B] },
      { solvedCount: 2, records: [C, B] },
    );
    expect(merged.records).toEqual([A, B, C]);
    expect(added).toBe(1);
  });

  it("同じ日時でもタイムが違えば、別の記録として足す", () => {
    const other = { ...B, t: B.t + 1 };
    const { data: merged } = importRecords(
      { solvedCount: 1, records: [B] },
      { solvedCount: 1, records: [other] },
    );
    expect(merged.records).toEqual([B, other]);
  });

  it("同じファイルを何回読み込んでも、同じ結果になる", () => {
    const file = { solvedCount: 5, records: [A, C] };
    const once = importRecords({ solvedCount: 1, records: [B] }, file).data;
    const twice = importRecords(once, file);
    expect(twice.data).toEqual(once);
    expect(twice.added).toBe(0);
  });

  it("新しいスマホで先に遊んだ分を、クリアの数に足す", () => {
    const old = Array.from({ length: 790 }, (_, i) => rec(1700000000000 + i * 1000, 8, 2, 60000));
    const here = [rec(1761200000000, 6, 1, 50000), rec(1761200001000, 6, 1, 51000), C];
    const file = { solvedCount: 800, records: old };
    const once = importRecords({ solvedCount: 3, records: here }, file).data;
    expect(once.solvedCount).toBe(803);
    expect(once.records).toHaveLength(793);
    // 同じファイルをもう一度読み込んでも 803 のまま
    expect(importRecords(once, file).data.solvedCount).toBe(803);
  });

  it("読み込んでも、クリアの数は減らない", () => {
    const records = [A, B, C];
    const merged = importRecords({ solvedCount: 900, records }, { solvedCount: 800, records });
    expect(merged.data.solvedCount).toBe(900);
  });

  it("一部だけ読めるファイルは、何も読み込まない", () => {
    const text = JSON.stringify({
      format: "nekopatch-records",
      version: 1,
      solvedCount: 3,
      records: [A, B, { ...C, t: "2:30" }],
    });
    expect(parseExport(text)).toBeNull();
  });

  it("読めないファイルの形は、どれも読み込まない", () => {
    const ok = { format: "nekopatch-records", version: 1, solvedCount: 1, records: [A] };
    const bad: unknown[] = [
      { ...ok, format: "other" },
      { ...ok, version: 2 },
      { ...ok, solvedCount: -1 },
      { ...ok, solvedCount: 1.5 },
      { ...ok, records: "x" },
      { ...ok, records: [{ ...A, n: 11 }] },
      { ...ok, records: [{ ...A, d: 4 }] },
      { ...ok, records: [{ ...A, h: -1 }] },
      [A],
      null,
    ];
    for (const b of bad) expect(parseExport(JSON.stringify(b))).toBeNull();
    expect(parseExport('{"format": "nekopatch-records", "records": [')).toBeNull();
    expect(parseExport(JSON.stringify(ok))).toEqual({ solvedCount: 1, records: [A] });
  });
});
