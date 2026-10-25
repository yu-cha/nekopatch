// 記録に付ける備考（ひと言の文と「難」の印）と、「猫の周りに自動で×」を使って解いたかの印（ナンとの合意 2026-10-23）。
// 記録とは別に、記録の鍵（at|n|d|t|h）ごとに持つ（判断 c995）。備考を知らない版が記録を保存し直しても消えないようにするため。

/** 記録 1 件に付ける備考と印。無い欄は持たない。どれも無ければ、項目ごと持たない */
export interface RecordNote {
  /** ひと言の文。空の文は持たない */
  readonly memo?: string;
  /** 「難」の印 */
  readonly hard?: true;
  /** 「猫の周りに自動で×」を ON のまま猫を置いて解いた */
  readonly autoX?: true;
}

/** 記録の鍵 → 備考と印 */
export type Notes = ReadonlyMap<string, RecordNote>;

export const NO_NOTES: Notes = new Map();

/** ひと言の文の、いちばん長い文字数 */
export const MEMO_MAX = 30;

/** 書く欄から受け取った文を整える。改行などの制御文字と前後の空白を除き、30 文字（符号位置で数える）までにする */
export function cleanMemo(text: string): string {
  const s = text.replace(/\p{Cc}/gu, "").trim();
  return Array.from(s).slice(0, MEMO_MAX).join("").trimEnd();
}

/** 欄の値から項目を作る。空の文と false の印は持たない。どれも無ければ null */
function compact(memo: string | undefined, hard: boolean, autoX: boolean): RecordNote | null {
  if ((memo === undefined || memo === "") && !hard && !autoX) return null;
  return {
    ...(memo === undefined || memo === "" ? {} : { memo }),
    ...(hard ? { hard: true } : {}),
    ...(autoX ? { autoX: true } : {}),
  };
}

/** 備考（文か「難」の印）があるか。「自動×」の印は備考に入れない */
export function hasRemark(note: RecordNote | undefined): boolean {
  return note !== undefined && (note.memo !== undefined || note.hard === true);
}

/** 1 つの項目を変えるときの値。書かなかった欄は今のまま。memo は cleanMemo で整える */
export interface NoteChange {
  readonly memo?: string;
  readonly hard?: boolean;
  readonly autoX?: boolean;
}

/** key の項目だけを変えた、新しい備考の表を返す（元の表は変えない） */
export function changeNote(notes: Notes, key: string, change: NoteChange): Map<string, RecordNote> {
  const cur = notes.get(key);
  const next = compact(
    change.memo === undefined ? cur?.memo : cleanMemo(change.memo),
    change.hard ?? cur?.hard === true,
    change.autoX ?? cur?.autoX === true,
  );
  const out = new Map(notes);
  if (next === null) out.delete(key);
  else out.set(key, next);
  return out;
}

/**
 * オブジェクトの memo・hard・autoX の欄を読む。ok が false なら、読めない欄があった（読めた欄だけで項目を作る）。
 * memo は文字列、hard と autoX は真偽値。どれも無くてよい。保存してある文は切らない（ナンが書いたものを、読むときに変えない）
 */
export function readNoteFields(x: Readonly<Record<string, unknown>>): {
  note: RecordNote | null;
  ok: boolean;
} {
  const { memo, hard, autoX } = x;
  const memoOk = memo === undefined || typeof memo === "string";
  const hardOk = hard === undefined || typeof hard === "boolean";
  const autoXOk = autoX === undefined || typeof autoX === "boolean";
  return {
    note: compact(typeof memo === "string" ? memo : undefined, hard === true, autoX === true),
    ok: memoOk && hardOk && autoXOk,
  };
}

/** 記録の鍵（日時|盤面|難しさ|タイム|ヒントの回数）の形か */
export function isRecordKey(key: string): boolean {
  const parts = key.split("|");
  return (
    parts.length === 5 &&
    parts.every((p) => {
      const v = Number(p);
      return p !== "" && Number.isFinite(v) && v >= 0 && String(v) === p;
    })
  );
}

/**
 * 保存してある備考と印を読む。intact が false なら、読めない部分があった（読めた分だけを返す）。
 * そのときは、元の文字を別の場所に残してから書き直す（UI の役目）
 */
export function parseStoredNotes(raw: string | null): {
  notes: Map<string, RecordNote>;
  intact: boolean;
} {
  const notes = new Map<string, RecordNote>();
  if (raw === null) return { notes, intact: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { notes, intact: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { notes, intact: false };
  let intact = true;
  for (const [key, value] of Object.entries(parsed)) {
    if (!isRecordKey(key) || typeof value !== "object" || value === null || Array.isArray(value)) {
      intact = false;
      continue;
    }
    const { note, ok } = readNoteFields(value as Record<string, unknown>);
    if (!ok) intact = false;
    if (note !== null) notes.set(key, note);
  }
  return { notes, intact };
}

export function serializeNotes(notes: Notes): string {
  return JSON.stringify(Object.fromEntries(notes));
}

/**
 * 読み込んだファイルの備考と印を、今のものに合わせる（ナンとの合意 2026-10-23）。
 * 同じ記録の文と「難」は、1 つのまとまりとして、今のスマホにあれば今のまま、無ければファイルの方を使う。
 * 「自動×」は、同じ 1 回のクリアの事実なので、どちらかにあれば付ける
 */
export function mergeNotes(current: Notes, file: Notes): Map<string, RecordNote> {
  const out = new Map(current);
  for (const [key, f] of file) {
    const c = current.get(key);
    const remark = c !== undefined && hasRemark(c) ? c : f;
    const next = compact(remark.memo, remark.hard === true, c?.autoX === true || f.autoX === true);
    if (next !== null) out.set(key, next);
  }
  return out;
}
