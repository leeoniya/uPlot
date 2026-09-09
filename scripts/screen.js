const path = require("node:path");
const puppeteer = require("puppeteer");

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

async function takeScreenshots(browser, slug) {
    const page = await browser.newPage();
    const url = new URL(`/demos/${slug}.html`, `http://127.0.0.1:${port}`).toString();

    // console.log(url);

    try {
        await page.setViewport({ width: 1920, height: 600, deviceScaleFactor: 1.5 });
        await page.evaluateOnNewDocument(seededRandomScript());
        await page.goto(url);
        await page.waitForSelector(".uplot", { timeout: 5000 });
        const charts = await page.$$(".uplot");

        let i = 0;
        for (const chart of charts)
            await chart.screenshot({ path: path.join(shotsDir, `${slug}-${i++}.png`) });

        // console.log(`Success: ${url}`);
    } finally {
        await page.close();
    }
}

async function processWithConcurrency(slugs, fn, CONCURRENCY) {
    console.time('foo');

    const queue = [...slugs];

    async function worker() {
        const browser = await puppeteer.launch({ headless: true });

        while (queue.length > 0) {
            const slug = queue.shift();

            try {
                await fn(browser, slug);
            } catch (error) {
                console.error(`Failed: ${slug}`, error);
            }
        }

        await browser.close();
    }

    const workers = Array(CONCURRENCY).fill(null).map(() => worker());

    await Promise.all(workers);

    console.timeEnd('foo');
}

exports.takeScreenshots = takeScreenshots;
exports.processWithConcurrency = processWithConcurrency;