// 盤面の形の符号と、盤面 ID（判断 490d）。
// 符号: 色のエリアの分け方 reg（N² 個の 0〜N−1）を N 進法の 1 つの数とみなし、base64url の文字で、N ごとに決まった長さで書く。
// 盤面 ID: 盤面の大きさと符号から求める 5 文字。画面で見分けるためだけに使い、同じ盤面かどうかは符号で比べる。
// 乱数の種からは同じ盤面を作り直せない（問題作りは時間の予算に左右される）ので、形そのものを残す。

import { at } from "./grid.ts";
import { SIZES } from "./play.ts";
import type { Puzzle } from "./puzzle.ts";
import { logicSolve } from "./solver.ts";

const CODE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const CODE_PATTERN = /^[A-Za-z0-9_-]+$/;
/** 盤面 ID の文字（Crockford の base32。見間違えやすい I・L・O・U を除く） */
const ID_CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const lengths = new Map<number, number>();

/** 大きさ N の盤面の符号の長さ（64^L ≥ N^(N²) となる一番小さい L） */
export function boardCodeLength(N: number): number {
  const known = lengths.get(N);
  if (known !== undefined) return known;
  const max = BigInt(N) ** BigInt(N * N);
  let length = 0;
  for (let p = 1n; p < max; p *= 64n) length++;
  lengths.set(N, length);
  return length;
}

export function encodeBoard(N: number, reg: readonly number[]): string {
  const base = BigInt(N);
  let x = 0n;
  for (const v of reg) x = x * base + BigInt(v);
  const chars: string[] = [];
  for (let k = 0; k < boardCodeLength(N); k++) {
    chars.push(CODE_CHARS.charAt(Number(x & 63n)));
    x >>= 6n;
  }
  return chars.reverse().join("");
}

/**
 * 選べる大きさ N の盤面の符号の形をしているか（文字と長さだけを見る。保存してある全部の記録について、開くたびに確かめるため）。
 * 中身まで確かめるのは、遊ぶときの restorePuzzle
 */
export function isBoardCode(N: number, code: unknown): code is string {
  return (
    typeof code === "string" &&
    SIZES.includes(N) &&
    code.length === boardCodeLength(N) &&
    CODE_PATTERN.test(code)
  );
}

/** 符号から、色のエリアの分け方を戻す。大きさ N の盤面の符号として読めなければ null */
export function decodeBoard(N: number, code: string): number[] | null {
  if (!isBoardCode(N, code)) return null;
  let x = 0n;
  for (const ch of code) x = x * 64n + BigInt(CODE_CHARS.indexOf(ch));
  const base = BigInt(N);
  const reg: number[] = new Array(N * N).fill(0);
  for (let i = N * N - 1; i >= 0; i--) {
    reg[i] = Number(x % base);
    x /= base;
  }
  return x === 0n ? reg : null;
}

/** 盤面 ID。大きさと符号の FNV-1a（32 ビット）をよく混ぜ、上位 25 ビットを 5 文字にする */
export function boardId(N: number, code: string): string {
  const s = `${N}:${code}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // murmur3 の仕上げ（fmix32）。似た符号でも ID が大きく変わるようにする
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  let id = "";
  for (let k = 0; k < 5; k++) id += ID_CHARS.charAt((h >>> (27 - 5 * k)) & 31);
  return id;
}

/** 答えがちょうど 1 つなら、その答え（行ごとの猫の列）。答えが無いか、2 つ以上あれば null */
export function solveUnique(N: number, reg: readonly number[]): number[] | null {
  const pos: number[] = new Array(N).fill(0);
  let found: number[] | null = null;
  let count = 0;
  function bt(r: number, colMask: number, regMask: number): boolean {
    if (r === N) {
      count++;
      if (count === 1) found = pos.slice();
      return count >= 2;
    }
    for (let c = 0; c < N; c++) {
      if (colMask & (1 << c)) continue;
      if (r > 0 && Math.abs(at(pos, r - 1) - c) <= 1) continue;
      const g = at(reg, r * N + c);
      if (regMask & (1 << g)) continue;
      pos[r] = c;
      if (bt(r + 1, colMask | (1 << c), regMask | (1 << g))) return true;
    }
    return false;
  }
  bt(0, 0, 0);
  return count === 1 ? found : null;
}

/** 盤面の形から、遊べる問題を作り直す。読めないか、答えがちょうど 1 つでなければ null */
export function restorePuzzle(N: number, code: string): Puzzle | null {
  const reg = decodeBoard(N, code);
  if (reg === null) return null;
  const cats = solveUnique(N, reg);
  if (cats === null) return null;
  return { N, reg, cats, level: logicSolve(N, reg, 3).maxUsed };
}
