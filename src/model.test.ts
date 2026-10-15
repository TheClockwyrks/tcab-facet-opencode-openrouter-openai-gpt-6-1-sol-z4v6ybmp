import { describe, expect, it, vi, afterEach } from "vitest";
import { debug as d } from "./debug";
import {
  action,
  advance,
  cellX,
  cellY,
  initialState,
  legalSwap,
  openingBoard,
  pointerEvent,
  requestSwap,
  resolveStep,
  runs,
  stepHold,
  targets,
} from "./model";
import type { FacetState, Screen } from "./game";
import * as C from "./constants";

const letters = "RACJBSM";
function board(): FacetState {
  return d.loadBoard(
    { ...initialState(), screen: "playing" },
    Array.from({ length: C.GRID_ROWS }, (_, r) =>
      Array.from(
        { length: C.GRID_COLS },
        (_, c) => `${letters[(c + r * 2) % letters.length]}0`,
      ).join(" "),
    ),
  );
}
function posed(changes: readonly [number, number, string][]): FacetState {
  return changes.reduce((s, [c, r, t]) => d.setGem(s, c, r, t), board());
}
function match(): FacetState {
  return posed([
    [0, 0, "R0"],
    [1, 0, "R0"],
    [2, 0, "A0"],
    [2, 1, "R0"],
  ]);
}
function step(s: FacetState): FacetState {
  return resolveStep({ ...s, phase: "resolving", chainStep: 1 })!;
}
function refill(s: FacetState): FacetState {
  for (let col = 0; col < C.GRID_COLS; col++)
    s = d.setRefillKinds(
      s,
      col,
      Array.from(
        { length: C.GRID_ROWS },
        (_, r) => letters[(r * 2 + col + 3) % letters.length],
      ).join(""),
    );
  return s;
}
afterEach(() => vi.restoreAllMocks());

describe("opening, notation, and move acceptance", () => {
  it("declares a complete title state and a detached snapshot", () => {
    const s = initialState(),
      snap = d.snapshot(s);
    expect(snap).toMatchObject({
      version: C.FACET_DEBUG_VERSION,
      screen: "title",
      level: 1,
      phase: "idle",
      score: 0,
      legalSwap: false,
      board: { cols: 0, rows: 0, cells: [] },
      refillKinds: Array(8).fill(""),
    });
    snap.refillKinds[0] = "RR";
    expect(s.refillKinds[0]).toBe("");
  });
  it("deals fair playable openings without existing runs", () => {
    for (let n = 0; n < 30; n++) {
      const b = openingBoard();
      expect(runs(b)).toHaveLength(0);
      expect(legalSwap(b)).toBe(true);
      expect(b.cells).toHaveLength(C.GRID_COLS * C.GRID_ROWS);
      expect(
        b.cells.every(
          (g) => g.cut === "plain" && g.strain === 0 && g.fell >= g.row + 1,
        ),
      ).toBe(true);
    }
  });
  it("parses every kind, strain, and cut, with prism kind null", () => {
    let s = board();
    for (let i = 0; i < C.GEM_KINDS.length; i++)
      s = d.setGem(s, i, 2, `${letters[i]}${i % 4}${i % 2 ? "b" : "s"}`);
    s = d.setGem(s, 7, 2, "X3");
    expect(s.board.cells.slice(16, 23).map((g) => g.kind)).toEqual([
      ...C.GEM_KINDS,
    ]);
    expect(s.board.cells[23]).toMatchObject({
      kind: null,
      cut: "prism",
      strain: 3,
      fell: 0,
    });
    expect(d.snapshot(s).board.cells[0]).toMatchObject({
      x: cellX(0),
      y: cellY(0),
    });
  });
  it("rejects nonadjacent and unproductive swaps without exchanging", () => {
    const s = board();
    for (const b of [
      { col: 2, row: 0 },
      { col: 1, row: 1 },
      { col: 1, row: 0 },
    ]) {
      const n = requestSwap(s, { col: 0, row: 0 }, b);
      expect(n.board).toBe(s.board);
      expect(n.refusal?.b).toEqual(b);
      expect(n.phase).toBe("idle");
    }
  });
  it("accepts one productive exchange and resets only its move figures", () => {
    const s = { ...match(), moveScore: 500, bestMove: 600, score: 900 };
    const n = d.requestSwap(s, 2, 0, 2, 1);
    expect(n).toMatchObject({
      phase: "swapping",
      chainStep: 0,
      swapTimer: 0,
      score: 900,
      moveScore: 0,
      bestMove: 600,
    });
    expect(n.board.cells[2]).toMatchObject({ kind: "ruby", fell: 0 });
    expect(s.board.cells[2]?.kind).toBe("amber");
  });
  it("refuses R2 without interrupting the accepted swap", () => {
    const n = d.requestSwap(d.requestSwap(match(), 2, 0, 2, 1), 3, 0, 4, 0);
    expect(n.phase).toBe("swapping");
    expect(n.refusal).not.toBeNull();
  });
  it("keeps posed runs inert until an accepted swap", () => {
    const s = posed([
      [0, 0, "R0"],
      [1, 0, "R0"],
      [2, 0, "R0"],
    ]);
    expect(advance(s, 10).board).toBe(s.board);
    expect(d.reconcile(s)).toEqual(s);
  });
  it("finds maximal runs independently of cut and strain", () => {
    const s = posed([
      [0, 0, "R0"],
      [1, 0, "R3b"],
      [2, 0, "R1s"],
      [3, 0, "R2"],
      [4, 0, "R0"],
      [5, 0, "X0"],
    ]);
    expect(runs(s.board)).toContainEqual({
      horizontal: true,
      ids: [0, 1, 2, 3, 4],
    });
  });
});

describe("clear closure, waves, strain, cuts and settling", () => {
  it("scores each cleared cell once and strains each outside neighbor once", () => {
    const s = posed([
      [0, 0, "R0"],
      [1, 0, "R0"],
      [2, 0, "R0"],
      [1, 1, "C1"],
    ]);
    const n = step(s);
    expect(n.lastCleared).toBe(3);
    expect(n.lastPoints).toBe(3 * C.BASE_SCORE);
    expect(n.board.cells[9]?.strain).toBe(2);
  });
  it("expands recursively through flaws and records shortest breadth-first waves", () => {
    const s = posed([
      [0, 0, "R0"],
      [1, 0, "R0"],
      [2, 0, "R0"],
      [2, 1, "J3"],
      [3, 1, "B3"],
      [4, 1, "S3"],
      [4, 2, "M2"],
    ]);
    const n = step(s);
    expect(n.lastCleared).toBe(6);
    expect(n.lastWaves).toBe(3);
    expect(n.lastPoints).toBe(3 * C.BASE_SCORE + 3 * C.FLAWED_SCORE);
    expect(n.board.cells[20]?.strain).toBe(C.MAX_STRAIN);
  });
  it("does not clear a newly flawed stone until a later step", () => {
    const n = step(
      posed([
        [0, 0, "R0"],
        [1, 0, "R0"],
        [2, 0, "R0"],
        [2, 1, "J2"],
      ]),
    );
    expect(n.lastCleared).toBe(3);
    expect(n.board.cells[10]?.strain).toBe(C.MAX_STRAIN);
  });
  it("closes over brilliant rings and chained stars", () => {
    const s = posed([
      [0, 0, "R0"],
      [1, 0, "R0"],
      [2, 0, "R0b"],
      [3, 1, "J0s"],
    ]);
    const n = step(s);
    expect(n.lastCleared).toBeGreaterThan(17);
    expect(n.lastWaves).toBeGreaterThanOrEqual(2);
    expect(
      n.motion?.cleared?.some((c) => c.gem.row === 7 && c.gem.col === 3),
    ).toBe(true);
  });
  it.each([
    [4, "brilliant"],
    [5, "prism"],
    [6, "prism"],
  ] as const)(
    "creates %s-run's %s at the lower middle without a swap",
    (length, cut) => {
      let s = board();
      for (let col = 0; col < length; col++) s = d.setGem(s, col, 0, "R0");
      const n = step(s),
        g = n.board.cells[Math.floor((length - 1) / 2)];
      expect(g).toMatchObject({
        cut,
        strain: 0,
        kind: cut === "prism" ? null : "ruby",
      });
    },
  );
  it("uses the lower run index when both swap cells belong to a long run", () => {
    const s = posed([
      [0, 0, "R0"],
      [1, 0, "R0"],
      [2, 0, "R0"],
      [3, 0, "R0"],
    ]);
    const n = step({
      ...s,
      motion: {
        swap: [
          { col: 3, row: 0 },
          { col: 2, row: 0 },
        ],
      },
    });
    expect(n.board.cells[2]?.cut).toBe("brilliant");
  });
  it("makes a star at an intersection with priority over a brilliant", () => {
    const s = posed([
      [0, 2, "R0"],
      [1, 2, "R0"],
      [2, 2, "R0"],
      [3, 2, "R0"],
      [1, 1, "R0"],
      [1, 3, "R0"],
    ]);
    const n = step(s);
    expect(n.board.cells.some((g) => g.cut === "star")).toBe(true);
  });
  it("gives prism priority when a five-run and crossing share their placement", () => {
    let s = posed([
      [2, 1, "R0"],
      [2, 3, "R0"],
    ]);
    for (let col = 0; col < 5; col++) s = d.setGem(s, col, 2, "R0");
    const n = step(s);
    expect(n.board.cells.some((g) => g.cut === "prism")).toBe(true);
    expect(n.board.cells.some((g) => g.cut === "star")).toBe(false);
  });
  it("seeds a prism swap with that kind, and creates no cut", () => {
    const s = posed([
      [0, 0, "X0"],
      [1, 0, "J0"],
    ]);
    const count = s.board.cells.filter((g) => g.kind === "jade").length;
    const n = advance(d.requestSwap(s, 0, 0, 1, 0), C.SWAP_SECONDS);
    expect(n.lastCleared).toBe(count + 1);
    expect(n.motion?.created).toHaveLength(0);
  });
  it("two prisms seed the entire field at wave zero", () => {
    const s = posed([
      [0, 0, "X0"],
      [1, 0, "X0"],
    ]);
    const n = advance(d.requestSwap(s, 0, 0, 1, 0), C.SWAP_SECONDS);
    expect(n.lastCleared).toBe(64);
    expect(n.lastWaves).toBe(0);
    expect(n.lastPoints).toBe(640);
  });
  it("settles in column order, carries cuts/strain, and retains fell after rest", () => {
    let s = posed([
      [0, 4, "R0"],
      [1, 4, "R0"],
      [2, 4, "R0"],
      [0, 3, "J2b"],
    ]);
    s = refill(s);
    const n = step(s);
    expect(n.board.cells[32]).toMatchObject({
      kind: "jade",
      cut: "brilliant",
      strain: 3,
      fell: 1,
    });
    expect(n.board.cells[0]).toMatchObject({
      kind: "jade",
      cut: "plain",
      strain: 0,
    });
    expect(
      n.board.cells.filter((g) => g.fell > 0).every((g) => g.fell >= 1),
    ).toBe(true);
    const idle = advance(n, stepHold(n));
    expect(idle.board.cells[32]?.fell).toBe(1);
  });
  it("uses persistent refill strings by destination row without consuming them", () => {
    const s = d.setRefillKinds(
      posed([
        [0, 0, "R0"],
        [1, 0, "R0"],
        [2, 0, "R0"],
      ]),
      0,
      "M",
    );
    const n = step(s);
    expect(n.board.cells[0]?.kind).toBe("amethyst");
    expect(n.refillKinds[0]).toBe("M");
    expect(d.clearRefillKinds(n).refillKinds).toEqual(Array(8).fill(""));
  });
  it("caps the score multiplier while tracking the full chain depth", () => {
    const s = posed([
      [0, 0, "R3"],
      [1, 0, "R0"],
      [2, 0, "R0"],
    ]);
    const n = resolveStep({ ...s, chainStep: 12 })!;
    expect(n.lastPoints).toBe(
      (C.FLAWED_SCORE + C.BASE_SCORE * 2) * C.MAX_MULTIPLIER,
    );
    expect(n.bestChain).toBe(12);
  });
});

describe("timing and screen transitions", () => {
  it("clears only after the entire swap duration and preserves overshoot", () => {
    let s = d.requestSwap(refill(match()), 2, 0, 2, 1);
    s = advance(s, 0.1);
    expect(s.lastCleared).toBe(0);
    s = advance(s, 0.1);
    expect(s.chainStep).toBe(1);
    expect(s.stepTimer).toBeCloseTo(0.2 - C.SWAP_SECONDS);
  });
  it("produces the same result across uneven frame partitions", () => {
    const s = d.requestSwap(refill(match()), 2, 0, 2, 1);
    const once = advance(s, 0.42),
      split = [0.012, 0.08, 0.001, 0.14, 0.187].reduce(
        (n, dt) => advance(n, dt),
        s,
      );
    expect(split.board).toEqual(once.board);
    expect(split.score).toBe(once.score);
    expect(split.stepTimer).toBeCloseTo(once.stepTimer);
  });
  it("chains again after precisely the wave, fall, and rest spans", () => {
    let s = d.requestSwap(refill(match()), 2, 0, 2, 1);
    s = advance(s, C.SWAP_SECONDS);
    s = d.setGem(d.setGem(d.setGem(s, 3, 7, "M0"), 4, 7, "M0"), 5, 7, "M0");
    const hold = stepHold(s);
    s = advance(s, hold - 0.001);
    expect(s.chainStep).toBe(1);
    s = advance(s, 0.001);
    expect(s.chainStep).toBe(2);
    expect(s.bestChain).toBe(2);
  });
  it.each(["title", "howto", "paused", "levelclear", "gameover"] as Screen[])(
    "freezes board timers and refusals on %s",
    (screen) => {
      const s = {
        ...d.requestSwap(match(), 2, 0, 2, 1),
        screen,
        refusal: { a: { col: 0, row: 0 }, b: { col: 0, row: 1 }, timer: 0.1 },
      };
      expect(advance(s, 5)).toEqual(s);
    },
  );
  it("ages refusal only in play", () => {
    const s = d.requestSwap(board(), 0, 0, 1, 0);
    expect(advance(s, 0.15).refusal?.timer).toBe(0.15);
    expect(advance(s, C.REFUSAL_SECONDS).refusal).toBeNull();
  });
  it("level completion takes priority over no legal moves", () => {
    let s = step(
      refill(
        posed([
          [0, 0, "R0"],
          [1, 0, "R0"],
          [2, 0, "R0"],
        ]),
      ),
    );
    s = d.loadBoard(
      s,
      board().board.cells.reduce<string[]>((rows, g) => {
        if (g.col === 0) rows.push("");
        rows[g.row] += `${letters[C.GEM_KINDS.indexOf(g.kind!)]}0 `;
        return rows;
      }, []),
    );
    s = { ...s, levelScore: C.LEVEL_TARGET_STEP, moveScore: 390 };
    const n = advance(s, stepHold(s));
    expect(n.screen).toBe("levelclear");
    expect(n.bestMove).toBe(390);
    const next = action(n, "confirm");
    expect(next).toMatchObject({
      screen: "playing",
      level: 2,
      levelScore: 0,
      bestMove: 0,
      bestChain: 0,
      score: n.score,
    });
  });
  it("ends a round on a settled board with no productive swap", () => {
    const s = { ...board(), phase: "resolving" as const, chainStep: 1 };
    expect(legalSwap(s.board)).toBe(false);
    expect(advance(s, stepHold(s)).screen).toBe("gameover");
  });
  it("quits put down the board while back from gameover preserves it", () => {
    for (const screen of ["paused", "levelclear", "gameover"] as const) {
      const s = {
        ...match(),
        screen,
        menuIndex: 1,
        score: 590,
        level: 3,
        levelScore: 900,
      };
      const n = action(s, "confirm");
      expect(n.board.cells).toHaveLength(0);
      expect(n).toMatchObject({
        screen: "title",
        score: 590,
        level: 3,
        levelScore: 900,
      });
    }
    expect(
      action({ ...board(), screen: "gameover" }, "back").board.cells,
    ).toHaveLength(64);
  });
  it("wraps menus, restores the how-to highlight and resets a fresh round", () => {
    let s = action(initialState(), "up");
    expect(s.menuIndex).toBe(1);
    s = action(s, "confirm");
    expect(s.screen).toBe("howto");
    s = action(s, "back");
    expect(s).toMatchObject({ screen: "title", menuIndex: 1 });
    s = action(s, "down");
    s = action({ ...s, score: 1000 }, "confirm");
    expect(s).toMatchObject({ screen: "playing", score: 0, level: 1 });
    const b = s.board;
    s = action(s, "pause");
    expect(s.screen).toBe("paused");
    expect(action(s, "pause").board).toBe(b);
  });
});

describe("pointer path and debug isolation", () => {
  it.each(["mouse", "pen", "touch"] as const)(
    "offers only on release for %s",
    (device) => {
      let s = match();
      s = d.pointerDown(s, cellX(2), cellY(0), device);
      expect(s.selection).toEqual({ col: 2, row: 0 });
      s = d.pointerMove(s, cellX(2), cellY(1), device);
      expect(s.offer).toEqual({ col: 2, row: 1 });
      expect(s.phase).toBe("idle");
      s = d.pointerUp(s, device);
      expect(s.phase).toBe("swapping");
      expect(s.selection).toBeNull();
      expect(s.pointer.device).toBe(device);
    },
  );
  it("withdraws on return, persists through a distant move, and allows tap-tap", () => {
    let s = d.pointerDown(match(), cellX(2), cellY(0));
    s = d.pointerMove(s, cellX(2), cellY(1));
    s = d.pointerMove(s, 0, 0);
    expect(s.offer).not.toBeNull();
    s = d.pointerMove(s, cellX(2), cellY(0));
    s = d.pointerUp(s);
    expect(s.phase).toBe("idle");
    expect(s.selection).not.toBeNull();
    s = d.pointerDown(s, cellX(2), cellY(1));
    expect(s.offer).not.toBeNull();
    expect(d.pointerUp(s).phase).toBe("swapping");
  });
  it("hit-tests Euclidean distance with row then column tie-breaking", () => {
    let s = d.pointerDown(board(), cellX(0) + C.GEM_HIT_R, cellY(0));
    expect(s.selection).toEqual({ col: 0, row: 0 });
    s = d.pointerDown(s, cellX(0) + C.GEM_HIT_R, cellY(0) + C.GEM_HIT_R);
    expect(s.selection).toBeNull();
    s = d.pointerDown(s, cellX(0), cellY(0) + C.GEM_HIT_R);
    expect(s.selection).toEqual({ col: 0, row: 0 });
  });
  it("moves selection on a far cell and clears it outside the board", () => {
    let s = d.setSelection(board(), 0, 0);
    s = d.pointerDown(s, cellX(7), cellY(7));
    expect(s.selection).toEqual({ col: 7, row: 7 });
    expect(d.pointerDown(s, 10, 10).selection).toBeNull();
  });
  it("every screen's targets are large, nonoverlapping, and work by touch", () => {
    for (const screen of [
      "title",
      "howto",
      "playing",
      "paused",
      "levelclear",
      "gameover",
    ] as const) {
      const s = { ...board(), screen };
      const ts = targets(s);
      for (const t of ts) {
        expect(t.w).toBeGreaterThanOrEqual(C.TARGET_MIN_W);
        expect(t.h).toBeGreaterThanOrEqual(C.TARGET_MIN_H);
        expect(t.x + t.w).toBeLessThanOrEqual(C.STAGE_W);
        expect(t.y + t.h).toBeLessThanOrEqual(C.STAGE_H);
      }
      for (const a of ts)
        for (const b of ts)
          if (a !== b)
            expect(
              a.x + a.w <= b.x ||
                b.x + b.w <= a.x ||
                a.y + a.h <= b.y ||
                b.y + b.h <= a.y,
            ).toBe(true);
      const t = ts[0]!;
      const down = d.pointerDown(s, t.x + t.w / 2, t.y + t.h / 2, "touch");
      expect(d.pointerUp(down, "touch").screen).not.toBe(screen);
    }
  });
  it("requires a release within the armed target and disarms across screens", () => {
    const t = targets(initialState())[0]!;
    let s = d.pointerDown(initialState(), t.x + 20, t.y + 20);
    s = d.pointerMove(s, 0, 0);
    s = d.pointerUp(s);
    expect(s.screen).toBe("title");
    expect(s.armedTarget).toBeNull();
    s = d.pointerDown(s, t.x + 20, t.y + 20);
    s = action(s, "confirm");
    expect(s.armedTarget).toBeNull();
    s = pointerEvent(initialState(), "move", 500, 530);
    expect(s.menuIndex).toBe(1);
  });
  it("debug poses alter exactly their requested figure", () => {
    let s = match();
    s = d.setScore(s, 500);
    s = d.setLevel(s, 4);
    s = d.setLevelScore(s, 600);
    s = d.setMoveScore(s, 700);
    s = d.setBestMove(s, 800);
    s = d.setBestChain(s, 9);
    s = d.setMenuIndex(s, 99);
    expect(d.snapshot(s)).toMatchObject({
      score: 500,
      level: 4,
      levelTarget: 8000,
      levelScore: 600,
      moveScore: 700,
      bestMove: 800,
      bestChain: 9,
      menuIndex: 99,
    });
    s = d.setSelection(s, 7, 7);
    s = d.setOffer(s, 0, 0);
    s = d.clearSelection(s);
    expect(s.offer).not.toBeNull();
    s = d.clearOffer(s);
    expect(s.offer).toBeNull();
    s = d.requestSwap(s, 2, 0, 2, 1);
    s = d.clearChain(s);
    expect(s.phase).toBe("idle");
    s = d.requestSwap(s, 0, 0, 7, 7);
    s = d.clearRefusal(s);
    expect(s.refusal).toBeNull();
    const empty = d.clearBoard(s);
    expect(empty.score).toBe(s.score);
    expect(empty.board.cells).toHaveLength(0);
    expect(d.reset({ ...s, muted: true })).toMatchObject({
      ...initialState(),
      muted: true,
    });
  });
  it("reconcile is a pure idempotent reading even with no board", () => {
    const s = d.setSelection(d.clearBoard(board()), 7, 7);
    expect(d.reconcile(s)).toEqual(s);
    expect(d.reconcile(d.reconcile(s))).toEqual(s);
  });
  it("invalid poses fail loudly", () => {
    const s = board();
    for (const fn of [
      () => d.setGem(s, 8, 0, "R0"),
      () => d.setGem(s, 0, 0, "X0b"),
      () => d.setGem(s, 0, 0, "R4"),
      () => d.loadBoard(s, ["R0"]),
      () => d.loadBoard(s, Array(8).fill("R0")),
      () => d.setLevel(s, 0),
      () => d.setScore(s, -1),
      () => d.setMenuIndex(s, -1),
      () => d.setBestChain(s, 1.5),
      () => d.setRefillKinds(s, 0, "X"),
      () => d.setRefillKinds(s, 8, "R"),
      () => d.pointerDown(s, NaN, 0),
      () => d.setGem(initialState(), 0, 0, "R0"),
      () => d.setScreen(s, "bad" as Screen),
    ])
      expect(fn).toThrow(RangeError);
  });
});
