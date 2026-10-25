// 遊びかけの盤面と設定、「クリア ○ 問」の数の保存。
// 保存の形は、作り直す前（2026-10-21 まで）と同じ JSON の形のまま変えない（ナンの今の状態をそのまま読むため）:
// {P: {N, reg, cats, level, diff}, st, elapsed, won, solvedCount, hints, autoX, size, diff}
// 足した欄は、前の版が読み飛ばしても困らないものだけ（判断 c995）:
// autoXUsed（その問題で「猫の周りに自動で×」を ON のまま猫を置いたか）。true のときだけ書く
// received（リンクから始めた問題の、送った人のタイムとヒントの回数。判断 73b0）。リンクから始めた問題のときだけ書く

import { LEVELS, SIZES } from "./play.ts";
import type { Puzzle } from "./puzzle.ts";
import { type Received, readReceived, receivedJson } from "./share.ts";
import type { CellState } from "./solver.ts";

/** 遊んでいる問題。diff は選んだ難しさ（level は実際に要る手の高さ） */
export interface PlayingPuzzle extends Puzzle {
  readonly diff: number;
}

export interface SavedGame {
  /** 遊びかけの問題と盤面。クリア済み、または読めなければ null */
  readonly playing: {
    readonly puzzle: PlayingPuzzle;
    readonly st: CellState[];
    readonly elapsed: number;
    readonly hints: number;
    /** その問題で「猫の周りに自動で×」を ON のまま猫を置いたか */
    readonly autoXUsed: boolean;
    /** リンクから始めた問題なら、もらった盤面の印。そうでなければ null */
    readonly received: Received | null;
  } | null;
  readonly solvedCount: number;
  readonly autoX: boolean;
  /** 選んでいた盤面の大きさと難しさ。読めなければ null */
  readonly size: number | null;
  readonly diff: number | null;
}

export interface GameState {
  readonly puzzle: PlayingPuzzle | null;
  readonly st: readonly CellState[];
  readonly elapsed: number;
  readonly won: boolean;
  readonly solvedCount: number;
  readonly hints: number;
  readonly autoX: boolean;
  /** その問題で「猫の周りに自動で×」を ON のまま猫を置いたか。無ければ使っていない */
  readonly autoXUsed?: boolean;
  /** リンクから始めた問題なら、もらった盤面の印。無ければ、リンクから始めた問題ではない */
  readonly received?: Received | null;
  readonly size: number;
  readonly diff: number;
}

function isIntIn(x: unknown, min: number, max: number): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= min && x <= max;
}

function readPuzzle(x: unknown): PlayingPuzzle | null {
  if (typeof x !== "object" || x === null) return null;
  const p = x as Record<string, unknown>;
  const N = p.N;
  if (typeof N !== "number" || !SIZES.includes(N)) return null;
  const { reg, cats, level, diff } = p;
  if (!Array.isArray(reg) || reg.length !== N * N || !reg.every((g) => isIntIn(g, 0, N - 1)))
    return null;
  if (!Array.isArray(cats) || cats.length !== N || !cats.every((c) => isIntIn(c, 0, N - 1)))
    return null;
  if (!isIntIn(level, 1, 3) || typeof diff !== "number" || !LEVELS.includes(diff)) return null;
  return { N, reg: reg as number[], cats: cats as number[], level, diff };
}

function readCells(x: unknown, length: number): CellState[] | null {
  if (!Array.isArray(x) || x.length !== length) return null;
  return x.every((v) => v === 0 || v === 1 || v === 2) ? (x as CellState[]) : null;
}

/** 選べる値の文字（"8" など）か数を読む。選べない値なら null */
function readChoice(x: unknown, choices: readonly number[]): number | null {
  const v = typeof x === "string" ? Number(x) : x;
  return typeof v === "number" && choices.includes(v) ? v : null;
}

/**
 * 保存してある状態を読む。intact が false なら、読めない部分があった（読めたところだけを返す）。
 * そのときは、元の文字を別の場所に残してから書き直す（UI の役目）
 */
export function parseSavedGame(raw: string | null): { game: SavedGame | null; intact: boolean } {
  if (raw === null) return { game: null, intact: true };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { game: null, intact: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    return { game: null, intact: false };
  const s = parsed as Record<string, unknown>;
  let intact = true;

  const solvedCount = s.solvedCount ?? 0;
  if (!isIntIn(solvedCount, 0, Number.MAX_SAFE_INTEGER)) intact = false;

  let playing: SavedGame["playing"] = null;
  if (s.P !== null && s.P !== undefined && s.won !== true) {
    const puzzle = readPuzzle(s.P);
    const st = puzzle === null ? null : readCells(s.st, puzzle.N * puzzle.N);
    if (puzzle !== null && st !== null) {
      const elapsed = typeof s.elapsed === "number" && s.elapsed >= 0 ? s.elapsed : 0;
      const hints = isIntIn(s.hints, 0, Number.MAX_SAFE_INTEGER) ? s.hints : 0;
      // もらった盤面の印は、読めなければ無いものとする（hints と同じく、読めない保存データとしては扱わない）
      const received = s.received === undefined ? null : readReceived(s.received);
      playing = { puzzle, st, elapsed, hints, autoXUsed: s.autoXUsed === true, received };
    } else {
      intact = false;
    }
  }

  return {
    game: {
      playing,
      solvedCount: isIntIn(solvedCount, 0, Number.MAX_SAFE_INTEGER) ? solvedCount : 0,
      autoX: s.autoX === true,
      size: readChoice(s.size, SIZES),
      diff: readChoice(s.diff, LEVELS),
    },
    intact,
  };
}

/**
 * 作り直す前と同じ形で書く（size と diff は、画面の選択肢の値と同じ文字）。
 * autoXUsed は使ったときだけ、received はリンクから始めた問題のときだけ足す
 */
export function serializeGame(g: GameState): string {
  return JSON.stringify({
    P: g.puzzle,
    st: g.st,
    elapsed: g.elapsed,
    won: g.won,
    solvedCount: g.solvedCount,
    hints: g.hints,
    autoX: g.autoX,
    size: String(g.size),
    diff: String(g.diff),
    ...(g.autoXUsed === true ? { autoXUsed: true } : {}),
    ...(g.received === undefined || g.received === null
      ? {}
      : { received: receivedJson(g.received) }),
  });
}
