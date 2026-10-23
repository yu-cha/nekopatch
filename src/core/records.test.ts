import { describe, expect, it } from "vitest";
import type { ClearRecord } from "./records.ts";
import {
  boardRows,
  classifyPlays,
  compareWin,
  exportFileName,
  exportText,
  historyRows,
  importRecords,
  parseExport,
  parseStoredBoards,
  parseStoredHistory,
  type RecordsData,
  recordKey,
  serializeBoards,
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
    const none = new Map<string, string>();
    expect(historyRows([B, A, C], none, null, 30)).toEqual({
      rows: [
        { record: C, code: null, id: null, nth: 1, diff: -50000 },
        { record: A, code: null, id: null, nth: 1, diff: null },
        { record: B, code: null, id: null, nth: 1, diff: null },
      ],
      more: false,
    });
    const two = historyRows([B, A, C], none, null, 2);
    expect(two.rows.map((r) => r.record)).toEqual([C, A]);
    expect(two.more).toBe(true);
  });

  it("クリアしたときの比べ（前回、平均、自己ベスト）", () => {
    expect(compareWin([B, A], C)).toEqual({
      kind: "first",
      prev: B,
      avg: 175000,
      count: 2,
      isBest: true,
    });
    expect(compareWin([A], B)).toEqual({
      kind: "first",
      prev: null,
      avg: 200000,
      count: 1,
      isBest: false,
    });
  });
});

describe("書き出しと読み込み", () => {
  const data: RecordsData = { solvedCount: 812, records: [A, B, C], boards: new Map() };

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
    const empty = { solvedCount: 0, records: [], boards: new Map() };
    expect(parseExport(exportText(empty, new Date()))).toEqual(empty);
  });

  it("ファイルの名前には、その日の日付が入る", () => {
    expect(exportFileName(new Date(2026, 9, 22, 23, 59))).toBe("nekopatch-records-2026-10-22.json");
  });

  it("同じ記録は 2 つにしない", () => {
    const { data: merged, added } = importRecords(
      { solvedCount: 2, records: [A, B], boards: new Map() },
      { solvedCount: 2, records: [C, B], boards: new Map() },
    );
    expect(merged.records).toEqual([A, B, C]);
    expect(added).toBe(1);
  });

  it("同じ日時でもタイムが違えば、別の記録として足す", () => {
    const other = { ...B, t: B.t + 1 };
    const { data: merged } = importRecords(
      { solvedCount: 1, records: [B], boards: new Map() },
      { solvedCount: 1, records: [other], boards: new Map() },
    );
    expect(merged.records).toEqual([B, other]);
  });

  it("同じファイルを何回読み込んでも、同じ結果になる", () => {
    const file = { solvedCount: 5, records: [A, C], boards: new Map() };
    const once = importRecords({ solvedCount: 1, records: [B], boards: new Map() }, file).data;
    const twice = importRecords(once, file);
    expect(twice.data).toEqual(once);
    expect(twice.added).toBe(0);
  });

  it("新しいスマホで先に遊んだ分を、クリアの数に足す", () => {
    const old = Array.from({ length: 790 }, (_, i) => rec(1700000000000 + i * 1000, 8, 2, 60000));
    const here = [rec(1761200000000, 6, 1, 50000), rec(1761200001000, 6, 1, 51000), C];
    const file = { solvedCount: 800, records: old, boards: new Map() };
    const once = importRecords({ solvedCount: 3, records: here, boards: new Map() }, file).data;
    expect(once.solvedCount).toBe(803);
    expect(once.records).toHaveLength(793);
    // 同じファイルをもう一度読み込んでも 803 のまま
    expect(importRecords(once, file).data.solvedCount).toBe(803);
  });

  it("読み込んでも、クリアの数は減らない", () => {
    const records = [A, B, C];
    const merged = importRecords(
      { solvedCount: 900, records, boards: new Map() },
      { solvedCount: 800, records, boards: new Map() },
    );
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
    expect(parseExport(JSON.stringify(ok))).toEqual({
      solvedCount: 1,
      records: [A],
      boards: new Map(),
    });
  });
});

/** 8×8 の盤面の符号の形をした文字（記録の処理は、符号を見分けるのに使うだけなので、中身は問わない） */
const XA = "A".repeat(32);
const XB = "B".repeat(32);
const XC = "C".repeat(32);

function boardsOf(entries: [ClearRecord, string][]): Map<string, string> {
  return new Map(entries.map(([r, code]) => [recordKey(r), code]));
}

// 8×8・ふつうで、盤面 A を 5:00（ヒント 3）、盤面 B を 3:00（ヒント 1）、A をもう一度 1:30（ヒント 0）
const a1 = rec(1761300000000, 8, 2, 300000, 3);
const b1 = rec(1761300100000, 8, 2, 180000, 1);
const a2 = rec(1761300200000, 8, 2, 90000, 0);
const played = boardsOf([
  [a1, XA],
  [b1, XB],
  [a2, XA],
]);

describe("もう一度遊んだ記録", () => {
  it("同じ盤面の 2 回目からを、もう一度遊んだ記録とする", () => {
    expect(classifyPlays([a1, b1, a2, C], played).map((p) => p.nth)).toEqual([1, 1, 2, 1]);
    // 盤面の形が無い記録は、いつも 1 回目
    expect(classifyPlays([B, C], new Map()).map((p) => p.nth)).toEqual([1, 1]);
  });

  it("難しさが違えば、同じ形でも別の盤面とする", () => {
    const hard = rec(1761300300000, 8, 3, 90000, 0);
    const boards = boardsOf([
      [a1, XA],
      [hard, XA],
    ]);
    expect(classifyPlays([a1, hard], boards).map((p) => p.nth)).toEqual([1, 1]);
  });

  it("成績のまとめには、もう一度遊んだ記録を入れない", () => {
    expect(summarize([a1, b1, a2], played)).toEqual([
      { n: 8, d: 2, count: 2, avg: 240000, best: 180000, last: 180000, avgHints: 2 },
    ]);
  });

  it("新しい順の一覧では、もう一度遊んだ行を、同じ盤面の前回と比べる", () => {
    const { rows } = historyRows([a1, b1, a2], played, null, 30);
    expect(rows.map((r) => [r.nth, r.diff])).toEqual([
      [2, -210000],
      [1, -120000],
      [1, null],
    ]);
    expect(rows[0]?.id).toBe(rows[2]?.id);
    expect(rows[1]?.id).not.toBe(rows[0]?.id);
  });

  it("新しい順の一覧を、大きさ・難しさで絞る", () => {
    const { rows, more } = historyRows([A, a1, b1, a2], played, { n: 6, d: 1 }, 1);
    expect(rows.map((r) => r.record)).toEqual([A]);
    expect(more).toBe(false);
  });

  it("盤面ごとの一覧を、ベストの遅い順・速い順・ヒントの多い順に並べる", () => {
    const records = [a1, b1, a2, A];
    const slow = boardRows(records, played, null, "slow", 30);
    expect(slow.rows.map((r) => [r.code, r.first, r.best, r.count, r.minHints])).toEqual([
      [XB, 180000, 180000, 1, 1],
      [XA, 300000, 90000, 2, 0],
    ]);
    expect(slow.more).toBe(false);
    expect(boardRows(records, played, null, "fast", 30).rows.map((r) => r.code)).toEqual([XA, XB]);
    expect(boardRows(records, played, null, "hints", 30).rows.map((r) => r.code)).toEqual([XB, XA]);
    const one = boardRows(records, played, null, "slow", 1);
    expect(one.rows).toHaveLength(1);
    expect(one.more).toBe(true);
    expect(boardRows(records, played, { n: 6, d: 1 }, "slow", 30).rows).toEqual([]);
  });

  it("クリアしたときの比べで、同じ盤面の前の記録があれば、もう一度として比べる", () => {
    const faster = rec(1761300300000, 8, 2, 85000, 0);
    expect(compareWin([a1, b1, a2], faster, played, XA)).toEqual({
      kind: "replay",
      nth: 3,
      prev: a2,
      best: 85000,
      isBest: true,
    });
    const slower = rec(1761300300000, 8, 2, 100000, 0);
    expect(compareWin([a1, b1, a2], slower, played, XA)).toEqual({
      kind: "replay",
      nth: 3,
      prev: a2,
      best: 90000,
      isBest: false,
    });
    // 初めての盤面は、初めて遊んだ記録とだけ比べる（a2 は比べない）
    const c1 = rec(1761300300000, 8, 2, 360000, 0);
    expect(compareWin([a1, b1, a2], c1, played, XC)).toEqual({
      kind: "first",
      prev: b1,
      avg: 280000,
      count: 3,
      isBest: false,
    });
  });
});

describe("盤面の形の保存の形", () => {
  it("保存した盤面の形を読むと、同じものに戻る", () => {
    expect(parseStoredBoards(serializeBoards(played))).toEqual({ boards: played, intact: true });
    const one = boardsOf([[rec(1761100000000, 8, 2, 65432, 0), XA]]);
    expect(serializeBoards(one)).toBe(`{"1761100000000|8|2|65432|0":"${XA}"}`);
  });

  it("盤面の形が無ければ、空で読めない部分も無い", () => {
    expect(parseStoredBoards(null)).toEqual({ boards: new Map(), intact: true });
  });

  it("読めない盤面の形は飛ばして、読めない部分があったと知らせる", () => {
    const raw = JSON.stringify({
      [recordKey(a1)]: XA,
      [recordKey(b1)]: "short",
      x: XA,
      [recordKey(A)]: XA, // 6×6 の記録に、8×8 の長さの符号
      [recordKey(B)]: 3,
    });
    expect(parseStoredBoards(raw)).toEqual({ boards: boardsOf([[a1, XA]]), intact: false });
    expect(parseStoredBoards("[1]").intact).toBe(false);
    expect(parseStoredBoards("{").intact).toBe(false);
  });
});

describe("盤面の形の書き出しと読み込み", () => {
  it("盤面の形がある記録は、書き出したファイルの行に b が入り、読むと戻る", () => {
    const data: RecordsData = { solvedCount: 3, records: [A, B, C], boards: boardsOf([[B, XB]]) };
    const text = exportText(data, new Date("2026-10-23T01:00:00Z"));
    expect(parseExport(text)).toEqual(data);
    expect(JSON.parse(text).version).toBe(1);
    const lines = text.split("\n").filter((l) => l.includes('"at"'));
    expect(lines.filter((l) => l.includes('"b"'))).toEqual([
      `    ${JSON.stringify({ ...B, b: XB })},`,
    ]);
  });

  it("盤面の形が、記録の大きさの盤面の符号でなければ、何も読み込まない", () => {
    for (const b of [XB.slice(1), 12, null, "A".repeat(16)]) {
      const file = {
        format: "nekopatch-records",
        version: 1,
        solvedCount: 1,
        records: [{ ...B, b }],
      };
      expect(parseExport(JSON.stringify(file))).toBeNull();
    }
  });

  it("読み込むと、盤面の形も足す（今の値は変えない）", () => {
    const current = { solvedCount: 1, records: [B], boards: boardsOf([[B, XB]]) };
    const file = {
      solvedCount: 2,
      records: [B, C],
      boards: boardsOf([
        [B, XA],
        [C, XC],
      ]),
    };
    expect(importRecords(current, file).data.boards).toEqual(
      boardsOf([
        [B, XB],
        [C, XC],
      ]),
    );
  });

  it("新しいスマホでもう一度遊んだ分は、クリアの数に足さない", () => {
    const old = Array.from({ length: 790 }, (_, i) => rec(1700000000000 + i * 1000, 8, 2, 60000));
    const x1 = rec(1761400000000, 8, 2, 200000, 0);
    const x2 = rec(1761400100000, 8, 2, 100000, 0);
    const here = {
      solvedCount: 1,
      records: [x1, x2],
      boards: boardsOf([
        [x1, XA],
        [x2, XA],
      ]),
    };
    const file = { solvedCount: 800, records: old, boards: new Map() };
    const once = importRecords(here, file).data;
    expect(once.solvedCount).toBe(801);
    expect(importRecords(once, file).data.solvedCount).toBe(801);
  });
});
