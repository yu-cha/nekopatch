// ブラウザの保存領域（localStorage）への読み書き。
// 保存のキーと形は、作り直す前（2026-10-21 まで）と同じ。ナンの今までの記録をそのまま読む。
// 確かめ用のページ（/nekopatch/preview/）は、同じ yu-cha.github.io の保存領域を本物と共有するので、
// 別のキーを使い、本物のキーには書かない（decisions の 2026-10-22 の判断を参照）。

import {
  type ClearRecord,
  type GameState,
  parseSavedGame,
  parseStoredHistory,
  type SavedGame,
  serializeGame,
  serializeHistory,
} from "../../core/index.ts";

/** localStorage のうち、使う部分 */
export interface KeyValue {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface StorageKeys {
  /** 遊びかけの盤面と設定、「クリア ○ 問」の数 */
  readonly game: string;
  /** クリアの記録 */
  readonly history: string;
}

/** 本物のキー（作り直す前と同じ） */
export const MAIN_KEYS: StorageKeys = { game: "nekopatch-v1", history: "nekopatch-history-v1" };

/** 確かめ用のページのキー。すべてこの前置きで始める */
export const TRIAL_PREFIX = "nekopatch-preview-";
export const TRIAL_KEYS: StorageKeys = {
  game: `${TRIAL_PREFIX}v1`,
  history: `${TRIAL_PREFIX}history-v1`,
};

/**
 * 確かめ用の保存領域。prefix で始まらないキーへの書き込みを止める（本物の記録を書き換えないため）。
 * 確かめ用のキーがまだ無ければ、本物の記録を写す（本物は読むだけ）
 */
export function trialStorage(storage: KeyValue, prefix: string = TRIAL_PREFIX): KeyValue {
  const guarded: KeyValue = {
    getItem: (key) => storage.getItem(key),
    setItem(key, value) {
      if (!key.startsWith(prefix))
        throw new Error(`確かめ用のページは、${prefix} で始まらないキーに書きません: ${key}`);
      storage.setItem(key, value);
    },
  };
  for (const name of ["game", "history"] as const) {
    if (guarded.getItem(TRIAL_KEYS[name]) !== null) continue;
    const real = guarded.getItem(MAIN_KEYS[name]);
    if (real !== null) {
      try {
        guarded.setItem(TRIAL_KEYS[name], real);
      } catch {
        // 写せなくても、確かめ用のページは空の記録で動く
      }
    }
  }
  return guarded;
}

/** 記録と状態の保存。保存に失敗したら false を返す（例外は投げない） */
export class SaveStore {
  /** 読めない値を残せなかったキー。上書きすると元の値が失われるので、書かない */
  private readonly locked = new Set<string>();
  /** 読めない値があって、別のキーに残したか */
  unreadableFound = false;

  private readonly kv: KeyValue;
  private readonly keys: StorageKeys;
  private readonly now: () => number;

  constructor(kv: KeyValue, keys: StorageKeys, now: () => number) {
    this.kv = kv;
    this.keys = keys;
    this.now = now;
  }

  loadRecords(): ClearRecord[] {
    const raw = this.read(this.keys.history);
    const { records, intact } = parseStoredHistory(raw);
    if (!intact && raw !== null && this.keepUnreadable(this.keys.history, raw)) {
      // 読めた記録だけで書き直す。次からは、読めない部分を毎回残し直さない
      this.saveRecords(records);
    }
    return records;
  }

  saveRecords(records: readonly ClearRecord[]): boolean {
    return this.write(this.keys.history, serializeHistory(records));
  }

  loadGame(): SavedGame | null {
    const raw = this.read(this.keys.game);
    const { game, intact } = parseSavedGame(raw);
    if (!intact && raw !== null) this.keepUnreadable(this.keys.game, raw);
    return game;
  }

  /** 保存してある「クリア ○ 問」の数。読めなければ 0。読めない値を残し直したりはしない */
  storedSolvedCount(): number {
    return parseSavedGame(this.read(this.keys.game)).game?.solvedCount ?? 0;
  }

  saveGame(state: GameState): boolean {
    return this.write(this.keys.game, serializeGame(state));
  }

  private read(key: string): string | null {
    try {
      return this.kv.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): boolean {
    if (this.locked.has(key)) return false;
    try {
      this.kv.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  /** 読めない値を、消さずに別のキー（<キー>-unreadable-<日時>）に残す */
  private keepUnreadable(key: string, raw: string): boolean {
    this.unreadableFound = true;
    if (this.write(`${key}-unreadable-${this.now()}`, raw)) {
      // 前に残せなかったキーでも、残せたら書き直してよい
      this.locked.delete(key);
      return true;
    }
    this.locked.add(key);
    return false;
  }
}
