import * as C from "./constants";
import type {
  BoardState,
  CellRef,
  Cut,
  Emit,
  FacetState,
  GemKind,
  GemState,
  PointerDevice,
  Screen,
  State,
} from "./game";

const quiet: Emit = () => {};
export const cellX = (col: number) =>
  C.BOARD_CX - ((C.GRID_COLS - 1) * C.CELL_PITCH) / 2 + col * C.CELL_PITCH;
export const cellY = (row: number) =>
  C.BOARD_CY - ((C.GRID_ROWS - 1) * C.CELL_PITCH) / 2 + row * C.CELL_PITCH;
export const index = (p: CellRef) => p.row * C.GRID_COLS + p.col;
export const same = (
  a: CellRef | null | undefined,
  b: CellRef | null | undefined,
) => !!a && !!b && a.col === b.col && a.row === b.row;
export const adjacent = (a: CellRef, b: CellRef) =>
  Math.abs(a.col - b.col) + Math.abs(a.row - b.row) === 1;
export const lastFall = (s: State) =>
  Math.max(0, ...s.board.cells.map((g) => g.fell));
export const stepHold = (s: State) =>
  s.lastWaves * C.WAVE_SECONDS +
  lastFall(s) * C.FALL_SECONDS_PER_ROW +
  C.STEP_SECONDS;
export function initialState(): FacetState {
  return {
    screen: "title",
    menuIndex: 0,
    board: { cols: 0, rows: 0, cells: [] },
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    score: 0,
    level: 1,
    levelScore: 0,
    lastCleared: 0,
    lastPoints: 0,
    lastWaves: 0,
    moveScore: 0,
    bestMove: 0,
    bestChain: 0,
    selection: null,
    offer: null,
    refusal: null,
    armedTarget: null,
    pointer: { x: 0, y: 0, down: false, device: "mouse" },
    simTime: 0,
    muted: false,
    refillKinds: Array<string>(C.GRID_COLS).fill(""),
  };
}
export const LETTERS = "RACJBSM";
export function tokenGem(token: string, col: number, row: number): GemState {
  const match = /^([RACJBSM])([0-3])([bs]?)$|^(X)([0-3])$/.exec(token);
  if (!match) throw new RangeError(`Invalid gem token: ${token}`);
  const prism = match[4] === "X";
  return {
    col,
    row,
    kind: prism ? null : C.GEM_KINDS[LETTERS.indexOf(match[1])]!,
    strain: Number(prism ? match[5] : match[2]),
    cut: prism
      ? "prism"
      : match[3] === "b"
        ? "brilliant"
        : match[3] === "s"
          ? "star"
          : "plain",
    fell: 0,
  };
}
function randomKind(): GemKind {
  return C.GEM_KINDS[Math.floor(Math.random() * C.GEM_KIND_COUNT)]!;
}
function plain(
  col: number,
  row: number,
  kind = randomKind(),
  fell = 0,
): GemState {
  return { col, row, kind, cut: "plain", strain: 0, fell };
}
export interface Run {
  readonly ids: readonly number[];
  readonly horizontal: boolean;
}
export function runs(board: BoardState): Run[] {
  const result: Run[] = [];
  for (const horizontal of [true, false]) {
    const outer = horizontal ? board.rows : board.cols;
    const inner = horizontal ? board.cols : board.rows;
    for (let o = 0; o < outer; o++) {
      let start = 0;
      while (start < inner) {
        const id = (v: number) =>
          horizontal ? o * board.cols + v : v * board.cols + o;
        const kind = board.cells[id(start)]?.kind;
        let end = start + 1;
        while (kind && end < inner && board.cells[id(end)]?.kind === kind)
          end++;
        if (kind && end - start >= C.MATCH_MIN)
          result.push({
            horizontal,
            ids: Array.from({ length: end - start }, (_, j) => id(start + j)),
          });
        start = end;
      }
    }
  }
  return result;
}
export function exchange(
  board: BoardState,
  a: CellRef,
  b: CellRef,
): BoardState {
  const ai = index(a),
    bi = index(b);
  return {
    ...board,
    cells: board.cells.map((g, i) =>
      i === ai
        ? { ...board.cells[bi]!, ...a, fell: 0 }
        : i === bi
          ? { ...board.cells[ai]!, ...b, fell: 0 }
          : g,
    ),
  };
}
export function productive(board: BoardState, a: CellRef, b: CellRef): boolean {
  if (!board.cells[index(a)] || !board.cells[index(b)]) return false;
  return (
    board.cells[index(a)]!.cut === "prism" ||
    board.cells[index(b)]!.cut === "prism" ||
    runs(exchange(board, a, b)).length > 0
  );
}
export function legalSwap(board: BoardState): boolean {
  for (const g of board.cells)
    for (const b of [
      { col: g.col + 1, row: g.row },
      { col: g.col, row: g.row + 1 },
    ]) {
      if (b.col < board.cols && b.row < board.rows && productive(board, g, b))
        return true;
    }
  return false;
}
export function openingBoard(): BoardState {
  for (;;) {
    const cells: GemState[] = [];
    for (let row = 0; row < C.GRID_ROWS; row++)
      for (let col = 0; col < C.GRID_COLS; col++) {
        let kind: GemKind;
        do {
          kind = randomKind();
        } while (
          (col >= 2 &&
            cells[cells.length - 1]?.kind === kind &&
            cells[cells.length - 2]?.kind === kind) ||
          (row >= 2 &&
            cells[(row - 1) * C.GRID_COLS + col]?.kind === kind &&
            cells[(row - 2) * C.GRID_COLS + col]?.kind === kind)
        );
        cells.push(plain(col, row, kind, row + 1));
      }
    const board = { cols: C.GRID_COLS, rows: C.GRID_ROWS, cells };
    if (legalSwap(board)) return board;
  }
}
export function requestSwap(
  s: State,
  a: CellRef,
  b: CellRef,
  emit: Emit = quiet,
): FacetState {
  if (!adjacent(a, b) || s.phase !== "idle" || !productive(s.board, a, b)) {
    emit(C.CUES.refuse);
    return { ...s, refusal: { a, b, timer: 0 } };
  }
  const ga = s.board.cells[index(a)]!,
    gb = s.board.cells[index(b)]!;
  const prism =
    ga.cut === "prism" && gb.cut === "prism"
      ? "all"
      : ga.cut === "prism"
        ? gb.kind
        : gb.cut === "prism"
          ? ga.kind
          : undefined;
  emit(C.CUES.swap);
  return {
    ...s,
    board: exchange(s.board, a, b),
    phase: "swapping",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    moveScore: 0,
    motion: { swap: [a, b], prism },
    refusal: null,
  };
}
function neighbors(id: number, diagonal = false): number[] {
  const col = id % C.GRID_COLS,
    row = Math.floor(id / C.GRID_COLS),
    result: number[] = [];
  for (let dy = -1; dy <= 1; dy++)
    for (let dx = -1; dx <= 1; dx++) {
      if ((!dx && !dy) || (!diagonal && Math.abs(dx) + Math.abs(dy) !== 1))
        continue;
      const x = col + dx,
        y = row + dy;
      if (x >= 0 && y >= 0 && x < C.GRID_COLS && y < C.GRID_ROWS)
        result.push(y * C.GRID_COLS + x);
    }
  return result;
}
export function resolveStep(s: State, emit: Emit = quiet): FacetState | null {
  const cells = s.board.cells;
  const prism = s.chainStep === 1 ? s.motion?.prism : undefined;
  const found = prism === undefined ? runs(s.board) : [];
  const seeds =
    prism === undefined
      ? found.flatMap((r) => [...r.ids])
      : cells.flatMap((g, i) =>
          prism === "all" ||
          (g.cut === "prism" && s.motion?.swap?.some((p) => same(p, g))) ||
          g.kind === prism
            ? [i]
            : [],
        );
  if (!seeds.length) return null;
  // R6 is a multi-source breadth-first traversal. First discovery is therefore
  // both membership in the least closed set and the cell's shortest wave.
  const waves = new Map<number, number>();
  const queue: number[] = [];
  for (const id of seeds)
    if (!waves.has(id)) {
      waves.set(id, 0);
      queue.push(id);
    }
  for (let n = 0; n < queue.length; n++) {
    const id = queue[n]!,
      g = cells[id]!,
      wave = waves.get(id)!;
    const additions = neighbors(id).filter(
      (j) => cells[j]!.strain === C.MAX_STRAIN,
    );
    if (g.cut === "brilliant") additions.push(...neighbors(id, true));
    if (g.cut === "star")
      for (let j = 0; j < cells.length; j++)
        if (cells[j]!.col === g.col || cells[j]!.row === g.row)
          additions.push(j);
    for (const j of additions)
      if (!waves.has(j)) {
        waves.set(j, wave + 1);
        queue.push(j);
      }
  }
  const multiplier = Math.min(s.chainStep, C.MAX_MULTIPLIER);
  const points = queue.reduce(
    (sum, id) =>
      sum +
      (cells[id]!.strain === C.MAX_STRAIN ? C.FLAWED_SCORE : C.BASE_SCORE) *
        multiplier,
    0,
  );
  emit(C.CUES.clear, multiplier);
  // Damage is applied only after closure and scoring: a stone newly made
  // flawed by this clear cannot retroactively join this step's clear set.
  const left: (GemState | null)[] = cells.map((g, i) => {
    if (waves.has(i)) return null;
    if (neighbors(i).some((j) => waves.has(j))) {
      const strain = Math.min(C.MAX_STRAIN, g.strain + 1);
      if (strain === C.MAX_STRAIN && g.strain < C.MAX_STRAIN) emit(C.CUES.flaw);
      return { ...g, strain };
    }
    return g;
  });
  const cuts = new Map<number, Cut>();
  // Resolve every creation claim before settling; competing claims at a cell
  // obey prism > star > brilliant, regardless of run enumeration order.
  const rank: Record<Cut, number> = {
    plain: 0,
    brilliant: 1,
    star: 2,
    prism: 3,
  };
  const put = (id: number, cut: Cut) => {
    if (rank[cut] > rank[cuts.get(id) ?? "plain"]) cuts.set(id, cut);
  };
  for (const run of found) {
    if (run.ids.length >= 4) {
      const id =
        run.ids.find((i) => s.motion?.swap?.some((p) => index(p) === i)) ??
        run.ids[Math.floor((run.ids.length - 1) / 2)]!;
      put(id, run.ids.length >= 5 ? "prism" : "brilliant");
    }
    if (run.horizontal)
      for (const other of found.filter((r) => !r.horizontal))
        for (const id of run.ids) if (other.ids.includes(id)) put(id, "star");
  }
  for (const [id, cut] of cuts) {
    left[id] = {
      ...cells[id]!,
      cut,
      kind: cut === "prism" ? null : cells[id]!.kind,
      strain: 0,
      fell: 0,
    };
    emit(C.CUES.cut);
  }
  const settled: GemState[] = Array<GemState>(cells.length);
  const created: CellRef[] = [];
  // Bottom-up compaction preserves survivor order. Fresh stones share one
  // column fall distance, so their starting rows are consecutive above the grid.
  for (let col = 0; col < C.GRID_COLS; col++) {
    let row = C.GRID_ROWS - 1;
    for (let old = C.GRID_ROWS - 1; old >= 0; old--) {
      const g = left[old * C.GRID_COLS + col];
      if (g) {
        settled[row * C.GRID_COLS + col] = { ...g, row, col, fell: row - old };
        if (cuts.has(old * C.GRID_COLS + col)) created.push({ col, row });
        row--;
      }
    }
    for (let r = row; r >= 0; r--) {
      const posed = s.refillKinds[col]?.[r];
      const kind = posed ? C.GEM_KINDS[LETTERS.indexOf(posed)]! : randomKind();
      settled[r * C.GRID_COLS + col] = plain(col, r, kind, row + 1);
    }
  }
  return {
    ...s,
    board: { ...s.board, cells: settled },
    lastCleared: queue.length,
    lastPoints: points,
    lastWaves: Math.max(...waves.values()),
    score: s.score + points,
    levelScore: s.levelScore + points,
    moveScore: s.moveScore + points,
    bestChain: Math.max(s.bestChain, s.chainStep),
    stepTimer: 0,
    motion: {
      swap: s.motion?.swap,
      before: s.board,
      cleared: queue.map((id) => ({ gem: cells[id]!, wave: waves.get(id)! })),
      created,
    },
  };
}
export function advance(
  state: State,
  dt: number,
  emit: Emit = quiet,
): FacetState {
  if (state.screen !== "playing") return { ...state };
  let s: FacetState = { ...state };
  if (s.refusal) {
    const timer = s.refusal.timer + dt;
    s = {
      ...s,
      refusal:
        timer + 1e-10 >= C.REFUSAL_SECONDS ? null : { ...s.refusal, timer },
    };
  }
  if (s.motion?.dealAge !== undefined)
    s = { ...s, motion: { ...s.motion, dealAge: s.motion.dealAge + dt } };
  let remaining = dt;
  // Spend overshoot at each boundary rather than dropping fractional frames.
  // A long update may finish a swap and several steps, just as small updates do.
  while (remaining > 1e-10 && s.screen === "playing" && s.phase !== "idle") {
    if (s.phase === "swapping") {
      const used = Math.min(remaining, C.SWAP_SECONDS - s.swapTimer);
      remaining -= used;
      s = { ...s, swapTimer: s.swapTimer + used };
      if (s.swapTimer + 1e-10 < C.SWAP_SECONDS) break;
      s = resolveStep(
        { ...s, phase: "resolving", swapTimer: 0, chainStep: 1 },
        emit,
      )!;
    } else {
      const hold = stepHold(s),
        land =
          s.lastWaves * C.WAVE_SECONDS + lastFall(s) * C.FALL_SECONDS_PER_ROW;
      const used = Math.min(remaining, Math.max(0, hold - s.stepTimer));
      const timer = s.stepTimer + used;
      if (
        lastFall(s) > C.LAND_MIN_ROWS &&
        s.stepTimer + 1e-10 < land &&
        timer + 1e-10 >= land
      )
        emit(C.CUES.land);
      remaining -= used;
      s = { ...s, stepTimer: timer };
      if (timer + 1e-10 < hold) break;
      const next = resolveStep(
        { ...s, chainStep: s.chainStep + 1, stepTimer: 0 },
        emit,
      );
      if (next) {
        s = next;
        continue;
      }
      s = {
        ...s,
        phase: "idle",
        chainStep: 0,
        stepTimer: 0,
        bestMove: Math.max(s.bestMove, s.moveScore),
        motion: undefined,
      };
      if (s.levelScore >= C.LEVEL_TARGET_STEP * s.level) {
        s = screen(s, "levelclear");
        emit(C.CUES.levelUp);
      } else if (!legalSwap(s.board)) {
        s = screen(s, "gameover");
        emit(C.CUES.gameOver);
      }
    }
  }
  return s;
}
export interface Target {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}
export function targets(s: State): Target[] {
  if (s.screen === "playing")
    return [
      {
        id: "pause",
        x: 1088,
        y: 36,
        w: C.TARGET_MIN_W + 32,
        h: C.TARGET_MIN_H,
      },
    ];
  if (s.screen === "howto")
    return [{ id: "back", x: 80, y: 606, w: 160, h: C.TARGET_MIN_H }];
  return [0, 1].map((i) => ({
    id: `menu-${i}`,
    x: 470,
    y: 414 + i * 86,
    w: 340,
    h: C.TARGET_MIN_H,
  }));
}
export function screen(s: State, value: Screen, index = 0): FacetState {
  return { ...s, screen: value, menuIndex: index, armedTarget: null };
}
export function freshRound(s: State): FacetState {
  return {
    ...initialState(),
    resources: s.resources,
    simTime: s.simTime,
    muted: s.muted,
    pointer: s.pointer,
    screen: "playing",
    board: openingBoard(),
    motion: { dealAge: 0 },
  };
}
function quit(s: State): FacetState {
  return {
    ...screen(s, "title"),
    board: { cols: 0, rows: 0, cells: [] },
    phase: "idle",
    chainStep: 0,
    swapTimer: 0,
    stepTimer: 0,
    selection: null,
    offer: null,
    refusal: null,
    motion: undefined,
  };
}
export function action(
  s: State,
  name: string,
  _emit: Emit = quiet,
): FacetState {
  if (name === "pause" && (s.screen === "playing" || s.screen === "paused"))
    return screen(s, s.screen === "playing" ? "paused" : "playing");
  if (name === "back") {
    if (s.screen === "howto") return screen(s, "title", 1);
    if (s.screen === "gameover") return screen(s, "title");
  }
  if (["title", "paused", "levelclear", "gameover"].includes(s.screen)) {
    if (name === "up" || name === "down")
      return {
        ...s,
        menuIndex: (s.menuIndex + (name === "up" ? -1 : 1) + 2) % 2,
      };
    if (name === "confirm") {
      if (s.screen === "title")
        return s.menuIndex === 0 ? freshRound(s) : screen(s, "howto");
      if (s.menuIndex === 1) return quit(s);
      if (s.screen === "paused") return screen(s, "playing");
      if (s.screen === "gameover") return freshRound(s);
      return {
        ...screen(s, "playing"),
        level: s.level + 1,
        levelScore: 0,
        bestChain: 0,
        bestMove: 0,
        board: openingBoard(),
        selection: null,
        offer: null,
        refusal: null,
        motion: { dealAge: 0 },
      };
    }
  }
  return { ...s };
}
function hitCell(x: number, y: number): CellRef | null {
  let best: CellRef | null = null,
    distance = C.GEM_HIT_R * C.GEM_HIT_R;
  for (let row = 0; row < C.GRID_ROWS; row++)
    for (let col = 0; col < C.GRID_COLS; col++) {
      const d = (x - cellX(col)) ** 2 + (y - cellY(row)) ** 2;
      if (d <= distance && (!best || d < distance)) {
        best = { col, row };
        distance = d;
      }
    }
  return best;
}
export function pointerEvent(
  s: State,
  type: "down" | "move" | "up",
  x: number,
  y: number,
  device: PointerDevice = "mouse",
  emit: Emit = quiet,
): FacetState {
  const wasDown = s.pointer.down;
  let n: FacetState = {
    ...s,
    pointer: {
      x,
      y,
      device,
      down: type === "down" ? true : type === "up" ? false : wasDown,
    },
  };
  const target = targets(s).find(
    (t) => x >= t.x && x <= t.x + t.w && y >= t.y && y <= t.y + t.h,
  );
  if (target?.id.startsWith("menu-") && (!wasDown || type === "down"))
    n = { ...n, menuIndex: Number(target.id.slice(5)) };
  if (type === "down" && target) return { ...n, armedTarget: target.id };
  if (type === "up" && s.armedTarget) {
    n = { ...n, armedTarget: null };
    if (target?.id === s.armedTarget)
      return action(
        n,
        target.id.startsWith("menu-") ? "confirm" : target.id,
        emit,
      );
    return n;
  }
  if (type === "down") n = { ...n, armedTarget: null };
  if (s.screen !== "playing" || target || s.armedTarget) return n;
  const cell = hitCell(x, y);
  if (type === "down") {
    if (!cell) return { ...n, selection: null, offer: null };
    if (
      !s.selection ||
      (!same(cell, s.selection) && !adjacent(cell, s.selection))
    ) {
      emit(C.CUES.select);
      return { ...n, selection: cell, offer: null };
    }
    return { ...n, offer: same(cell, s.selection) ? null : cell };
  }
  if (type === "move" && wasDown && s.selection && cell) {
    if (same(cell, s.selection)) return { ...n, offer: null };
    if (adjacent(cell, s.selection)) return { ...n, offer: cell };
  }
  if (type === "up" && s.selection && s.offer)
    return {
      ...requestSwap(n, s.selection, s.offer, emit),
      selection: null,
      offer: null,
    };
  return n;
}
