// 問題を作る Worker。作るのに数秒かかることがあるので、画面の動きを止めないよう別に動かす（元の nekopatch.html と同じ）。
import { generate } from "../../core/index.ts";

self.onmessage = (e: MessageEvent<{ id: number; N: number; diff: number }>) => {
  const { id, N, diff } = e.data;
  const g = generate(N, diff, 2500);
  self.postMessage({ id, puzzle: { N: g.N, reg: g.reg, cats: g.cats, level: g.level } });
};
