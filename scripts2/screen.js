const path = require("node:path");
const { Cluster } = require('puppeteer-cluster');

const rootDir = path.resolve(__dirname, "..");
const shotsDir = path.join(rootDir, "test", "screenshots");
const port = 4173;

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

async function takeScreenshots(slugs, maxConcurrency = 4) {
    console.time('foo');

    const cluster = await Cluster.launch({
        concurrency: Cluster.CONCURRENCY_BROWSER,
        maxConcurrency,
    });

    await cluster.task(async ({ page, data: slug }) => {
        const url = new URL(`/demos/${slug}.html`, `http://127.0.0.1:${port}`).toString();

        await page.setViewport({ width: 1920, height: 600, deviceScaleFactor: 1.5 });
        await page.evaluateOnNewDocument(seededRandomScript());
        await page.goto(url);
        await page.waitForSelector(".uplot", { timeout: 5000 });
        const charts = await page.$$(".uplot");

        let i = 0;
        for (const chart of charts)
            await chart.screenshot({ path: path.join(shotsDir, `${slug}-${i++}.png`) });
    });

    slugs.forEach(slug => {
        cluster.queue(slug);
    });

    await cluster.idle();
    await cluster.close();

    console.timeEnd('foo');
}

exports.takeScreenshots = takeScreenshots;