import type { InitApi, RenderApi } from "@clockwyrks/simple-2d";
import type { DeepReadonly } from "ts-essentials";
import {
  ParticleSimulator,
  type ParticleSystem,
} from "@clockwyrks/particle-runtime";
import * as C from "./constants";
import type { CellRef, FacetState, GemState, State } from "./game";
import { cellX, cellY, same, targets } from "./model";

export interface Resources {
  readonly images: Readonly<Record<string, ImageBitmap>>;
  readonly effects: Readonly<Record<string, DeepReadonly<ParticleSystem>>>;
}
export async function loadResources(
  api: InitApi<FacetState>,
): Promise<Resources> {
  const paths: string[] = ["board-frame", "brilliant", "star"];
  for (const kind of [...C.GEM_KINDS, "prism"])
    for (let strain = 0; strain <= C.MAX_STRAIN; strain++)
      paths.push(`${kind}-${strain}`);
  for (const kind of C.GEM_KINDS)
    for (let frame = 0; frame < 6; frame++)
      paths.push(`break/${kind}/${frame}`);
  for (let frame = 0; frame < 12; frame++) paths.push(`prism-turn/${frame}`);
  const images = Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [
        path,
        await api.assets.loadImage(`gems/${path}.png`),
      ]),
    ),
  );
  const effects = Object.fromEntries(
    await Promise.all(
      ["clear", "flawed", "cut", "aura"].map(async (name) => [
        name,
        JSON.parse(
          await (await api.assets.load(`fx/${name}.json`)).text(),
        ) as ParticleSystem,
      ]),
    ),
  );
  await Promise.all([
    ...Object.values(C.CUES).map((name) =>
      api.audio.load(
        name,
        `audio/${name === C.CUES.clear ? "shatter" : name}.wav`,
      ),
    ),
    ...Array.from({ length: C.MAX_MULTIPLIER }, (_, i) =>
      api.audio.load(`rung-${i + 1}`, `audio/chain-${i + 1}.wav`),
    ),
    api.audio.load("music-title", "audio/title.wav"),
    api.audio.load("music-play", "audio/play.wav"),
  ]);
  return { images, effects };
}
const INK = "#eae7d8",
  GOLD = "#c9ad75",
  DIM = "#8dabae",
  TEAL = "#8edaca";
type Ctx = CanvasRenderingContext2D;
function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size = 16,
  color = INK,
  align: CanvasTextAlign = "left",
  serif = false,
) {
  ctx.font = `${serif ? "400" : "500"} ${size}px ${serif ? 'Georgia, "Times New Roman", serif' : '"Trebuchet MS", Arial, sans-serif'}`;
  ctx.textAlign = align;
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = color;
  ctx.fillText(value, x, y);
}
function spaced(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size = 12,
  color = GOLD,
  spacing = 3,
  align: "left" | "center" = "left",
) {
  ctx.font = `500 ${size}px "Trebuchet MS", Arial, sans-serif`;
  const widths = [...value].map((c) => ctx.measureText(c).width + spacing);
  let at = align === "center" ? x - widths.reduce((a, b) => a + b, 0) / 2 : x;
  for (let i = 0; i < value.length; i++) {
    text(ctx, value[i]!, at, y, size, color);
    at += widths[i]!;
  }
}
function line(
  ctx: Ctx,
  x: number,
  y: number,
  x2: number,
  y2: number,
  color = "#355052",
) {
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x2, y2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();
}
function diamond(ctx: Ctx, x: number, y: number, r: number, color = GOLD) {
  ctx.beginPath();
  ctx.moveTo(x, y - r);
  ctx.lineTo(x + r, y);
  ctx.lineTo(x, y + r);
  ctx.lineTo(x - r, y);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
}
function panel(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  fill = "#0d242d",
  stroke = "#47605a",
) {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, 5);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}
function paragraph(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  width: number,
  size = 16,
  color = DIM,
  leading = 25,
): number {
  ctx.font = `500 ${size}px "Trebuchet MS", Arial, sans-serif`;
  const words = value.split(" ");
  let row = "";
  for (const word of words) {
    const next = row ? `${row} ${word}` : word;
    if (ctx.measureText(next).width > width && row) {
      text(ctx, row, x, y, size, color);
      y += leading;
      row = word;
    } else row = next;
  }
  if (row) text(ctx, row, x, y, size, color);
  return y + leading;
}
function background(ctx: Ctx) {
  const glow = ctx.createRadialGradient(
    C.STAGE_CX,
    300,
    30,
    C.STAGE_CX,
    C.STAGE_CY,
    720,
  );
  glow.addColorStop(0, "#173b41");
  glow.addColorStop(0.55, "#0d252e");
  glow.addColorStop(1, "#091a22");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  // Fine architectural lines echo the facets without competing with the board.
  for (let i = -4; i < 10; i++) {
    line(ctx, i * 180, -30, i * 180 + 650, C.STAGE_H, "#17313a");
    line(ctx, i * 180 + 650, -30, i * 180, C.STAGE_H, "#132e36");
  }
  line(ctx, 40, 28, 1240, 28, "#38504e");
  line(ctx, 40, 692, 1240, 692, "#38504e");
  for (const x of [40, 1240]) for (const y of [28, 692]) diamond(ctx, x, y, 3);
}
function sprite(
  ctx: Ctx,
  s: State,
  name: string,
  x: number,
  y: number,
  size = 64,
  alpha = 1,
) {
  const image = s.resources?.images[name];
  if (!image) return;
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(image, x - size / 2, y - size / 2, size, size);
  ctx.restore();
}
function particles(
  ctx: Ctx,
  s: State,
  name: string,
  x: number,
  y: number,
  age: number,
  seed: number,
) {
  const system = s.resources?.effects[name];
  if (!system || age < 0 || age > 1.2) return;
  // Reconstructing a pure simulator at its presentation age keeps render read-only:
  // capture/replay and arbitrary engine clocks cannot alter the rules or the VFX age.
  const sim = new ParticleSimulator(system as ParticleSystem, {
    seed,
    maxParticles: 64,
  });
  let left = age * 1000;
  while (left > 0) {
    const dt = Math.min(1000 / 30, left);
    sim.step(dt);
    left -= dt;
  }
  ctx.save();
  ctx.globalCompositeOperation = "lighter";
  for (const p of sim.capture()) {
    ctx.globalAlpha = p.opacity;
    const color = `rgb(${p.color.map((c) => Math.round(c * 255)).join(",")})`;
    diamond(
      ctx,
      x + p.position[0],
      y - p.position[1],
      Math.max(0.3, p.size),
      color,
    );
  }
  ctx.restore();
}
function gem(ctx: Ctx, s: State, g: GemState, x: number, y: number) {
  if (g.cut !== "plain")
    particles(
      ctx,
      s,
      "aura",
      x,
      y,
      (s.simTime + g.col * 0.12 + g.row * 0.09) % 1.2,
      g.col * 37 + g.row * 91 + 5,
    );
  if (g.cut === "prism") {
    sprite(ctx, s, `prism-turn/${Math.floor(s.simTime * 9) % 12}`, x, y);
    if (g.strain > 0) sprite(ctx, s, `prism-${g.strain}`, x, y, 64, 0.8);
  } else sprite(ctx, s, `${g.kind}-${g.strain}`, x, y);
  if (g.cut === "brilliant" || g.cut === "star") sprite(ctx, s, g.cut, x, y);
}
function button(
  ctx: Ctx,
  label: string,
  t: { x: number; y: number; w: number; h: number },
  active: boolean,
) {
  panel(
    ctx,
    t.x,
    t.y,
    t.w,
    t.h,
    active ? "#cbb382" : "#102a33",
    active ? "#f4dfad" : "#52645b",
  );
  spaced(
    ctx,
    label,
    t.x + t.w / 2,
    t.y + t.h / 2 + 5,
    15,
    active ? "#14272d" : INK,
    2.8,
    "center",
  );
  if (active) {
    diamond(ctx, t.x + 25, t.y + t.h / 2, 3, "#35423b");
    diamond(ctx, t.x + t.w - 25, t.y + t.h / 2, 3, "#35423b");
  }
}
function footer(ctx: Ctx, s: State) {
  spaced(ctx, "A STUDY IN CHAIN REACTIONS", 62, 679, 9, DIM, 2);
  text(
    ctx,
    s.muted ? "M  SOUND OFF" : "M  SOUND ON",
    1218,
    679,
    11,
    DIM,
    "right",
  );
}
function title(ctx: Ctx, s: State) {
  spaced(ctx, "THE LAPIDARY COLLECTION", C.STAGE_CX, 65, 11, GOLD, 4, "center");
  // A small constellation of genuine produced stones forms the title's insignia.
  ctx.save();
  ctx.translate(C.STAGE_CX, 164);
  ctx.rotate(Math.PI / 4);
  ctx.strokeStyle = "#57756a";
  ctx.lineWidth = 1;
  ctx.strokeRect(-60, -60, 120, 120);
  ctx.strokeRect(-70, -70, 140, 140);
  ctx.restore();
  for (let i = 0; i < 7; i++) {
    const a = (i * Math.PI * 2) / 7 - Math.PI / 2;
    sprite(
      ctx,
      s,
      `${C.GEM_KINDS[i]}-0`,
      C.STAGE_CX + Math.cos(a) * 92,
      164 + Math.sin(a) * 66,
      38,
    );
  }
  sprite(
    ctx,
    s,
    `prism-turn/${Math.floor(s.simTime * 7) % 12}`,
    C.STAGE_CX,
    164,
    82,
  );
  text(ctx, C.TITLE_TEXT, C.STAGE_CX, 327, 104, INK, "center", true);
  spaced(ctx, C.TAGLINE_TEXT, C.STAGE_CX, 364, 13, GOLD, 4.5, "center");
  line(ctx, 470, 389, 610, 389, "#567167");
  diamond(ctx, 640, 389, 4);
  line(ctx, 670, 389, 810, 389, "#567167");
  for (const [i, t] of targets(s).entries())
    button(ctx, C.TITLE_ITEMS[i]!, t, s.menuIndex === i);
  text(
    ctx,
    "Seven stones. One beautiful chain reaction.",
    C.STAGE_CX,
    620,
    17,
    DIM,
    "center",
    true,
  );
  spaced(
    ctx,
    "DRAG TO SWAP  /  ARROWS + ENTER TO CHOOSE",
    C.STAGE_CX,
    651,
    10,
    DIM,
    2,
    "center",
  );
  spaced(ctx, "01 / FACET", 64, 65, 10, DIM, 2);
}
function board(ctx: Ctx, s: State) {
  ctx.save();
  ctx.shadowColor = "#000a";
  ctx.shadowBlur = 28;
  ctx.shadowOffsetY = 9;
  sprite(ctx, s, "board-frame", C.BOARD_CX, C.BOARD_CY, 608);
  ctx.restore();
  const shatter = s.lastWaves * C.WAVE_SECONDS;
  const resolving = s.phase === "resolving";
  const age = s.stepTimer;
  ctx.save();
  ctx.beginPath();
  ctx.rect(352, 108, 576, 576);
  ctx.clip();
  if (resolving && age < shatter && s.motion?.before) {
    for (const g of s.motion.before.cells) {
      const cleared = s.motion.cleared?.find((c) => same(c.gem, g));
      if (!cleared || age < cleared.wave * C.WAVE_SECONDS)
        gem(ctx, s, g, cellX(g.col), cellY(g.row));
    }
  } else
    for (const g of s.board.cells) {
      let x = cellX(g.col),
        y = cellY(g.row);
      const swap = s.motion?.swap;
      if (s.phase === "swapping" && swap) {
        const other = same(g, swap[0])
          ? swap[1]
          : same(g, swap[1])
            ? swap[0]
            : undefined;
        if (other) {
          const t = Math.min(1, s.swapTimer / C.SWAP_SECONDS),
            e = t * t * (3 - 2 * t);
          x = cellX(other.col) + (x - cellX(other.col)) * e;
          y = cellY(other.row) + (y - cellY(other.row)) * e;
        }
      } else if (resolving && g.fell) {
        const t = Math.min(
          1,
          Math.max(0, (age - shatter) / (g.fell * C.FALL_SECONDS_PER_ROW)),
        );
        y -= g.fell * C.CELL_PITCH * (1 - t * t);
      } else if (s.motion?.dealAge !== undefined && g.fell) {
        const t = Math.min(
          1,
          s.motion.dealAge / (g.fell * C.FALL_SECONDS_PER_ROW + 0.15),
        );
        y -= g.fell * C.CELL_PITCH * (1 - t * t);
      }
      if (s.selection && s.offer) {
        if (same(g, s.selection)) {
          x = cellX(s.offer.col);
          y = cellY(s.offer.row);
        } else if (same(g, s.offer)) {
          x = cellX(s.selection.col);
          y = cellY(s.selection.row);
        }
      }
      gem(ctx, s, g, x, y);
    }
  if (resolving)
    for (const { gem: g, wave } of s.motion?.cleared ?? []) {
      const elapsed = age - wave * C.WAVE_SECONDS;
      if (elapsed >= 0 && elapsed < 0.48) {
        if (g.kind && elapsed < 0.24)
          sprite(
            ctx,
            s,
            `break/${g.kind}/${Math.min(5, Math.floor(elapsed / 0.04))}`,
            cellX(g.col),
            cellY(g.row),
          );
        particles(
          ctx,
          s,
          g.strain === C.MAX_STRAIN ? "flawed" : "clear",
          cellX(g.col),
          cellY(g.row),
          elapsed,
          g.col + g.row * 37 + Math.floor(s.score),
        );
      }
    }
  if (resolving)
    for (const p of s.motion?.created ?? []) {
      const g = s.board.cells[p.row * C.GRID_COLS + p.col];
      particles(
        ctx,
        s,
        "cut",
        cellX(p.col),
        cellY(p.row),
        age - shatter - (g?.fell ?? 0) * C.FALL_SECONDS_PER_ROW,
        p.col + p.row * 47,
      );
    }
  ctx.restore();
  function mark(p: CellRef, color: string) {
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(cellX(p.col) - 33, cellY(p.row) - 33, 66, 66, 8);
    ctx.stroke();
    for (const dx of [-1, 1])
      for (const dy of [-1, 1])
        diamond(ctx, cellX(p.col) + dx * 33, cellY(p.row) + dy * 33, 2, color);
  }
  if (s.selection) mark(s.selection, GOLD);
  if (s.offer) mark(s.offer, TEAL);
  if (s.refusal) {
    mark(s.refusal.a, "#f1918b");
    mark(s.refusal.b, "#f1918b");
  }
}
function hud(ctx: Ctx, s: State) {
  text(ctx, C.TITLE_TEXT, 64, 92, 44, INK, "left", true);
  spaced(ctx, "PRESSURE / POSSIBILITY", 66, 116, 9, GOLD, 1.5);
  line(ctx, 64, 144, 286, 144, "#4d625b");
  spaced(ctx, C.HUD_SCORE_LABEL, 66, 189, 11, DIM, 3);
  text(ctx, s.score.toLocaleString("en-US"), 64, 237, 42, INK, "left", true);
  spaced(
    ctx,
    `${C.HUD_LEVEL_LABEL}  ${String(s.level).padStart(2, "0")}`,
    66,
    286,
    12,
    GOLD,
    3,
  );
  text(
    ctx,
    `${s.levelScore.toLocaleString("en-US")} / ${(C.LEVEL_TARGET_STEP * s.level).toLocaleString("en-US")}`,
    66,
    318,
    16,
    INK,
  );
  panel(ctx, 66, 336, 220, 5, "#0a1921", "#38504e");
  ctx.fillStyle = TEAL;
  ctx.fillRect(
    66,
    336,
    220 * Math.min(1, s.levelScore / (C.LEVEL_TARGET_STEP * s.level)),
    5,
  );
  spaced(ctx, "THE ART OF PRESSURE", 66, 407, 10, GOLD, 2);
  paragraph(
    ctx,
    "Match three. Stress the stones beside them. Let the flaws do the rest.",
    66,
    438,
    214,
    17,
    DIM,
    27,
  );
  line(ctx, 66, 536, 286, 536, "#38504e");
  text(ctx, "Hold, carry, release.", 66, 572, 20, INK, "left", true);
  paragraph(
    ctx,
    "Drag a stone onto its neighbor to offer a swap.",
    66,
    601,
    218,
    14,
    DIM,
    22,
  );
  spaced(ctx, "THE GEM BENCH", C.BOARD_CX, 64, 11, GOLD, 4, "center");
  text(ctx, "STRAIN", 990, 181, 13, GOLD);
  text(ctx, "A flaw is an opportunity.", 990, 207, 16, INK, "left", true);
  const labels = ["CLEAN", "CRACKED", "FRACTURED", "FLAWED  /  2×"];
  for (let strain = 0; strain <= C.MAX_STRAIN; strain++) {
    sprite(ctx, s, `beryl-${strain}`, 1009, 249 + strain * 58, 44);
    spaced(
      ctx,
      labels[strain]!,
      1043,
      254 + strain * 58,
      10,
      strain === C.MAX_STRAIN ? GOLD : DIM,
      1.2,
    );
  }
  line(ctx, 988, 462, 1218, 462, "#38504e");
  if (s.phase === "resolving") {
    spaced(ctx, C.HUD_CHAIN_LABEL, 990, 503, 11, TEAL, 3);
    text(
      ctx,
      `×${Math.min(s.chainStep, C.MAX_MULTIPLIER)}`,
      990,
      567,
      60,
      INK,
      "left",
      true,
    );
    text(
      ctx,
      `+${s.lastPoints}  /  ${s.lastCleared} STONES`,
      990,
      598,
      13,
      GOLD,
    );
  } else {
    spaced(ctx, "MAKE SOMETHING", 990, 506, 10, DIM, 2);
    text(ctx, "brilliant.", 990, 545, 34, INK, "left", true);
    paragraph(
      ctx,
      "Four in a line earns a cut. Five makes a prism.",
      990,
      578,
      220,
      15,
      DIM,
      24,
    );
  }
  button(
    ctx,
    C.PAUSE_LABEL,
    targets({ ...s, screen: "playing" })[0]!,
    s.armedTarget === "pause",
  );
}
function howto(ctx: Ctx, s: State) {
  spaced(ctx, "A LITTLE PRESSURE GOES A LONG WAY", 80, 69, 11, GOLD, 3);
  text(ctx, "The art of the chain.", 80, 131, 52, INK, "left", true);
  const cols = [80, 488, 896];
  const headings = [
    "01  /  FIND A LINE",
    "02  /  SPEND THE STRAIN",
    "03  /  EARN A CUT",
  ];
  const bodies = [
    [
      "Seven kinds of stone. Hold one with a mouse, pen, or finger, carry it onto a neighbor, then release to swap.",
      "Carry it back to withdraw the offer. Three or more of one kind in a line shatter. A swap that clears nothing is refused.",
      "New stones fall into the gaps. If they match again, the chain grows — and each step is worth more.",
    ],
    [
      "Every stone beside a clear gains strain. Clean becomes cracked, then fractured, then flawed.",
      "A flawed stone joins any clear it touches and scores double. Work beside worn stones to set off a beautiful reaction.",
      "Reach the level target to continue. Your round ends when no productive swap remains.",
    ],
    [
      "FOUR → BRILLIANT\nTakes the eight surrounding stones.",
      "FIVE OR MORE → PRISM\nSwap it to clear every stone of its neighbor’s kind. Two prisms clear the board.",
      "CROSSING LINES → STAR\nTakes its entire row and column.",
    ],
  ];
  for (let c = 0; c < 3; c++) {
    const x = cols[c]!;
    line(ctx, x, 162, x + 304, 162, "#567167");
    if (c < 2)
      for (let i = 0; i < 3; i++)
        sprite(
          ctx,
          s,
          `${c === 0 ? "ruby" : "beryl"}-${c === 0 ? 0 : Math.min(C.MAX_STRAIN, i + 1)}`,
          x + 36 + i * 65,
          211,
          52,
        );
    else {
      sprite(ctx, s, "jade-0", x + 36, 211, 52);
      sprite(ctx, s, "brilliant", x + 36, 211, 52);
      sprite(ctx, s, "prism-0", x + 109, 211, 52);
      sprite(ctx, s, "amethyst-0", x + 182, 211, 52);
      sprite(ctx, s, "star", x + 182, 211, 52);
    }
    spaced(ctx, headings[c]!, x, 267, 10, GOLD, 1.6);
    let y = 303;
    for (const body of bodies[c]!) {
      for (const part of body.split("\n"))
        y = paragraph(ctx, part, x, y, 304, 16, DIM, 24);
      y += 17;
    }
  }
  line(ctx, 80, 582, 1200, 582, "#567167");
  button(ctx, C.BACK_LABEL, targets(s)[0]!, s.armedTarget === "back");
  text(
    ctx,
    "↑ ↓  Choose    Enter / Space  Confirm    Esc / P  Pause",
    300,
    629,
    14,
    INK,
  );
  text(
    ctx,
    "M  Sound    Esc  Back    Mouse · Pen · Touch  Play",
    300,
    658,
    14,
    DIM,
  );
}
function overlay(ctx: Ctx, s: State) {
  ctx.fillStyle = "#06131be0";
  ctx.fillRect(0, 0, C.STAGE_W, C.STAGE_H);
  panel(ctx, 418, 168, 444, 444, "#102a32", "#8e805e");
  diamond(ctx, 640, 200, 5);
  const heading =
    s.screen === "paused"
      ? C.PAUSED_TITLE_TEXT
      : s.screen === "levelclear"
        ? C.LEVELCLEAR_TITLE_TEXT
        : C.GAMEOVER_TITLE_TEXT;
  text(
    ctx,
    heading,
    640,
    270,
    s.screen === "gameover" ? 36 : 43,
    INK,
    "center",
    true,
  );
  if (s.screen === "paused") {
    spaced(ctx, "A MOMENT TO REFLECT", 640, 320, 11, GOLD, 2.5, "center");
    text(ctx, "Your stones will wait.", 640, 361, 18, DIM, "center", true);
  } else if (s.screen === "levelclear") {
    spaced(
      ctx,
      `${C.HUD_LEVEL_LABEL} ${s.level}  /  BEAUTIFULLY DONE`,
      640,
      306,
      10,
      GOLD,
      2,
      "center",
    );
    text(
      ctx,
      `${C.BEST_CHAIN_LABEL}  ${s.bestChain}×`,
      640,
      347,
      14,
      INK,
      "center",
    );
    text(
      ctx,
      `${C.BEST_MOVE_LABEL}  ${s.bestMove.toLocaleString("en-US")}`,
      640,
      375,
      14,
      DIM,
      "center",
    );
  } else {
    spaced(
      ctx,
      `${C.HUD_LEVEL_LABEL} ${s.level}  /  FINAL ${C.HUD_SCORE_LABEL}`,
      640,
      314,
      10,
      GOLD,
      2,
      "center",
    );
    text(
      ctx,
      s.score.toLocaleString("en-US"),
      640,
      370,
      43,
      INK,
      "center",
      true,
    );
  }
  const items =
    s.screen === "paused"
      ? C.PAUSED_ITEMS
      : s.screen === "levelclear"
        ? C.LEVELCLEAR_ITEMS
        : C.GAMEOVER_ITEMS;
  for (const [i, t] of targets(s).entries())
    button(ctx, items[i]!, t, s.menuIndex === i);
}
export function render(s: State, api: RenderApi): void {
  const ctx = api.ctx;
  ctx.save();
  background(ctx);
  if (s.screen === "title") title(ctx, s);
  else if (s.screen === "howto") howto(ctx, s);
  else {
    hud(ctx, s);
    board(ctx, s);
    if (s.screen !== "playing") overlay(ctx, s);
  }
  footer(ctx, s);
  ctx.restore();
}
