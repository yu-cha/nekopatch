// 問題を作る。猫の答えを先に決め、そこからエリアを育て、答えが 1 つだけで理詰めで解けるものを選ぶ。

import { at, neighbors4, type Random, randomInt, shuffle } from "./grid.ts";
import { logicSolve } from "./solver.ts";

/** 問題。reg はマスごとのエリアの番号、cats は行ごとの猫の列、level は解くのに要る手の高さ（1〜3） */
export interface Puzzle {
  readonly N: number;
  readonly reg: readonly number[];
  readonly cats: readonly number[];
  readonly level: number;
}

/** 行と列に 1 匹ずつ、上下の行で隣り合わないように猫を置く */
export function randomCats(N: number, random: Random): number[] {
  const pos: number[] = new Array(N).fill(0);
  const used: boolean[] = new Array(N).fill(false);
  function bt(r: number): boolean {
    if (r === N) return true;
    const cols = shuffle([...Array(N).keys()], random);
    for (const c of cols) {
      if (at(used, c)) continue;
      if (r > 0 && Math.abs(at(pos, r - 1) - c) <= 1) continue;
      used[c] = true;
      pos[r] = c;
      if (bt(r + 1)) return true;
      used[c] = false;
    }
    return false;
  }
  bt(0);
  return pos;
}

/** 猫のマスを種にして、エリアを育てる。育つ速さをエリアごとに変えて、大きさをばらつかせる */
export function growRegions(N: number, cats: readonly number[], random: Random): number[] {
  const reg: number[] = new Array(N * N).fill(-1);
  for (let r = 0; r < N; r++) reg[r * N + at(cats, r)] = r;
  const w: number[] = [];
  for (let i = 0; i < N; i++) w.push(0.3 + random() * random() * 3);
  let left = N * N - N;
  while (left > 0) {
    // 空いている隣のマスがあるエリアから、重みに応じて 1 つ選ぶ
    let tot = 0;
    const cand: [number, number[]][] = [];
    for (let k = 0; k < N; k++) {
      const opts: number[] = [];
      for (let i = 0; i < N * N; i++) {
        if (at(reg, i) !== k) continue;
        for (const j of neighbors4(N, i)) if (at(reg, j) < 0) opts.push(j);
      }
      if (opts.length > 0) {
        cand.push([k, opts]);
        tot += at(w, k);
      }
    }
    let x = random() * tot;
    let pick = at(cand, cand.length - 1);
    for (const cd of cand) {
      x -= at(w, cd[0]);
      if (x <= 0) {
        pick = cd;
        break;
      }
    }
    const cell = at(pick[1], randomInt(random, pick[1].length));
    reg[cell] = pick[0];
    left--;
  }
  return reg;
}

/** 答えの数を数える（limit に達したら止める） */
export function countSolutions(N: number, reg: readonly number[], limit = 2): number {
  let count = 0;
  const pos: number[] = new Array(N).fill(0);
  function bt(r: number, colMask: number, regMask: number): boolean {
    if (r === N) {
      count++;
      return count >= limit;
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
  return count;
}

/** cats と違う答えを 1 つ探す。無ければ null */
export function altSolution(
  N: number,
  reg: readonly number[],
  cats: readonly number[],
): number[] | null {
  const pos: number[] = new Array(N).fill(0);
  let found: number[] | null = null;
  function bt(r: number, colMask: number, regMask: number, diff: boolean): boolean {
    if (r === N) {
      if (diff) {
        found = pos.slice();
        return true;
      }
      return false;
    }
    for (let c = 0; c < N; c++) {
      if (colMask & (1 << c)) continue;
      if (r > 0 && Math.abs(at(pos, r - 1) - c) <= 1) continue;
      const g = at(reg, r * N + c);
      if (regMask & (1 << g)) continue;
      pos[r] = c;
      if (bt(r + 1, colMask | (1 << c), regMask | (1 << g), diff || c !== at(cats, r))) return true;
    }
    return false;
  }
  bt(0, 0, 0, false);
  return found;
}

/** エリア k から skip のマスを抜いても、エリアがつながったままか */
function connectedWithout(N: number, reg: readonly number[], k: number, skip: number): boolean {
  const cells: number[] = [];
  for (let i = 0; i < N * N; i++) if (at(reg, i) === k && i !== skip) cells.push(i);
  const first = cells[0];
  if (first === undefined) return false;
  const seen = new Set([first]);
  const q = [first];
  for (let i = q.pop(); i !== undefined; i = q.pop()) {
    for (const j of neighbors4(N, i))
      if (j !== skip && at(reg, j) === k && !seen.has(j)) {
        seen.add(j);
        q.push(j);
      }
  }
  return seen.size === cells.length;
}

/** 別の答えが無くなるまで、エリアの境目のマスを隣のエリアに移す。できたら true */
export function makeUnique(
  N: number,
  reg: number[],
  cats: readonly number[],
  random: Random,
  maxIter = 60,
): boolean {
  const seed = new Set(cats.map((c, r) => r * N + c));
  for (let it = 0; it < maxIter; it++) {
    const alt = altSolution(N, reg, cats);
    if (alt === null) return true;
    // 別の答えにだけ使われているマス
    const bad = shuffle(
      alt.map((c, r) => r * N + c).filter((i) => !seed.has(i)),
      random,
    );
    let done = false;
    for (const i of bad) {
      const k = at(reg, i);
      const opts = shuffle(
        [...new Set(neighbors4(N, i).map((j) => at(reg, j)))].filter((g) => g !== k),
        random,
      );
      const to = opts[0];
      if (to === undefined || !connectedWithout(N, reg, k, i)) continue;
      reg[i] = to;
      done = true;
      break;
    }
    if (!done) return false;
  }
  return altSolution(N, reg, cats) === null;
}

/**
 * 問題を作る。答えが 1 つだけで、diff までの手で理詰めで解けるもの。
 * ちょうど diff の手が要る問題がすぐ見つかればそれを、時間内に見つからなければ一番難しかったものを返す
 */
export function generate(
  N: number,
  diff: number,
  timeBudget = 1500,
  random: Random = Math.random,
  now: () => number = Date.now,
): Puzzle {
  const t0 = now();
  let best: Puzzle | null = null;
  while (now() - t0 < timeBudget || best === null) {
    const cats = randomCats(N, random);
    const reg = growRegions(N, cats, random);
    if (!makeUnique(N, reg, cats, random)) continue;
    const res = logicSolve(N, reg, diff);
    if (!res.solved) continue;
    const cand: Puzzle = { N, reg, cats, level: res.maxUsed };
    if (res.maxUsed === diff) return cand;
    if (best === null || res.maxUsed > best.level) best = cand;
  }
  return best;
}

/** 答えの猫のマスの番号 */
export function solutionCells(p: Puzzle): Set<number> {
  return new Set(p.cats.map((c, r) => r * p.N + c));
}
