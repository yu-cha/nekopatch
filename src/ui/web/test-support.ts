// 画面のテストの道具。localStorage の代わりと、決まった並びの乱数。
import type { Random } from "../../core/index.ts";
import type { KeyValue } from "./save-store.ts";

/** localStorage の代わり。中身を見たり、書き込みを失敗させたりできる */
export class MemoryStorage implements KeyValue {
  readonly items = new Map<string, string>();
  failWrites = false;
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.items.set(k, v);
  }
  getItem(key: string): string | null {
    return this.items.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    if (this.failWrites) throw new Error("QuotaExceededError");
    this.items.set(key, value);
  }
  keysStartingWith(prefix: string): string[] {
    return [...this.items.keys()].filter((k) => k.startsWith(prefix));
  }
}

/** 種から決まる乱数（mulberry32。src/core/test-support.ts と同じ。UI はロジックの入口しか使えないので写した） */
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
