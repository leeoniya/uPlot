#!/usr/bin/env node

const fs = require('node:fs/promises');
const path = require('node:path');
const puppeteer = require('puppeteer');
const { compare } = require('odiff-bin');

const { startServer } = require('./server.cjs');

const rootDir = path.resolve(__dirname, '../../..');
const shotsDir = path.join(rootDir, 'test', 'screenshots', 'area-fill');
const baselinePath = path.join(shotsDir, 'baseline.png');
const currentPath = path.join(shotsDir, 'current.png');
const diffPath = path.join(shotsDir, 'diff.png');
const pageUrl = 'http://127.0.0.1:4173/demos/area-fill.html';
const isUpdate = process.argv.includes('--update');

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
    await page.goto(pageUrl, { waitUntil: 'networkidle0' });
    await page.waitForSelector('.uplot', { timeout: 5000 });
    const chart = await page.$('.uplot');

    if (chart == null)
      throw new Error('Could not find .uplot element');

    await chart.screenshot({ path: currentPath });
  }
  finally {
    await browser.close();
  }
}

async function run() {
  await fs.mkdir(shotsDir, { recursive: true });

  const server = startServer();

  try {
    await captureScreenshot();

    if (isUpdate) {
      await fs.copyFile(currentPath, baselinePath);
      console.log(`Updated baseline: ${path.relative(rootDir, baselinePath)}`);
      return;
    }

    const result = await compare(baselinePath, currentPath, diffPath);

    if (!result.match)
      throw new Error(`Screenshot mismatch (${result.reason ?? 'unknown reason'}).`);
  }
  finally {
    server.close();
  }
}

run().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
