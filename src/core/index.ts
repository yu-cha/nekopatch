// ロジックの公開する入口。UI はここからだけ import する（~/git/knowledge/decisions/2026-10-17-201005-902a-separate-logic-and-ui.md、798a）。
export type { Random } from "./grid.ts";
export {
  conflicts,
  formatTime,
  type Hint,
  isCleared,
  LEVEL_NAMES,
  LEVELS,
  nextHint,
  REGION_NAMES,
  SIZES,
} from "./play.ts";
export { generate, type Puzzle, solutionCells } from "./puzzle.ts";
export {
  type CategorySummary,
  type ClearRecord,
  compareWin,
  exportFileName,
  exportText,
  importRecords,
  parseExport,
  parseStoredHistory,
  type RecentRow,
  type RecordsData,
  recentRows,
  serializeHistory,
  summarize,
  type WinComparison,
} from "./records.ts";
export {
  type GameState,
  type PlayingPuzzle,
  parseSavedGame,
  type SavedGame,
  serializeGame,
} from "./saved-game.ts";
export { attacks, type CellState, type Step } from "./solver.ts";
