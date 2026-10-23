import { describe, expect, it } from "vitest";
import { recordKey } from "../../core/index.ts";
import { MAIN_KEYS, SaveStore, TRIAL_KEYS, TRIAL_PREFIX, trialStorage } from "./save-store.ts";
import { MemoryStorage } from "./test-support.ts";

const A = { at: 1761000000000, n: 6, d: 1, t: 90000, h: 1 };
const B = { at: 1761000100000, n: 8, d: 2, t: 200000, h: 0 };
const now = () => 1761200000000;
const key = (r: typeof A) => recordKey(r);

describe("保存の場所", () => {
  it("一部だけ読める記録は、読めた分を使い、元の文字も残す", () => {
    const raw = JSON.stringify([A, { ...B, n: 99 }, B]);
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: raw });
    const store = new SaveStore(kv, MAIN_KEYS, now);
    expect(store.loadRecords()).toEqual([A, B]);
    expect(store.unreadableFound).toBe(true);
    expect(kv.getItem(`${MAIN_KEYS.history}-unreadable-1761200000000`)).toBe(raw);
    // 読めた分で書き直すので、次に開いたときは読めない部分が無い
    expect(JSON.parse(kv.getItem(MAIN_KEYS.history) ?? "")).toEqual([A, B]);
    const again = new SaveStore(kv, MAIN_KEYS, now);
    again.loadRecords();
    expect(again.unreadableFound).toBe(false);
  });

  it("読めない値を残せなかったときは、そのキーに書かない", () => {
    const kv = new MemoryStorage({ [MAIN_KEYS.history]: "壊れた値" });
    kv.failWrites = true;
    const store = new SaveStore(kv, MAIN_KEYS, now);
    expect(store.loadRecords()).toEqual([]);
    kv.failWrites = false;
    expect(store.saveRecords([A])).toBe(false);
    expect(kv.getItem(MAIN_KEYS.history)).toBe("壊れた値");
  });

  it("読めない遊びかけの状態も、消さずに別の場所に残す", () => {
    const kv = new MemoryStorage({ [MAIN_KEYS.game]: "{" });
    const store = new SaveStore(kv, MAIN_KEYS, now);
    expect(store.loadGame()).toBeNull();
    expect(store.unreadableFound).toBe(true);
    expect(kv.getItem(`${MAIN_KEYS.game}-unreadable-1761200000000`)).toBe("{");
  });

  it("一部だけ読める盤面の形は、読めた分を使い、元の文字も残す", () => {
    const code = "A".repeat(32);
    const raw = JSON.stringify({ [key(B)]: code, [key(A)]: code });
    const kv = new MemoryStorage({ [MAIN_KEYS.boards]: raw });
    const store = new SaveStore(kv, MAIN_KEYS, now);
    expect(store.loadBoards()).toEqual(new Map([[key(B), code]]));
    expect(store.unreadableFound).toBe(true);
    expect(kv.getItem(`${MAIN_KEYS.boards}-unreadable-1761200000000`)).toBe(raw);
    expect(JSON.parse(kv.getItem(MAIN_KEYS.boards) ?? "")).toEqual({ [key(B)]: code });
  });

  it("保存に失敗したら false を返す", () => {
    const kv = new MemoryStorage();
    const store = new SaveStore(kv, MAIN_KEYS, now);
    kv.failWrites = true;
    expect(store.saveRecords([A])).toBe(false);
    expect(store.saveBoards(new Map())).toBe(false);
  });
});

describe("確かめ用の保存領域", () => {
  it("確かめ用の保存領域は、前置きで始まらないキーへの書き込みを止める", () => {
    const kv = new MemoryStorage();
    const trial = trialStorage(kv);
    expect(() => trial.setItem(MAIN_KEYS.history, "[]")).toThrow();
    expect(() => trial.setItem(MAIN_KEYS.game, "{}")).toThrow();
    expect(() => trial.setItem(MAIN_KEYS.boards, "{}")).toThrow();
    trial.setItem(TRIAL_KEYS.history, "[]");
    expect(kv.keysStartingWith("nekopatch-")).toEqual([TRIAL_KEYS.history]);
    for (const key of Object.values(TRIAL_KEYS)) expect(key.startsWith(TRIAL_PREFIX)).toBe(true);
  });

  it("確かめ用のキーがすでにあれば、本物の値を写し直さない", () => {
    const kv = new MemoryStorage({
      [MAIN_KEYS.history]: JSON.stringify([A, B]),
      [TRIAL_KEYS.history]: "[]",
    });
    trialStorage(kv);
    expect(kv.getItem(TRIAL_KEYS.history)).toBe("[]");
  });

  it("確かめ用のキーが無ければ、本物の盤面の形も写す", () => {
    const boards = JSON.stringify({ [key(B)]: "A".repeat(32) });
    const kv = new MemoryStorage({ [MAIN_KEYS.boards]: boards });
    trialStorage(kv);
    expect(kv.getItem(TRIAL_KEYS.boards)).toBe(boards);
    expect(kv.getItem(MAIN_KEYS.boards)).toBe(boards);
  });
});
