/// <reference types="node" />
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import {
  createEngine,
  ConstantClock,
  type Engine,
} from "@clockwyrks/simple-2d";
import { game, BACKGROUND, type FacetState, type FacetDebugApi } from "./game";
import { cellX, cellY, stepHold } from "./model";
import { CUES, STAGE_W, STAGE_H, LAYOUT } from "./constants";

// Real committed images and JSON are decoded in Node. Web Audio's host boundary
// is represented by a WAV header decoder; browser playback is verified separately.
class AudioHost {
  async decodeAudioData(data: ArrayBuffer) {
    const b = Buffer.from(data);
    expect(b.toString("ascii", 0, 4)).toBe("RIFF");
    let peak = 0;
    for (let offset = 44; offset + 1 < b.length; offset += 2)
      peak = Math.max(peak, Math.abs(b.readInt16LE(offset)));
    expect(peak).toBeGreaterThan(400);
    return { duration: b.length / 88200 };
  }
  async resume() {}
}
let engine: Engine<FacetState, FacetDebugApi>;
let events: EventTarget;
const cues: string[] = [];
const loops: string[] = [];
const loaded: string[] = [];
function key(code: string) {
  for (const name of ["keydown", "keyup"])
    events.dispatchEvent(
      Object.assign(new Event(name), { code, repeat: false }),
    );
}
function pointer(
  type: string,
  x: number,
  y: number,
  primary = true,
  device = "mouse",
  id = 1,
) {
  events.dispatchEvent(
    Object.assign(new Event(`pointer${type}`), {
      clientX: x,
      clientY: y,
      pointerId: id,
      pointerType: device,
      isPrimary: primary,
      button: 0,
      buttons: type === "up" ? 0 : 1,
    }),
  );
}
function setupBoard() {
  const rows = Array.from({ length: 8 }, (_, r) =>
    Array.from({ length: 8 }, (_, c) => `${"RACJBSM"[(c + r * 2) % 7]}0`).join(
      " ",
    ),
  );
  engine.apply((s) => engine.debug.reset(s));
  engine.apply((s) => engine.debug.loadBoard(s, rows));
  engine.apply((s) => engine.debug.setScreen(s, "playing"));
  for (const [c, r, t] of [
    [0, 0, "R0"],
    [1, 0, "R0"],
    [2, 0, "A0"],
    [2, 1, "R0"],
  ] as const)
    engine.apply((s) => engine.debug.setGem(s, c, r, t));
  for (let col = 0; col < 8; col++)
    engine.apply((s) =>
      engine.debug.setRefillKinds(
        s,
        col,
        Array.from(
          { length: 8 },
          (_, r) => "RACJBSM"[(r * 2 + col + 3) % 7],
        ).join(""),
      ),
    );
  cues.length = 0;
}
beforeAll(async () => {
  vi.stubGlobal(
    "fetch",
    async (path: string) =>
      new Response(
        await readFile(new URL(`../public/${path}`, import.meta.url)),
      ),
  );
  vi.stubGlobal("createImageBitmap", async (blob: Blob) =>
    loadImage(Buffer.from(await blob.arrayBuffer())),
  );
  vi.stubGlobal("AudioContext", AudioHost);
  events = new EventTarget();
  engine = createEngine({
    canvas: createCanvas(STAGE_W, STAGE_H) as unknown as HTMLCanvasElement,
    width: STAGE_W,
    height: STAGE_H,
    game,
    background: BACKGROUND,
    layout: LAYOUT,
    clock: new ConstantClock(10),
    surface: {
      cssWidth: () => STAGE_W,
      cssHeight: () => STAGE_H,
      dpr: () => 1,
      events: () => events,
    },
  });
  engine.events.on("asset:loaded", (e) => loaded.push(e.path));
  engine.events.on("cue:played", (e) => cues.push(e.cue));
  engine.events.on("cue:looped", (e) => loops.push(e.cue));
  await engine.initialize();
});
afterAll(() => {
  engine.destroy();
  vi.unstubAllGlobals();
});

describe("the real Simple 2D integration", () => {
  it("awaits the entire genuine asset set before exposing its debug API", () => {
    expect(engine.debug.version).toBe(1);
    expect(loaded).toHaveLength(112);
    expect(loaded).toContain("fx/aura.json");
    expect(loaded).toContain("audio/play.wav");
    expect(loaded).toContain("gems/break/ruby/5.png");
    expect(Object.keys(engine.state.resources?.images ?? {})).toHaveLength(89);
  });
  it("reads keyboard actions, accumulates time on menus, and switches music", async () => {
    const t = engine.state.simTime;
    await engine.advance(1);
    expect(engine.state.simTime).toBeCloseTo(t + 0.01);
    expect(loops).toContain("music-title");
    key("ArrowDown");
    await engine.advance(1);
    expect(engine.state.menuIndex).toBe(1);
    key("Space");
    await engine.advance(1);
    expect(engine.state.screen).toBe("howto");
    key("Escape");
    await engine.advance(1);
    expect(engine.state.menuIndex).toBe(1);
    key("ArrowUp");
    await engine.advance(1);
    key("Enter");
    await engine.advance(1);
    expect(engine.state.screen).toBe("playing");
    expect(loops).toContain("music-play");
  });
  it("processes all primary pointer samples in arrival order, playing cues once", async () => {
    setupBoard();
    pointer("down", cellX(2), cellY(0));
    pointer("move", cellX(2), cellY(1));
    pointer("up", cellX(2), cellY(1));
    await engine.advance(1);
    expect(engine.state.phase).toBe("swapping");
    expect(cues).toEqual([CUES.select, CUES.swap]);
    await engine.advance(17);
    expect(engine.state.phase).toBe("resolving");
    expect(cues.filter((c) => c === CUES.clear)).toHaveLength(1);
    expect(engine.state.lastCleared).toBe(3);
  });
  it("ignores a second finger and mirrors the primary device", async () => {
    setupBoard();
    pointer("down", cellX(0), cellY(0), true, "touch", 11);
    pointer("down", cellX(7), cellY(7), false, "touch", 12);
    await engine.advance(1);
    expect(engine.state.selection).toEqual({ col: 0, row: 0 });
    expect(engine.state.pointer.device).toBe("touch");
    pointer("up", cellX(7), cellY(7), false, "touch", 12);
    pointer("up", cellX(0), cellY(0), true, "touch", 11);
    await engine.advance(1);
  });
  it("keeps debug transactions silent and poses immediate", () => {
    setupBoard();
    engine.apply((s) => engine.debug.pointerDown(s, cellX(2), cellY(0), "pen"));
    expect(engine.state.selection).toEqual({ col: 2, row: 0 });
    engine.apply((s) => engine.debug.pointerMove(s, cellX(2), cellY(1), "pen"));
    engine.apply((s) => engine.debug.pointerUp(s, "pen"));
    expect(engine.state.phase).toBe("swapping");
    expect(cues).toHaveLength(0);
  });
  it("freezes timers while paused and mirrors the engine's live mute bit", async () => {
    setupBoard();
    engine.apply((s) => engine.debug.requestSwap(s, 2, 0, 2, 1));
    key("KeyP");
    await engine.advance(1);
    const timer = engine.state.swapTimer;
    await engine.advance(40);
    expect(engine.state.swapTimer).toBe(timer);
    expect(engine.state.screen).toBe("paused");
    key("KeyM");
    await engine.advance(1);
    expect(engine.state.muted).toBe(true);
    key("Escape");
    await engine.advance(1);
    expect(engine.state.screen).toBe("playing");
    key("KeyM");
    await engine.advance(1);
    expect(engine.state.muted).toBe(false);
  });
  it("reads pure diagnostics against the current posed state", () => {
    engine.apply((s) => engine.debug.setScore(s, 9876));
    const before = engine.state;
    const diagnostics = engine.diagnostics();
    expect(diagnostics.find((d) => d.name === "score")?.value).toBe(9876);
    expect(diagnostics.every((d) => !d.error)).toBe(true);
    expect(engine.state).toBe(before);
  });
  it("plays clear/flaw/cut once per frame, and renders the produced cut art", async () => {
    setupBoard();
    for (let col = 0; col < 4; col++)
      engine.apply((s) => engine.debug.setGem(s, col, 0, "R0"));
    for (let col = 0; col < 3; col++)
      engine.apply((s) =>
        engine.debug.setGem(s, col, 1, ["J2", "C2", "B2"][col]!),
      );
    engine.apply((s) => engine.debug.requestSwap(s, 0, 0, 1, 0));
    await engine.advance(18);
    expect(cues.filter((c) => c === CUES.flaw)).toHaveLength(1);
    expect(cues.filter((c) => c === CUES.cut)).toHaveLength(1);
    expect(engine.state.board.cells.some((g) => g.cut === "brilliant")).toBe(
      true,
    );
    await engine.advance(15);
  });
  it("renders every screen, special treatment and animation through the recorder", async () => {
    setupBoard();
    engine.apply((s) => engine.debug.setGem(s, 4, 4, "X3"));
    engine.apply((s) => engine.debug.setGem(s, 5, 4, "S2s"));
    engine.apply((s) => engine.debug.setGem(s, 6, 4, "J1b"));
    engine.startRecording();
    for (const screen of [
      "playing",
      "paused",
      "levelclear",
      "gameover",
      "howto",
      "title",
    ] as const) {
      engine.apply((s) => engine.debug.setScreen(s, screen));
      await engine.advance(1);
    }
    const recording = engine.stopRecording();
    expect(recording.frames).toHaveLength(6);
    expect(
      recording.ops.some((op) => op.op === "call" && op.method === "drawImage"),
    ).toBe(true);
    expect(recording.frames.every((f) => !f.truncated)).toBe(true);
  });
  it("lands a long fall at its exact event boundary", async () => {
    setupBoard();
    engine.apply((s) => engine.debug.setGem(s, 0, 0, "X0"));
    engine.apply((s) => engine.debug.setGem(s, 1, 0, "X0"));
    engine.apply((s) => engine.debug.requestSwap(s, 0, 0, 1, 0));
    await engine.advance(18);
    expect(engine.state.lastCleared).toBe(64);
    await engine.advance(39);
    expect(cues).not.toContain(CUES.land);
    await engine.advance(1);
    expect(cues.filter((c) => c === CUES.land)).toHaveLength(1);
    expect(stepHold(engine.state)).toBeGreaterThan(engine.state.stepTimer);
  }, 15000);
});
