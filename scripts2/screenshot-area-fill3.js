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
// const port = 4173;
// const pageUrl = new URL("/demos/area-fill.html", `http://127.0.0.1:${port}`).toString();
const isUpdate = process.argv.includes("--update");

const { startServer } = require('./server');

const { takeScreenshots } = require('./screen');

async function ensureDirs() {
  await fs.mkdir(shotsDir, { recursive: true });
}

async function run() {
  await ensureDirs();

  const server = startServer();

  try {
    const slugs = [
      "area-fill",
      "dependent-scale",
      "path-gap-clip",
      "arcsinh-scales",
      "bars-values-autosize",
      "scales-dir-ori",
      "timeline-discrete",
      "thin-bars-stroke-fill",
      "latency-heatmap",
      "line-paths",
      "gradients",
      "stacked-series",
      "bars-grouped-stacked",
      "custom-scales",
    ];

    await takeScreenshots(slugs, 4);

    if (isUpdate) {
      // await fs.copyFile(currentPath, baselinePath);
      // console.log(`Updated baseline: ${path.relative(rootDir, baselinePath)}`);
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
