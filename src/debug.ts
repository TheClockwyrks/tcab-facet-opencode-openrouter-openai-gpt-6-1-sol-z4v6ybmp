import * as C from "./constants";
import type { FacetState, PointerDevice, Screen, State } from "./game";
import {
  cellX,
  cellY,
  index,
  initialState,
  lastFall,
  legalSwap,
  LETTERS,
  openingBoard,
  pointerEvent,
  requestSwap,
  stepHold,
  targets,
  tokenGem,
} from "./model";

function integer(
  value: number,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    throw new RangeError(`Expected integer ${min}..${max}, received ${value}`);
  return value;
}
function cell(col: number, row: number) {
  return {
    col: integer(col, 0, C.GRID_COLS - 1),
    row: integer(row, 0, C.GRID_ROWS - 1),
  };
}
function pointer(x: number, y: number, device: PointerDevice) {
  if (
    !Number.isFinite(x) ||
    !Number.isFinite(y) ||
    !["mouse", "pen", "touch"].includes(device)
  )
    throw new RangeError("Invalid pointer");
}
export function snapshot(s: State) {
  return {
    version: C.FACET_DEBUG_VERSION,
    screen: s.screen,
    menuIndex: s.menuIndex,
    score: s.score,
    level: s.level,
    levelScore: s.levelScore,
    levelTarget: C.LEVEL_TARGET_STEP * s.level,
    phase: s.phase,
    chainStep: s.chainStep,
    multiplier: Math.min(s.chainStep, C.MAX_MULTIPLIER),
    swapTimer: s.swapTimer,
    stepTimer: s.stepTimer,
    stepHold: stepHold(s),
    board: {
      cols: s.board.cols,
      rows: s.board.rows,
      cells: s.board.cells.map((g) => ({
        ...g,
        x: cellX(g.col),
        y: cellY(g.row),
      })),
    },
    selection: s.selection ? { ...s.selection } : null,
    offer: s.offer ? { ...s.offer } : null,
    refusal: s.refusal
      ? { a: { ...s.refusal.a }, b: { ...s.refusal.b } }
      : null,
    lastCleared: s.lastCleared,
    lastPoints: s.lastPoints,
    lastWaves: s.lastWaves,
    lastFall: lastFall(s),
    moveScore: s.moveScore,
    bestMove: s.bestMove,
    bestChain: s.bestChain,
    legalSwap: legalSwap(s.board),
    refillKinds: [...s.refillKinds],
    pointer: { ...s.pointer },
    armedTarget: s.armedTarget,
    targets: targets(s),
    muted: s.muted,
    simTime: s.simTime,
  };
}
export interface FacetDebugApi {
  readonly version: number;
  reset(s: State): FacetState;
  reconcile(s: State): FacetState;
  snapshot(s: State): ReturnType<typeof snapshot>;
  setScreen(s: State, screen: Screen): FacetState;
  setMenuIndex(s: State, index: number): FacetState;
  loadBoard(s: State, rows: readonly string[]): FacetState;
  dealBoard(s: State): FacetState;
  clearBoard(s: State): FacetState;
  setGem(s: State, col: number, row: number, token: string): FacetState;
  setRefillKinds(s: State, col: number, kinds: string): FacetState;
  clearRefillKinds(s: State): FacetState;
  setScore(s: State, points: number): FacetState;
  setLevel(s: State, level: number): FacetState;
  setLevelScore(s: State, points: number): FacetState;
  setBestChain(s: State, chainStep: number): FacetState;
  setBestMove(s: State, points: number): FacetState;
  setMoveScore(s: State, points: number): FacetState;
  setSelection(s: State, col: number, row: number): FacetState;
  clearSelection(s: State): FacetState;
  setOffer(s: State, col: number, row: number): FacetState;
  clearOffer(s: State): FacetState;
  clearRefusal(s: State): FacetState;
  clearChain(s: State): FacetState;
  requestSwap(
    s: State,
    colA: number,
    rowA: number,
    colB: number,
    rowB: number,
  ): FacetState;
  pointerDown(
    s: State,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerMove(
    s: State,
    x: number,
    y: number,
    device?: PointerDevice,
  ): FacetState;
  pointerUp(s: State, device?: PointerDevice): FacetState;
}
export const debug: FacetDebugApi = {
  version: C.FACET_DEBUG_VERSION,
  reset: (s) => ({ ...initialState(), muted: s.muted, resources: s.resources }),
  reconcile: (s) => ({ ...s }),
  snapshot,
  setScreen: (s, screen) => {
    if (
      ![
        "title",
        "howto",
        "playing",
        "paused",
        "levelclear",
        "gameover",
      ].includes(screen)
    )
      throw new RangeError(`Invalid screen ${screen}`);
    return { ...s, screen };
  },
  setMenuIndex: (s, index) => ({ ...s, menuIndex: integer(index) }),
  loadBoard: (s, rows) => {
    if (rows.length !== C.GRID_ROWS)
      throw new RangeError("Expected eight board rows");
    const cells = rows.flatMap((line, row) => {
      const tokens = line.trim().split(/\s+/);
      if (tokens.length !== C.GRID_COLS)
        throw new RangeError("Expected eight tokens per row");
      return tokens.map((t, col) => tokenGem(t, col, row));
    });
    return { ...s, board: { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells } };
  },
  dealBoard: (s) => ({
    ...s,
    board: openingBoard(),
    motion: { ...s.motion, dealAge: 0 },
  }),
  clearBoard: (s) => ({ ...s, board: { cols: 0, rows: 0, cells: [] } }),
  setGem: (s, col, row, token) => {
    const p = cell(col, row),
      i = index(p),
      g = tokenGem(token, col, row);
    if (!s.board.cells[i]) throw new RangeError("No gem in that cell");
    return {
      ...s,
      board: {
        ...s.board,
        cells: s.board.cells.map((old, j) => (j === i ? g : old)),
      },
    };
  },
  setRefillKinds: (s, col, kinds) => {
    integer(col, 0, C.GRID_COLS - 1);
    if (
      typeof kinds !== "string" ||
      [...kinds].some((k) => !LETTERS.includes(k))
    )
      throw new RangeError("Invalid refill kind");
    return {
      ...s,
      refillKinds: s.refillKinds.map((old, i) => (i === col ? kinds : old)),
    };
  },
  clearRefillKinds: (s) => ({
    ...s,
    refillKinds: Array<string>(C.GRID_COLS).fill(""),
  }),
  setScore: (s, points) => ({ ...s, score: integer(points) }),
  setLevel: (s, level) => ({ ...s, level: integer(level, 1) }),
  setLevelScore: (s, points) => ({ ...s, levelScore: integer(points) }),
  setBestChain: (s, chainStep) => ({ ...s, bestChain: integer(chainStep) }),
  setBestMove: (s, points) => ({ ...s, bestMove: integer(points) }),
  setMoveScore: (s, points) => ({ ...s, moveScore: integer(points) }),
  setSelection: (s, col, row) => ({ ...s, selection: cell(col, row) }),
  clearSelection: (s) => ({ ...s, selection: null }),
  setOffer: (s, col, row) => ({ ...s, offer: cell(col, row) }),
  clearOffer: (s) => ({ ...s, offer: null }),
  clearRefusal: (s) => ({ ...s, refusal: null }),
  clearChain: (s) => ({
    ...s,
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    motion: undefined,
  }),
  requestSwap: (s, ca, ra, cb, rb) =>
    requestSwap(s, cell(ca, ra), cell(cb, rb)),
  pointerDown: (s, x, y, device = "mouse") => {
    pointer(x, y, device);
    return pointerEvent(s, "down", x, y, device);
  },
  pointerMove: (s, x, y, device = "mouse") => {
    pointer(x, y, device);
    return pointerEvent(s, "move", x, y, device);
  },
  pointerUp: (s, device = "mouse") => {
    pointer(s.pointer.x, s.pointer.y, device);
    return pointerEvent(s, "up", s.pointer.x, s.pointer.y, device);
  },
};
