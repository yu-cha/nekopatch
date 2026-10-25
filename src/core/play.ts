// 遊んでいる盤面の判定（猫どうしのぶつかり、クリア、ヒント）。

import { at, rowOf } from "./grid.ts";
import { type Puzzle, solutionCells } from "./puzzle.ts";
import { type CellState, findStep, groups, type Step } from "./solver.ts";

/** 色のエリアの名前（エリアの番号の順） */
export const REGION_NAMES: readonly string[] = [
  "ピンク",
  "水色",
  "黄色",
  "緑",
  "紫",
  "オレンジ",
  "青",
  "茶色",
  "グレー",
  "赤",
];

/** 難しさの名前（1〜3） */
export const LEVEL_NAMES: readonly string[] = ["", "簡単", "普通", "難しい"];

/** 盤面の大きさとして選べるもの */
export const SIZES: readonly number[] = [6, 7, 8, 9, 10];
/** 難しさとして選べるもの */
export const LEVELS: readonly number[] = [1, 2, 3];

/** ぶつかっている猫のマスと、置いた猫の数 */
export function conflicts(
  p: Puzzle,
  st: readonly CellState[],
): { bad: Set<number>; count: number } {
  const N = p.N;
  const bad = new Set<number>();
  const cats: number[] = [];
  for (let i = 0; i < N * N; i++) if (at(st, i) === 2) cats.push(i);
  for (let a = 0; a < cats.length; a++)
    for (let b = a + 1; b < cats.length; b++) {
      const i = at(cats, a);
      const j = at(cats, b);
      const ri = rowOf(N, i);
      const ci = i % N;
      const rj = rowOf(N, j);
      const cj = j % N;
      if (
        ri === rj ||
        ci === cj ||
        at(p.reg, i) === at(p.reg, j) ||
        (Math.abs(ri - rj) <= 1 && Math.abs(ci - cj) <= 1)
      ) {
        bad.add(i);
        bad.add(j);
      }
    }
  return { bad, count: cats.length };
}

/** 猫が N 匹そろい、ぶつかりが無ければクリア */
export function isCleared(p: Puzzle, st: readonly CellState[]): boolean {
  const { bad, count } = conflicts(p, st);
  return count === p.N && bad.size === 0;
}

export type Hint =
  /** 間違えているマス（答えでないところの猫、答えのところの ×） */
  | { readonly kind: "wrong"; readonly cells: number[] }
  /** 理詰めの次の 1 手 */
  | { readonly kind: "step"; readonly step: Step }
  /** 理詰めの手が見つからないので、猫の場所を 1 つ教える */
  | { readonly kind: "reveal"; readonly cell: number };

export function nextHint(p: Puzzle, st: readonly CellState[]): Hint | null {
  const N = p.N;
  const sol = solutionCells(p);
  const wrong: number[] = [];
  for (let i = 0; i < N * N; i++) {
    const v = at(st, i);
    if (v === 2 && !sol.has(i)) wrong.push(i);
    if (v === 1 && sol.has(i)) wrong.push(i);
  }
  if (wrong.length > 0) return { kind: "wrong", cells: wrong };
  const G = groups(N, p.reg);
  for (let l = 1; l <= 3; l++) {
    const step = findStep(N, p.reg, st, G, l, REGION_NAMES);
    if (step !== null) return { kind: "step", step };
  }
  const cell = [...sol].find((j) => at(st, j) !== 2);
  return cell === undefined ? null : { kind: "reveal", cell };
}

/** 時間の表示（分:秒） */
export function formatTime(ms: number): string {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
