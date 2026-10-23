import { describe, expect, it } from "vitest";
import {
  changeNote,
  cleanMemo,
  hasRemark,
  MEMO_MAX,
  mergeNotes,
  NO_NOTES,
  type Notes,
  parseStoredNotes,
  type RecordNote,
  serializeNotes,
} from "./notes.ts";

const KA = "1761000000000|8|2|200000|0";
const KB = "1761000100000|6|1|90000|1";

describe("文の整え方", () => {
  it("前後の空白（全角の空白を含む）と、改行などの制御文字を除く", () => {
    expect(cleanMemo("  左下で\n迷った  ")).toBe("左下で迷った");
    expect(cleanMemo("　難しかった！\t")).toBe("難しかった！");
    expect(cleanMemo("   ")).toBe("");
  });

  it("30 文字（符号位置で数える）までにする", () => {
    expect(cleanMemo("あ".repeat(40))).toBe("あ".repeat(MEMO_MAX));
    // 絵文字（UTF-16 では 2 つ）も 1 文字に数える
    expect(Array.from(cleanMemo("😺".repeat(40)))).toHaveLength(MEMO_MAX);
    // 切ったところが空白なら、それも除く
    expect(cleanMemo(`${"あ".repeat(29)} いう`)).toBe("あ".repeat(29));
  });
});

describe("備考の項目を変える", () => {
  it("書かなかった欄は今のまま、空の文と外した印は持たない", () => {
    let notes: Notes = NO_NOTES;
    notes = changeNote(notes, KA, { memo: " 左下で迷った " });
    expect(notes.get(KA)).toEqual({ memo: "左下で迷った" });
    notes = changeNote(notes, KA, { hard: true });
    expect(notes.get(KA)).toEqual({ memo: "左下で迷った", hard: true });
    notes = changeNote(notes, KA, { memo: "" });
    expect(notes.get(KA)).toEqual({ hard: true });
    notes = changeNote(notes, KA, { hard: false });
    expect(notes.has(KA)).toBe(false);
  });

  it("元の表は変えない", () => {
    const before = new Map<string, RecordNote>([[KA, { memo: "前" }]]);
    const after = changeNote(before, KA, { memo: "後" });
    expect(before.get(KA)).toEqual({ memo: "前" });
    expect(after.get(KA)).toEqual({ memo: "後" });
  });

  it("備考は文か「難」の印。「自動×」の印だけなら備考は無い", () => {
    expect(hasRemark({ memo: "あ" })).toBe(true);
    expect(hasRemark({ hard: true })).toBe(true);
    expect(hasRemark({ autoX: true })).toBe(false);
    expect(hasRemark(undefined)).toBe(false);
  });
});

describe("備考の保存の形", () => {
  it("保存した備考を読むと、同じものに戻り、欄は memo・hard・autoX の順", () => {
    const notes = new Map<string, RecordNote>([
      [KA, { memo: "左下で迷った", hard: true, autoX: true }],
      [KB, { autoX: true }],
    ]);
    const text = serializeNotes(notes);
    expect(text).toBe(
      `{"${KA}":{"memo":"左下で迷った","hard":true,"autoX":true},"${KB}":{"autoX":true}}`,
    );
    expect(parseStoredNotes(text)).toEqual({ notes, intact: true });
  });

  it("備考が無ければ、空で読めない部分も無い", () => {
    expect(parseStoredNotes(null)).toEqual({ notes: new Map(), intact: true });
    expect(parseStoredNotes("{}")).toEqual({ notes: new Map(), intact: true });
  });

  it("空の文と false の印は、無いものとして読む", () => {
    const { notes, intact } = parseStoredNotes(
      JSON.stringify({ [KA]: { memo: "", hard: false, autoX: true }, [KB]: { memo: "" } }),
    );
    expect(intact).toBe(true);
    expect([...notes]).toEqual([[KA, { autoX: true }]]);
  });

  it("保存してある文は、30 文字より長くても切らずに読む", () => {
    const long = "あ".repeat(50);
    expect(parseStoredNotes(JSON.stringify({ [KA]: { memo: long } })).notes.get(KA)).toEqual({
      memo: long,
    });
  });

  it("読めない項目と欄は飛ばして、読めない部分があったと知らせる", () => {
    const { notes, intact } = parseStoredNotes(
      JSON.stringify({
        [KA]: { memo: 3, hard: true },
        [KB]: "左下",
        "1|2|3": { memo: "鍵が短い" },
        "1761000000000|8|2|200000|x": { memo: "鍵に文字" },
        "1761000000000|8|2|200000|00": { memo: "鍵の数の書き方が違う" },
      }),
    );
    expect(intact).toBe(false);
    // 読めた欄（hard）は使う
    expect([...notes]).toEqual([[KA, { hard: true }]]);
  });

  it("JSON でない、またはオブジェクトでない保存は、読めないと知らせる", () => {
    expect(parseStoredNotes('{"1":').intact).toBe(false);
    expect(parseStoredNotes("[]").intact).toBe(false);
    expect(parseStoredNotes("null").intact).toBe(false);
  });
});

describe("読み込みの備考の合わせ方", () => {
  it("今に備考があれば今のまま、無ければファイルの方。「自動×」はどちらかにあれば付ける", () => {
    const current = new Map<string, RecordNote>([
      [KA, { memo: "今の" }],
      [KB, { autoX: true }],
    ]);
    const file = new Map<string, RecordNote>([
      [KA, { memo: "古い", hard: true, autoX: true }],
      [KB, { memo: "楽勝" }],
      ["1761000200000|8|2|150000|2", { hard: true }],
    ]);
    const merged = mergeNotes(current, file);
    expect(merged.get(KA)).toEqual({ memo: "今の", autoX: true });
    expect(merged.get(KB)).toEqual({ memo: "楽勝", autoX: true });
    expect(merged.get("1761000200000|8|2|150000|2")).toEqual({ hard: true });
    // 今の表は変えない
    expect(current.get(KA)).toEqual({ memo: "今の" });
  });

  it("今の「難」だけの備考も、今の備考として残す", () => {
    const merged = mergeNotes(
      new Map([[KA, { hard: true } as RecordNote]]),
      new Map([[KA, { memo: "ファイル" } as RecordNote]]),
    );
    expect(merged.get(KA)).toEqual({ hard: true });
  });

  it("同じものを 2 回合わせても変わらない", () => {
    const file = new Map<string, RecordNote>([[KA, { memo: "古い", autoX: true }]]);
    const once = mergeNotes(NO_NOTES, file);
    expect(mergeNotes(once, file)).toEqual(once);
  });
});
