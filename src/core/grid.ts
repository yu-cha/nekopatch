// 盤面の共通の道具。盤面は N×N のマスを、左上から行ごとに 0, 1, 2, … と番号で表す。

/** 0 から 1 未満の乱数を返す関数（Math.random と同じ形）。テストでは決まった並びに差し替える */
export type Random = () => number;

/** 配列の i 番目。範囲の外を読んだら、黙って undefined を使わずに止める */
export function at<T>(items: readonly T[], i: number): T {
  const item = items[i];
  if (item === undefined) throw new RangeError(`範囲の外です: ${i}（長さ ${items.length}）`);
  return item;
}

export function randomInt(random: Random, n: number): number {
  return Math.floor(random() * n);
}

export function shuffle<T>(items: T[], random: Random): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = randomInt(random, i + 1);
    const a = at(items, i);
    items[i] = at(items, j);
    items[j] = a;
  }
  return items;
}

export function rowOf(N: number, i: number): number {
  return Math.floor(i / N);
}

/** 上下左右の隣のマス */
export function neighbors4(N: number, i: number): number[] {
  const r = rowOf(N, i);
  const c = i % N;
  const out: number[] = [];
  if (r > 0) out.push(i - N);
  if (r < N - 1) out.push(i + N);
  if (c > 0) out.push(i - 1);
  if (c < N - 1) out.push(i + 1);
  return out;
}

/** 斜めも含めた周りの 8 マス */
export function neighbors8(N: number, i: number): number[] {
  const r = rowOf(N, i);
  const c = i % N;
  const out: number[] = [];
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const rr = r + dr;
      const cc = c + dc;
      if (rr >= 0 && rr < N && cc >= 0 && cc < N) out.push(rr * N + cc);
    }
  }
  return out;
}
