// テストの道具。決まった並びの乱数と、記録を短く書く関数。
import type { Random } from "./grid.ts";
import type { ClearRecord } from "./records.ts";

/** 種から決まる乱数（mulberry32）。同じ種なら、毎回同じ問題ができる */
export function seededRandom(seed: number): Random {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 記録 1 件。at は日時、n は盤面、d は難しさ、t はタイム（ミリ秒）、h はヒントの回数 */
export function rec(at: number, n: number, d: number, t: number, h = 0): ClearRecord {
  return { at, n, d, t, h };
}
