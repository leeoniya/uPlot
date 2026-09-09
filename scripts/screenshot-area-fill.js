#!/usr/bin/env node

const path = require("node:path");
const fs = require("node:fs/promises");
const puppeteer = require("puppeteer");
const { compare } = require("odiff-bin");

const rootDir = path.resolve(__dirname, "..");
const shotsDir = path.join(rootDir, "test", "screenshots", "area-fill");
const baselinePath = path.join(shotsDir, "baseline.png");
const currentPath = path.join(shotsDir, "current.png");
const diffPath = path.join(shotsDir, "diff.png");
const port = 4173;
const pageUrl = new URL("/demos/area-fill.html", `http://127.0.0.1:${port}`).toString();
const isUpdate = process.argv.includes("--update");

const { startServer } = require('./server');

async function ensureDirs() {
  await fs.mkdir(shotsDir, { recursive: true });
}

// lcg
function seededRandomScript() {
  return `
    (() => {
      let state = 0x12345678;
      Math.random = () => {
        state = (1664525 * state + 1013904223) >>> 0;
        return state / 0x100000000;
      };
    })();
  `;
}

async function captureScreenshot() {
  const browser = await puppeteer.launch({ headless: true });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 600, deviceScaleFactor: 1 });
    await page.evaluateOnNewDocument(seededRandomScript());
    await page.goto(pageUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector(".uplot", { timeout: 5000 });
    const chart = await page.$(".uplot");

    if (chart == null) {
      throw new Error("Could not find .uplot element");
    }

    await chart.screenshot({ path: currentPath });
  } finally {
    await browser.close();
  }
}

async function run() {
  await ensureDirs();

  const server = startServer();

  try {
    await captureScreenshot();

    if (isUpdate) {
      await fs.copyFile(currentPath, baselinePath);
      console.log(`Updated baseline: ${path.relative(rootDir, baselinePath)}`);
      return;
    }

    try {
      await fs.access(baselinePath);
    } catch {
      throw new Error(
        `Missing baseline image. Run "npm run sshot:area-fill:update" first (${path.relative(rootDir, baselinePath)}).`,
      );
    }

    const result = await compare(baselinePath, currentPath, diffPath);

    if (result.match) {
      console.log("Screenshot matched baseline.");
      return;
    }

    throw new Error(
      `Screenshot mismatch (${result.reason ?? "unknown reason"}). See ${path.relative(rootDir, diffPath)}.`,
    );
  } finally {
    // server.kill("SIGTERM");

    server.close();
  }
}

run().catch((err) => {
  console.error(err.message);
  process.exitCode = 1;
});
