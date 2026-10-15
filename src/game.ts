import type { Game } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import { ACTIONS, BINDINGS, CUES, MAX_MULTIPLIER } from "./constants";
import {
  initialState,
  advance,
  pointerEvent,
  action,
  legalSwap,
  lastFall,
  stepHold,
} from "./model";
import { debug } from "./debug";
import type { FacetDebugApi } from "./debug";
import { loadResources, render, type Resources } from "./presentation";

export type { FacetDebugApi } from "./debug";
export type GemKind =
  "ruby" | "amber" | "citrine" | "jade" | "beryl" | "sapphire" | "amethyst";
export type Cut = "plain" | "brilliant" | "star" | "prism";
export type Screen =
  "title" | "howto" | "playing" | "paused" | "levelclear" | "gameover";
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
  // Presentation receipts describe the transition that produced the current board.
  // They never participate in match detection or scoring.
  readonly motion?: Motion;
  readonly resources?: Resources;
}
export interface Motion {
  readonly swap?: readonly [CellRef, CellRef];
  readonly prism?: GemKind | "all" | null;
  readonly before?: BoardState;
  readonly cleared?: readonly {
    readonly gem: GemState;
    readonly wave: number;
  }[];
  readonly created?: readonly CellRef[];
  readonly dealAge?: number;
}
export type State = DeepReadonly<FacetState>;
export type Emit = (cue: string, multiplier?: number) => void;
export const BACKGROUND = "#091a22";

export const game: Game<FacetState, FacetDebugApi> = {
  async initialize(api) {
    for (const name of ACTIONS)
      api.input.register(name, { keys: [...BINDINGS[name]] });
    const resources = await loadResources(api);
    const sources: Record<string, (s: State) => string | number | boolean> = {
      screen: (s) => s.screen,
      phase: (s) => s.phase,
      board: (s) => `${s.board.cols} × ${s.board.rows}`,
      score: (s) => s.score,
      level: (s) => s.level,
      levelScore: (s) => `${s.levelScore} / ${debug.snapshot(s).levelTarget}`,
      chainStep: (s) => s.chainStep,
      multiplier: (s) => Math.min(s.chainStep, MAX_MULTIPLIER),
      lastCleared: (s) => s.lastCleared,
      lastPoints: (s) => s.lastPoints,
      lastWaves: (s) => s.lastWaves,
      lastFall,
      stepHold,
      selection: (s) =>
        s.selection ? `${s.selection.col}, ${s.selection.row}` : "none",
      offer: (s) => (s.offer ? `${s.offer.col}, ${s.offer.row}` : "none"),
      bestMove: (s) => s.bestMove,
      bestChain: (s) => s.bestChain,
      legalSwap: (s) => legalSwap(s.board),
      pointer: (s) =>
        `${s.pointer.x.toFixed(0)}, ${s.pointer.y.toFixed(0)} ${s.pointer.device}`,
    };
    for (const [name, source] of Object.entries(sources))
      api.diagnostics.register(name, source);
    return [{ ...initialState(), resources }, debug];
  },
  update(state, api, dt) {
    const played = new Set<string>();
    const emit: Emit = (cue, multiplier) => {
      if (played.has(cue)) return;
      played.add(cue);
      api.audio.play(cue);
      if (cue === CUES.clear)
        api.audio.play(`rung-${Math.max(1, multiplier ?? 1)}`);
    };
    let s: FacetState = { ...state, simTime: state.simTime + dt };
    const pressed = Object.fromEntries(
      ACTIONS.map((name) => [name, api.input.pressed(name)]),
    );
    if (pressed.mute) api.audio.setMuted(!api.audio.muted());
    for (const name of ACTIONS)
      if (pressed[name] && name !== "mute") s = action(s, name, emit);
    for (const sample of api.input.pointerSamples()) {
      if (!sample.primary || (sample.button && sample.button !== "primary"))
        continue;
      s = pointerEvent(s, sample.type, sample.x, sample.y, sample.device, emit);
    }
    const p = api.input.pointer();
    s = advance(
      { ...s, pointer: { x: p.x, y: p.y, down: p.down, device: p.device } },
      dt,
      emit,
    );
    const title = s.screen === "title" || s.screen === "howto";
    const music = title ? "music-title" : "music-play";
    const other = title ? "music-play" : "music-title";
    if (api.audio.looping(other)) api.audio.stop(other);
    if (!api.audio.looping(music)) api.audio.loop(music);
    return { ...s, muted: api.audio.muted() };
  },
  render,
};
