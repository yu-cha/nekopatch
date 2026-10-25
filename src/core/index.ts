// ロジックの公開する入口。UI はここからだけ import する（~/git/knowledge/decisions/2026-10-17-201005-902a-separate-logic-and-ui.md、798a）。
export { boardId, encodeBoard, restorePuzzle } from "./board.ts";
export type { Random } from "./grid.ts";
export {
  changeNote,
  cleanMemo,
  hasRemark,
  MEMO_MAX,
  type NoteChange,
  type Notes,
  parseStoredNotes,
  type RecordNote,
  serializeNotes,
} from "./notes.ts";
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
  type BoardRow,
  type BoardSort,
  type Boards,
  boardRows,
  type Category,
  type CategorySummary,
  type ClearRecord,
  compareWin,
  exportFileName,
  exportText,
  type HistoryRow,
  historyRows,
  importRecords,
  parseExport,
  parseStoredBoards,
  parseStoredHistory,
  type RecordsData,
  type Rows,
  recordKey,
  serializeBoards,
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
export {
  boardLabel,
  parseShareFragment,
  parseStoredReceived,
  type Received,
  type ReceivedBoards,
  type SenderScore,
  type SharedBoard,
  scoreLabel,
  serializeReceived,
  shareText,
  versusSender,
} from "./share.ts";
export { attacks, type CellState, type Step } from "./solver.ts";
