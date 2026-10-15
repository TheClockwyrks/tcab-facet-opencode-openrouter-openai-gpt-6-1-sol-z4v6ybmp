# Facet — Game state

`src/game.ts` declares and exports the state the game is written against. This
section is that declaration: write it into `src/game.ts` exactly as it stands
here. The state is a value the engine holds and every frame replaces, so every
field and every array is declared `readonly`: a frame builds the next state from
the current one rather than writing into it, and every reader is handed the
state as `DeepReadonly<FacetState>` in any case.

```ts
export type GemKind =
  | "ruby"
  | "amber"
  | "citrine"
  | "jade"
  | "beryl"
  | "sapphire"
  | "amethyst";

export type Cut = "plain" | "brilliant" | "star" | "prism";

export type Screen =
  | "title"
  | "howto"
  | "playing"
  | "paused"
  | "levelclear"
  | "gameover";

export type Phase = "idle" | "swapping" | "resolving";

export type PointerDevice = "mouse" | "pen" | "touch";

export interface CellRef {
  readonly col: number;
  readonly row: number;
}

export interface GemState {
  readonly col: number;
  readonly row: number;
  readonly kind: GemKind | null;
  readonly cut: Cut;
  readonly strain: number;
  readonly fell: number;
}

export interface BoardState {
  readonly cols: number;
  readonly rows: number;
  readonly cells: readonly GemState[];
}

export interface RefusalState {
  readonly a: CellRef;
  readonly b: CellRef;
  readonly timer: number;
}

export interface PointerState {
  readonly x: number;
  readonly y: number;
  readonly down: boolean;
  readonly device: PointerDevice;
}

export interface FacetState {
  readonly screen: Screen;
  readonly menuIndex: number;

  readonly board: BoardState;
  readonly phase: Phase;
  readonly chainStep: number;
  readonly swapTimer: number;
  readonly stepTimer: number;

  readonly score: number;
  readonly level: number;
  readonly levelScore: number;
  readonly lastCleared: number;
  readonly lastPoints: number;
  readonly lastWaves: number;

  readonly moveScore: number;
  readonly bestMove: number;
  readonly bestChain: number;

  readonly selection: CellRef | null;
  readonly offer: CellRef | null;
  readonly refusal: RefusalState | null;
  readonly armedTarget: string | null;

  readonly pointer: PointerState;
  readonly simTime: number;
  readonly muted: boolean;
  readonly refillKinds: readonly string[];
}
```

## The type aliases

`GemKind` names one gem identity, and the seven are the members of `GEM_KINDS`
in that order, as `specs/board.md` defines them. `Cut` names the four cuts a gem
can carry, `plain` being the cut a dealt gem arrives with and the other three
being the cuts a run creates under R8 in `specs/rules.md`. `Screen` is the
top-level state machine, and `screen` names the screen the game is showing;
every build carries all six. `Phase` names where resolution stands on the
`playing` screen: `idle` while the board is settled, `swapping` while an
accepted swap is in motion, and `resolving` while a chain is running.
`PointerDevice` names what drove the pointer. `CellRef` addresses one cell of
the board, `col` and `row` both zero-indexed from the top-left.

## `GemState`

One gem and the cell it occupies. The board carries one entry per cell, in
reading order from the top-left cell to the bottom-right.

- `col`, `row` — the cell the gem occupies.
- `kind` — the gem's kind, and `null` for a `prism`, which carries no kind.
- `cut` — `"plain"`, `"brilliant"`, `"star"`, or `"prism"`.
- `strain` — the gem's strain, a whole number from `0` to `MAX_STRAIN` (`3`). A
  gem at `MAX_STRAIN` is flawed.
- `fell` — how many rows the gem traveled to reach this cell, as R9 in
  `specs/rules.md` fixes it. A gem that was already standing here carries `0`.
  The figure stands until that gem is moved again, so the board coming to rest
  does not clear it.

A gem's center on the stage is `cellX(col)` and `cellY(row)` from
`specs/board.md`, so the state carries no coordinates. Strain and cut travel
with the gem when R9 drops it into a lower cell, because they are the gem's
rather than the cell's, and `fell` is what that drop was worth.

## `BoardState`

The board being played, and `{ cols: 0, rows: 0, cells: [] }` while no board is
in play.

- `cols`, `rows` — the grid's dimensions, `GRID_COLS` (`8`) by `GRID_ROWS` (`8`)
  whenever a board is in play.
- `cells` — every cell of the board, in reading order from the top-left cell to
  the bottom-right, so `cells` holds `cols * rows` entries. Every cell holds a
  gem once a chain step has finished settling under R9.

## `RefusalState`

The swap most recently refused under R1, R2, or R3, and `null` whenever none is
standing.

- `a`, `b` — the two cells the refused swap named, in the order they were named.
- `timer` — the game time the refusal has stood for, in seconds. Every update
  adds its `dt` to it, and `refusal` returns to `null` once it reaches
  `REFUSAL_SECONDS` (`0.3`).

## `PointerState`

Where the pointer is, whether it is pressed, and what drove it, as the game read
it in the current frame.

- `x`, `y` — the pointer position in the stage's logical units, the same units
  the cell centers are in, so a hit test against a cell center needs no
  conversion.
- `down` — whether the pointer is currently pressed.
- `device` — `"mouse"`, `"pen"`, or `"touch"`, whichever drove the pointer last.

## `FacetState`

The whole of Facet's state. Every field is present from the moment `initialize`
returns, and every one is plain data: numbers, strings, booleans, and containers
of them, so a board is posed by building a state that differs in the fields
posed and read back by reading them.

- `screen` — the screen currently shown.
- `menuIndex` — the highlighted item on whichever vertical menu `screen` is
  showing.
- `board` — the board being played.
- `phase` — `"idle"` while the board is settled, `"swapping"` while an accepted
  swap is in motion, `"resolving"` while a chain is running.
- `chainStep` — the chain step being resolved, counted from `1`, and `0` unless
  `phase` is `"resolving"`.
- `swapTimer` — the game time accumulated into the swap in motion, in seconds,
  which returns to `0` at `SWAP_SECONDS` (`0.18`) as `specs/rules.md`
  describes, and holds `0` while `phase` is not `"swapping"`.
- `stepTimer` — the game time accumulated into the chain step in progress, in
  seconds, which returns to `0` at that step's `STEP_HOLD` as `specs/rules.md`
  describes, and holds `0` while `phase` is not `"resolving"`.
- `score` — the round's score.
- `level` — the level being played, counted from `1`.
- `levelScore` — the score banked toward the current level, which returns to `0`
  when the next level is opened.
- `lastCleared` — how many cells the most recent chain step cleared. Each step
  replaces it, and it holds `0` until a step has run.
- `lastPoints` — how many points the most recent chain step scored. Each step
  replaces it, and it holds `0` until a step has run.
- `lastWaves` — the greatest wave R6 gave the most recent chain step's clear
  set. Each step replaces it, and it holds `0` until a step has run.
- `moveScore` — the points the move currently running has scored, which returns
  to `0` when a swap is accepted.
- `bestMove` — the most points one move has scored in the current level.
- `bestChain` — the deepest `chainStep` any chain has reached in the current
  level.
- `selection` — the selected cell, or `null` when nothing is selected.
- `offer` — the cell the selected gem is currently offered into, or `null` when
  nothing is offered.
- `refusal` — the refusal currently standing, or `null`.
- `armedTarget` — the id of the pointer target the held press armed, or `null`.
- `pointer` — the pointer as of this frame.
- `simTime` — accumulated simulation time, in seconds. Every `update` adds its
  `dt`, whatever the screen, the menus included.
- `muted` — the game's readable copy of the engine's mute bit, which every
  `update` carries into the state it returns. The engine owns muting, and this
  field is what the debug surface reports.
- `refillKinds` — the kinds posed for each column's refill, `GRID_COLS` (`8`)
  entries, one per column: the string `setRefillKinds` in
  `specs/instrumentation.md` posed for that column, and `""` for a column that
  draws as R9 states. Every entry is `""` until a refill is posed.

Six facts the game shows follow from the declared fields rather than being
fields of their own. A cell's center comes from the cell center formulas in
`specs/board.md`. The level's target is
`LEVEL_TARGET_STEP` (`2000`) times `level`. The chain multiplier is
`min(chainStep, MAX_MULTIPLIER)`, `MAX_MULTIPLIER` (`8`). The most recent step's
longest fall is the greatest `fell` on the board. Whether a legal swap exists
comes from R1 and R3 in `specs/rules.md`, read over the board as it stands. The
current screen's pointer targets come from `specs/controls.md`.

## The contract

The declaration above is what the debug surface reads and poses.

- Keep every field under its declared name, type, and meaning.
- `initialize` builds the whole state in one go, so every field is present by
  the time a frame can observe it, and none of them is optional.
- Fields you add hold derived data you can rebuild from the declared ones. A
  `reset` restores the declared fields to their title-screen values, so those
  fields are the whole of the authoritative state.
- The state handed to `update` is the whole of the game, and the state `update`
  returns is the whole of the next frame. Every value the game carries from one
  frame to the next lives in it; nothing is kept in a module-level variable or a
  closure.
- The state is handed over read-only, as `DeepReadonly<FacetState>`, to
  `update`, to `render`, to every diagnostic source, and to every operation of
  the debug surface. `update` and the surface's poses return a new `FacetState`
  built from the one they received; `render`, the sources, and `snapshot` return
  no state.
