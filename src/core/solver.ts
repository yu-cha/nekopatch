// 理詰めで解く手順。ヒントの文と、問題の難しさの判定に使う。

import { at, neighbors8, rowOf } from "./grid.ts";

/** マスの状態。0 は空白、1 は ×、2 は猫 */
export type CellState = 0 | 1 | 2;

export interface Groups {
  readonly rows: number[][];
  readonly cols: number[][];
  readonly regs: number[][];
}

/** 理詰めの 1 手。cells を to にする。focus は、理由になったマス */
export interface Step {
  readonly cells: number[];
  readonly to: 1 | 2;
  readonly focus: number[];
  readonly msg: string;
}

export function groups(N: number, reg: readonly number[]): Groups {
  const rows: number[][] = [];
  const cols: number[][] = [];
  const regs: number[][] = [];
  for (let k = 0; k < N; k++) {
    rows.push([]);
    cols.push([]);
    regs.push([]);
  }
  for (let i = 0; i < N * N; i++) {
    at(rows, rowOf(N, i)).push(i);
    at(cols, i % N).push(i);
    at(regs, at(reg, i)).push(i);
  }
  return { rows, cols, regs };
}

/** マス i に猫を置いたとき、猫を置けなくなるマス（同じ行・列・色のエリアと、周りの 8 マス） */
export function attacks(N: number, reg: readonly number[], i: number): number[] {
  const s = new Set<number>();
  const r = rowOf(N, i);
  const c = i % N;
  for (let k = 0; k < N; k++) {
    s.add(r * N + k);
    s.add(k * N + c);
  }
  for (let j = 0; j < N * N; j++) if (at(reg, j) === at(reg, i)) s.add(j);
  for (const j of neighbors8(N, i)) s.add(j);
  s.delete(i);
  return [...s];
}

interface Group {
  readonly label: string;
  readonly cells: number[];
}

/**
 * 理詰めの 1 手を探す。見つからなければ null。
 * level: 1 は基本（置いた猫の周りを × にする、残り 1 マス）、2 はそれに加えて行・列への絞り込み、3 はさらに 1 手先読み
 */
export function findStep(
  N: number,
  reg: readonly number[],
  st: readonly CellState[],
  G: Groups,
  level: number,
  names: readonly string[],
): Step | null {
  const allGroups: Group[] = [];
  G.rows.forEach((g, k) => {
    allGroups.push({ label: `${k + 1}行目`, cells: g });
  });
  G.cols.forEach((g, k) => {
    allGroups.push({ label: `${k + 1}列目`, cells: g });
  });
  G.regs.forEach((g, k) => {
    allGroups.push({ label: `${at(names, k)}エリア`, cells: g });
  });
  const stateOf = (j: number) => at(st, j);
  // 1. 置いた猫と同じ行・列・色エリアと、周りのマスは ×
  for (let i = 0; i < N * N; i++) {
    if (stateOf(i) !== 2) continue;
    const t = attacks(N, reg, i).filter((j) => stateOf(j) === 0);
    if (t.length > 0)
      return {
        cells: t,
        to: 1,
        focus: [i],
        msg: "置いた猫と同じ行・列・色エリア、それと周りの8マスには猫が入りません。×を付けましょう。",
      };
  }
  // 2. 猫を置ける場所が残り 1 マスだけの行・列・エリア
  for (const g of allGroups) {
    if (g.cells.some((j) => stateOf(j) === 2)) continue;
    const cand = g.cells.filter((j) => stateOf(j) === 0);
    if (cand.length === 1)
      return {
        cells: cand,
        to: 2,
        focus: g.cells,
        msg: `${g.label}は猫を置ける場所が残り1マスだけです。`,
      };
  }
  if (level < 2) return null;
  // 3. k 個のエリアの候補が k 本の行（列）に収まる → その行（列）のほかのマスは ×。逆向きも同じ
  const open = (cells: readonly number[]) => cells.filter((j) => stateOf(j) === 0);
  for (const dim of ["row", "col"] as const) {
    const lineOf = (i: number) => (dim === "row" ? rowOf(N, i) : i % N);
    const lineName = dim === "row" ? "行" : "列";
    const lines = dim === "row" ? G.rows : G.cols;
    for (let size = 1; size <= 2; size++) {
      const regLines: [number, Set<number>][] = [];
      for (let k = 0; k < N; k++) {
        if (at(G.regs, k).some((j) => stateOf(j) === 2)) continue;
        const ls = new Set(open(at(G.regs, k)).map(lineOf));
        if (ls.size > 0 && ls.size <= size) regLines.push([k, ls]);
      }
      for (const cb of combinations(regLines, size)) {
        const L = new Set<number>();
        for (const x of cb) for (const l of x[1]) L.add(l);
        if (L.size !== size) continue;
        const ks = new Set(cb.map((x) => x[0]));
        const t: number[] = [];
        for (const l of L)
          for (const j of at(lines, l)) if (stateOf(j) === 0 && !ks.has(at(reg, j))) t.push(j);
        if (t.length > 0) {
          const lab = [...L]
            .sort((a, b) => a - b)
            .map((l) => `${l + 1}${lineName}目`)
            .join("と");
          const rn = [...ks].map((k) => at(names, k)).join("と");
          return {
            cells: t,
            to: 1,
            focus: [...ks].flatMap((k) => at(G.regs, k)),
            msg: `${rn}エリアの猫は${lab}にしか入れません。だから${lab}の他の色のマスは×です。`,
          };
        }
      }
      // 逆向き: k 本の行（列）の候補が k 個のエリアに収まる
      const lineRegs: [number, Set<number>][] = [];
      for (let l = 0; l < N; l++) {
        if (at(lines, l).some((j) => stateOf(j) === 2)) continue;
        const rs = new Set(open(at(lines, l)).map((j) => at(reg, j)));
        if (rs.size > 0 && rs.size <= size) lineRegs.push([l, rs]);
      }
      for (const cb of combinations(lineRegs, size)) {
        const R = new Set<number>();
        for (const x of cb) for (const k of x[1]) R.add(k);
        if (R.size !== size) continue;
        const ls = new Set(cb.map((x) => x[0]));
        const t: number[] = [];
        for (const k of R)
          for (const j of at(G.regs, k)) if (stateOf(j) === 0 && !ls.has(lineOf(j))) t.push(j);
        if (t.length > 0) {
          const lab = [...ls]
            .sort((a, b) => a - b)
            .map((l) => `${l + 1}${lineName}目`)
            .join("と");
          const rn = [...R].map((k) => at(names, k)).join("と");
          return {
            cells: t,
            to: 1,
            focus: [...ls].flatMap((l) => at(lines, l)),
            msg: `${lab}の猫は${rn}エリアのどこかに入ります。だから${rn}エリアの、${lab}以外のマスは×です。`,
          };
        }
      }
    }
  }
  if (level < 3) return null;
  // 4. 先読み: ここに猫を置くと、どこかの行・列・エリアに猫を置けなくなる → ここは ×
  for (let i = 0; i < N * N; i++) {
    if (stateOf(i) !== 0) continue;
    const att = new Set(attacks(N, reg, i));
    for (const g of allGroups) {
      if (g.cells.includes(i)) continue;
      if (g.cells.some((j) => stateOf(j) === 2)) continue;
      const cand = g.cells.filter((j) => stateOf(j) === 0);
      if (cand.length > 0 && cand.every((j) => att.has(j))) {
        return {
          cells: [i],
          to: 1,
          focus: g.cells.concat([i]),
          msg: `もしこのマスに猫を置くと、${g.label}に猫を置ける場所がなくなってしまいます。だからここは×です。`,
        };
      }
    }
  }
  return null;
}

/** size が 1 なら 1 個ずつ、2 なら 2 個の組を、元の並びの順に返す */
function combinations<T>(items: readonly T[], size: number): T[][] {
  if (size === 1) return items.map((a) => [a]);
  const out: T[][] = [];
  for (let a = 0; a < items.length; a++)
    for (let b = a + 1; b < items.length; b++) out.push([at(items, a), at(items, b)]);
  return out;
}

export function applyStep(st: CellState[], step: Step): void {
  for (const j of step.cells) st[j] = step.to;
}

/** 理詰めだけで解けるかを試す。maxUsed は、使った手の一番高い level */
export function logicSolve(
  N: number,
  reg: readonly number[],
  level: number,
): { solved: boolean; maxUsed: number; steps: number } {
  const G = groups(N, reg);
  const names: string[] = new Array(N).fill("");
  const st: CellState[] = new Array<CellState>(N * N).fill(0);
  let maxUsed = 1;
  let steps = 0;
  while (true) {
    let step: Step | null = null;
    let used = 0;
    for (let l = 1; l <= level; l++) {
      step = findStep(N, reg, st, G, l, names);
      if (step !== null) {
        used = l;
        break;
      }
    }
    if (step === null) break;
    maxUsed = Math.max(maxUsed, used);
    steps++;
    applyStep(st, step);
  }
  const cats = st.filter((v) => v === 2).length;
  return { solved: cats === N, maxUsed, steps };
}
