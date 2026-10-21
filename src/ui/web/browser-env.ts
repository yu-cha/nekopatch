// 画面が使うブラウザの機能（app.ts の AppEnv）の本物。
import { generate, type Puzzle } from "../../core/index.ts";
import type { AppEnv } from "./app.ts";
import type { PersistApi } from "./persistence.ts";
import { type KeyValue, MAIN_KEYS, SaveStore, TRIAL_KEYS, trialStorage } from "./save-store.ts";

export function createBrowserEnv(win: Window, trial: boolean): AppEnv {
  const now = () => Date.now();
  const base = localStorageOrMemory(win);
  const store = trial
    ? new SaveStore(trialStorage(base), TRIAL_KEYS, now)
    : new SaveStore(base, MAIN_KEYS, now);
  return {
    store,
    trial,
    generate: puzzleGenerator(win),
    persistApi: persistApi(win),
    download(fileName, text) {
      const doc = win.document;
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const a = doc.createElement("a");
      a.href = url;
      a.download = fileName;
      doc.body.append(a);
      a.click();
      a.remove();
      win.setTimeout(() => URL.revokeObjectURL(url), 60_000);
    },
    now,
  };
}

/** localStorage が使えない（設定で止められている）ときは、保存しないで遊べるようにする */
function localStorageOrMemory(win: Window): KeyValue {
  try {
    const storage = win.localStorage;
    storage.getItem(MAIN_KEYS.game);
    return storage;
  } catch {
    const memory = new Map<string, string>();
    return {
      getItem: (key) => memory.get(key) ?? null,
      setItem: (key, value) => {
        memory.set(key, value);
      },
    };
  }
}

function persistApi(win: Window): PersistApi | undefined {
  const storage = win.navigator.storage as StorageManager | undefined;
  if (storage === undefined || typeof storage.persist !== "function") return undefined;
  return {
    persisted: () => storage.persisted(),
    persist: () => storage.persist(),
  };
}

/** 問題は Worker で作る。Worker が使えなければ、ページの中で作る（元の nekopatch.html と同じ） */
function puzzleGenerator(win: Window): (N: number, diff: number) => Promise<Puzzle> {
  const here = (N: number, diff: number) =>
    new Promise<Puzzle>((resolve) => {
      win.setTimeout(() => {
        const g = generate(N, diff, 1500);
        resolve({ N: g.N, reg: g.reg, cats: g.cats, level: g.level });
      }, 20);
    });
  const waiting = new Map<number, { N: number; diff: number; resolve: (p: Puzzle) => void }>();
  let worker: Worker | null = null;
  let reqId = 0;
  try {
    worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    worker.onmessage = (e: MessageEvent<{ id: number; puzzle: Puzzle }>) => {
      const w = waiting.get(e.data.id);
      waiting.delete(e.data.id);
      w?.resolve(e.data.puzzle);
    };
    // 読み込めなかったなど、Worker が動かないときは、待っている分もページの中で作る
    worker.onerror = () => {
      worker?.terminate();
      worker = null;
      for (const [id, w] of waiting) {
        waiting.delete(id);
        here(w.N, w.diff).then(w.resolve);
      }
    };
  } catch {
    worker = null;
  }
  return (N, diff) => {
    const w = worker;
    if (w === null) return here(N, diff);
    return new Promise<Puzzle>((resolve) => {
      const id = ++reqId;
      waiting.set(id, { N, diff, resolve });
      w.postMessage({ id, N, diff });
    });
  };
}
