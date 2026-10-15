/* global document, console */
// Run against the local Vite development server: node tools/capture.mjs.
// The browser owns an engine handle only inside this capture's evaluation;
// neither the shipped game nor this utility publishes a window debug global.
import { chromium } from "playwright";
import { mkdir, writeFile } from "node:fs/promises";
import { gzipSync } from "node:zlib";
import { Buffer } from "node:buffer";

const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  await mkdir("showcase", { recursive: true });
  const page = await browser.newPage({
    viewport: { width: 1280, height: 720 },
  });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("response", (response) => {
    if (response.status() >= 400)
      errors.push(`${response.status()} ${response.url()}`);
  });
  await page.goto("http://localhost:5173");
  await page.waitForTimeout(900);
  await page.screenshot({ path: "showcase/title.png" });
  await page.mouse.click(640, 536);
  await page.waitForTimeout(150);
  await page.screenshot({ path: "/tmp/opencode/howto.png" });
  await page.mouse.click(160, 642);
  await page.mouse.click(640, 450);
  await page.waitForTimeout(900);
  await page.mouse.click(1152, 72);
  await page.waitForTimeout(100);
  await page.screenshot({ path: "/tmp/opencode/paused.png" });
  await page.keyboard.press("Escape");
  await page.keyboard.press("KeyM");

  const capture = await page.evaluate(async () => {
    const { createEngine, ConstantClock } =
      await import("/.vendor/engine/@clockwyrks/simple-2d/dist/index.js");
    const { game, BACKGROUND } = await import("/src/game.ts");
    const { advance } = await import("/src/model.ts");
    const old = document.querySelector("canvas");
    const canvas = document.createElement("canvas");
    canvas.style.cssText = "display:block;width:100vw;height:100vh";
    old.replaceWith(canvas);
    const engine = createEngine({
      canvas,
      width: 1280,
      height: 720,
      game,
      background: BACKGROUND,
      clock: new ConstantClock(1000 / 30),
    });
    await engine.initialize();
    const d = engine.debug;
    const rows = Array.from({ length: 8 }, (_, row) =>
      Array.from(
        { length: 8 },
        (_, col) => `${"RACJBSM"[(col + row * 2) % 7]}0`,
      ).join(" "),
    );
    engine.apply((s) => d.loadBoard(s, rows));
    engine.apply((s) => d.setScreen(s, "playing"));
    engine.apply((s) => d.setLevel(s, 3));
    engine.apply((s) => d.setScore(s, 4160));
    engine.apply((s) => d.setLevelScore(s, 1160));
    const stones = [
      [0, 3, "R0"],
      [1, 3, "R1b"],
      [2, 3, "A0"],
      [3, 3, "R0"],
      [2, 4, "R0"],
      [2, 2, "S1s"],
      [6, 6, "X0"],
      [4, 4, "J3"],
      [3, 4, "B3"],
      [4, 5, "M3"],
      [5, 5, "C3"],
      [6, 5, "A2"],
      [3, 5, "S3"],
      [3, 6, "J3"],
      [4, 6, "C3"],
      [4, 7, "M2"],
      [6, 1, "A0b"],
      [0, 7, "M2"],
    ];
    for (const [col, row, token] of stones)
      engine.apply((s) => d.setGem(s, col, row, token));
    engine.apply((s) => d.setSelection(s, 2, 4));
    await engine.advance(1);
    const boardPng = canvas.toDataURL("image/png");
    // Find a naturally cascading refill draw. The recorded move still goes
    // through the game's ordinary swap and uniformly distributed refill path.
    const originalRandom = Math.random;
    const random = (seed) => {
      let value = seed;
      return () => {
        value = (Math.imul(value, 1664525) + 1013904223) >>> 0;
        return value / 4294967296;
      };
    };
    let seed = 1;
    for (; seed < 1000; seed++) {
      Math.random = random(seed);
      const trial = advance(d.requestSwap(engine.state, 2, 4, 2, 3), 3.6);
      if (trial.bestChain >= 3) break;
    }
    Math.random = random(seed);
    engine.startRecording();
    engine.apply((s) => d.pointerDown(s, 532, 432, "mouse"));
    engine.apply((s) => d.pointerMove(s, 532, 360, "mouse"));
    await engine.advance(6);
    engine.apply((s) => d.pointerUp(s, "mouse"));
    await engine.advance(12);
    const actionPng = canvas.toDataURL("image/png");
    await engine.advance(102);
    const recording = engine.stopRecording();
    const snapshot = d.snapshot(engine.state);
    Math.random = originalRandom;
    return { recording, snapshot, boardPng, actionPng };
  });
  await writeFile(
    "showcase/chain.json.gz",
    gzipSync(JSON.stringify(capture.recording), { level: 9 }),
  );
  await writeFile(
    "showcase/board.png",
    Buffer.from(capture.boardPng.split(",")[1], "base64"),
  );
  await writeFile(
    "/tmp/opencode/action.png",
    Buffer.from(capture.actionPng.split(",")[1], "base64"),
  );
  console.log(
    JSON.stringify(
      {
        errors,
        frames: capture.recording.frames.length,
        state: {
          screen: capture.snapshot.screen,
          score: capture.snapshot.score,
          bestChain: capture.snapshot.bestChain,
          bestMove: capture.snapshot.bestMove,
        },
      },
      null,
      2,
    ),
  );
  if (errors.length) throw new Error("Browser validation failed");
} finally {
  await browser.close();
}
