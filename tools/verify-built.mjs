/* global console, document */
import { chromium } from "playwright";
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname } from "node:path";
import assert from "node:assert/strict";
import { URL } from "node:url";

// Serve the real dist under a nested mount, deliberately returning 404 at the
// origin root. A root-absolute request cannot accidentally pass this check.
const prefix = "/nested/facet/";
const mime = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".png": "image/png",
  ".wav": "audio/wav",
  ".json": "application/json",
};
const server = createServer(async (req, res) => {
  try {
    const path = new URL(req.url, "http://localhost").pathname;
    if (!path.startsWith(prefix) || path.includes(".."))
      throw new Error("outside mount");
    const file = path.slice(prefix.length) || "index.html";
    res.setHeader(
      "Content-Type",
      mime[extname(file)] ?? "application/octet-stream",
    );
    res.end(await readFile(new URL(`../dist/${file}`, import.meta.url)));
  } catch {
    res.writeHead(404);
    res.end();
  }
});
await new Promise((resolve) => server.listen(4187, "127.0.0.1", resolve));
const browser = await chromium.launch({ args: ["--no-sandbox"] });
try {
  for (const mobile of [false, true]) {
    const viewport = mobile
      ? { width: 390, height: 844 }
      : { width: 1280, height: 720 };
    const page = await browser.newPage({
      viewport,
      hasTouch: mobile,
      deviceScaleFactor: mobile ? 2 : 1,
    });
    const errors = [],
      paths = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("response", (r) => {
      if (r.status() >= 400) errors.push(`${r.status()} ${r.url()}`);
      else paths.push(new URL(r.url()).pathname);
    });
    page.on("requestfailed", (r) => errors.push(r.url()));
    await page.goto(`http://127.0.0.1:4187${prefix}`);
    await page.waitForFunction(
      () => document.querySelector("canvas").width > 0,
    );
    await page.waitForTimeout(700);
    const scale = Math.min(viewport.width / 1280, viewport.height / 720);
    const point = (x, y) => [
      (viewport.width - 1280 * scale) / 2 + x * scale,
      (viewport.height - 720 * scale) / 2 + y * scale,
    ];
    const take = async (x, y) =>
      mobile
        ? page.touchscreen.tap(...point(x, y))
        : page.mouse.click(...point(x, y));
    await take(640, 536); // How to play
    await page.waitForTimeout(80);
    await take(160, 642); // Back
    await take(640, 450); // Fresh round
    await page.waitForTimeout(800);
    await take(1152, 72); // Pause
    await page.waitForTimeout(80);
    await take(640, 450); // Resume
    await page.keyboard.press("KeyM");
    await page.waitForTimeout(100);
    await page.screenshot({
      path: `/tmp/opencode/built-${mobile ? "touch" : "desktop"}.png`,
    });
    assert.deepEqual(errors, []);
    assert.equal(paths.filter((p) => p.endsWith(".png")).length, 89);
    assert.equal(paths.filter((p) => p.endsWith(".wav")).length, 19);
    assert.equal(paths.filter((p) => p.endsWith(".json")).length, 4);
    assert(paths.every((p) => p.startsWith(prefix)));
    console.log(
      `${mobile ? "390×844 touch, DPR 2" : "1280×720 desktop"}: nested static build loads all 112 assets; pointer menus, pause, resume and mute exercised without browser errors.`,
    );
    await page.close();
  }
} finally {
  await browser.close();
  server.close();
}
