import { describe, expect, it } from "vitest";
import { at } from "./grid.ts";
import { conflicts, isCleared, nextHint } from "./play.ts";
import { countSolutions, generate, type Puzzle, solutionCells } from "./puzzle.ts";
import { applyStep, type CellState, findStep, groups, logicSolve } from "./solver.ts";
import { seededRandom } from "./test-support.ts";

/** 盤面の大きさと難しさの組ごとに、種を変えて 3 問ずつ作る */
const cases: { N: number; diff: number; seed: number }[] = [];
for (const N of [6, 7, 8, 9, 10])
  for (const diff of [1, 2, 3])
    for (const seed of [1, 2, 3]) cases.push({ N, diff, seed: N * 100 + diff * 10 + seed });

const made = cases.map((c) => ({ ...c, p: generate(c.N, c.diff, 0, seededRandom(c.seed)) }));

const emptyBoard = (p: Puzzle): CellState[] => new Array<CellState>(p.N * p.N).fill(0);

describe("問題作り", () => {
  it("作った問題は答えがちょうど 1 つ", () => {
    for (const { p } of made) expect(countSolutions(p.N, p.reg, 3)).toBe(1);
  });

  it("作った問題の答えは、行・列・エリアに 1 匹ずつで、隣り合わない", () => {
    for (const { N, p } of made) {
      expect(p.N).toBe(N);
      expect(p.reg).toHaveLength(N * N);
      expect(new Set(p.cats).size).toBe(N); // 列に 1 匹ずつ（行は cats の添字なので 1 匹ずつ）
      const st = emptyBoard(p);
      for (const i of solutionCells(p)) st[i] = 2;
      expect(conflicts(p, st).bad.size).toBe(0);
      expect(new Set([...solutionCells(p)].map((i) => at(p.reg, i))).size).toBe(N); // エリアに 1 匹ずつ
      expect(isCleared(p, st)).toBe(true);
    }
  });

  it("作った問題は、選んだ難しさまでの手で解ける", () => {
    for (const { diff, p } of made) {
      const res = logicSolve(p.N, p.reg, diff);
      expect(res.solved).toBe(true);
      expect(res.maxUsed).toBeLessThanOrEqual(diff);
    }
  });

  it("時間に余裕があれば、選んだ難しさちょうどの手が要る問題を選ぶ", () => {
    // 元の作り方と同じく、ちょうどの難しさが見つかればそれを返す（見つからなければ一番難しいもの）
    // 時計は、呼ぶたびに 1 進む偽物にする（試す回数が毎回同じになる）
    let tick = 0;
    const p = generate(8, 3, 1000, seededRandom(42), () => tick++);
    expect(p.level).toBe(3);
  });
});

describe("ヒント", () => {
  const p = generate(6, 2, 0, seededRandom(7));
  const sol = solutionCells(p);
  const notSolution = [...Array(p.N * p.N).keys()].filter((i) => !sol.has(i));

  it("間違えたマスがあれば、ヒントはそれを教える", () => {
    const st = emptyBoard(p);
    const wrongCat = at(notSolution, 0);
    st[wrongCat] = 2;
    expect(nextHint(p, st)).toEqual({ kind: "wrong", cells: [wrongCat] });
  });

  it("間違いが無ければ、ヒントは理詰めの次の 1 手を教える", () => {
    const hint = nextHint(p, emptyBoard(p));
    expect(hint?.kind).toBe("step");
    if (hint?.kind !== "step") return;
    expect(hint.step.cells.length).toBeGreaterThan(0);
    expect(hint.step.msg).not.toBe("");
    // 教えた手は答えと食い違わない（× なら答えでないマス、猫なら答えのマス）
    for (const i of hint.step.cells) expect(sol.has(i)).toBe(hint.step.to === 2);
  });

  it("ヒントの手をたどると、答えにたどり着く", () => {
    const st = emptyBoard(p);
    const G = groups(p.N, p.reg);
    for (let n = 0; n < 500 && !isCleared(p, st); n++) {
      let step = null;
      for (let l = 1; l <= 3 && step === null; l++)
        step = findStep(p.N, p.reg, st, G, l, Array(p.N).fill(""));
      if (step === null) break;
      applyStep(st, step);
    }
    expect(isCleared(p, st)).toBe(true);
  });
});
