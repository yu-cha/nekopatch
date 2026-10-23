import { describe, expect, it } from "vitest";
import {
  boardCodeLength,
  boardId,
  decodeBoard,
  encodeBoard,
  isBoardCode,
  restorePuzzle,
  solveUnique,
} from "./board.ts";
import { LEVELS, SIZES } from "./play.ts";
import { generate } from "./puzzle.ts";
import { seededRandom } from "./test-support.ts";

/** 選べる大きさ・難しさの組ごとに、決まった問題を 1 問ずつ */
const made = SIZES.flatMap((N) =>
  LEVELS.map((diff) => generate(N, diff, 0, seededRandom(N * 100 + diff))),
);

describe("盤面の符号", () => {
  it("盤面の符号から、同じ盤面を作り直せる", () => {
    for (const p of made) {
      const code = encodeBoard(p.N, p.reg);
      expect(isBoardCode(p.N, code)).toBe(true);
      const back = restorePuzzle(p.N, code);
      expect(back?.reg).toEqual(p.reg);
      expect(back?.cats).toEqual(p.cats);
    }
    expect(boardCodeLength(6)).toBe(16);
    expect(boardCodeLength(8)).toBe(32);
    expect(boardCodeLength(10)).toBe(56);
  });

  it("符号は URL に使える文字だけで、決まった長さ", () => {
    for (const p of made) {
      const code = encodeBoard(p.N, p.reg);
      expect(code).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(code).toHaveLength(boardCodeLength(p.N));
    }
    // 全部が 0 の盤面でも、先頭を省かない
    expect(encodeBoard(6, new Array(36).fill(0))).toBe("A".repeat(16));
    expect(decodeBoard(6, "A".repeat(16))).toEqual(new Array(36).fill(0));
  });

  it("作り直した問題の要る手の高さは、元の問題と同じ", () => {
    for (const p of made) expect(restorePuzzle(p.N, encodeBoard(p.N, p.reg))?.level).toBe(p.level);
  });

  it("盤面の符号として読めないものは読まない", () => {
    const p = made[0];
    if (p === undefined) throw new Error("問題がありません");
    const code = encodeBoard(p.N, p.reg);
    expect(isBoardCode(p.N, code.slice(1))).toBe(false); // 短い
    expect(isBoardCode(p.N, `${code}A`)).toBe(false); // 長い
    expect(isBoardCode(p.N, `${code.slice(1)}=`)).toBe(false); // 使わない文字
    expect(isBoardCode(5, code)).toBe(false); // 選べない大きさ
    expect(isBoardCode(p.N, 12)).toBe(false);
    // 6×6 の値の範囲（6^36）を超える数
    expect(decodeBoard(6, "_".repeat(16))).toBeNull();
  });

  it("答えがちょうど 1 つでない盤面は、遊ぶ問題にしない", () => {
    // 全部が 1 つのエリア: 答えが無い
    expect(restorePuzzle(6, encodeBoard(6, new Array(36).fill(0)))).toBeNull();
    // 列ごとにエリア: 答えが 2 つ以上ある
    const columns = Array.from({ length: 36 }, (_, i) => i % 6);
    expect(solveUnique(6, columns)).toBeNull();
    expect(restorePuzzle(6, encodeBoard(6, columns))).toBeNull();
  });
});

describe("盤面 ID", () => {
  it("盤面 ID は、同じ盤面ならいつも同じで、盤面が違えば違う", () => {
    const ids = made.map((p) => boardId(p.N, encodeBoard(p.N, p.reg)));
    for (const id of ids) expect(id).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}$/);
    expect(new Set(ids).size).toBe(ids.length);
    const p = made[3];
    if (p === undefined) throw new Error("問題がありません");
    expect(boardId(p.N, encodeBoard(p.N, [...p.reg]))).toBe(ids[3]);
  });

  it("似た盤面でも、盤面 ID はかぶりにくい", () => {
    // 8×8 の盤面と 1 マスだけ違う盤面（448 個）で、ID がかぶらない（25 ビットなので、かぶる組は平均 0.003 組）
    const p = made.find((m) => m.N === 8);
    if (p === undefined) throw new Error("問題がありません");
    const ids = new Set([boardId(p.N, encodeBoard(p.N, p.reg))]);
    for (let i = 0; i < p.reg.length; i++)
      for (let v = 0; v < p.N; v++) {
        if (v === p.reg[i]) continue;
        const reg = [...p.reg];
        reg[i] = v;
        ids.add(boardId(p.N, encodeBoard(p.N, reg)));
      }
    expect(ids.size).toBe(1 + 64 * 7);
  });
});
