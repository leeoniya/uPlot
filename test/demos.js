const { promises: fs } = require("fs");
const { JSDOM } = require("jsdom");
const PNG = require("pngjs").PNG;
const pixelmatch = require("pixelmatch");
require("canvas-5-polyfill");

const rootDir = `${__dirname}/..`;
const snapshotDir = `${__dirname}/snapshots`;
const diffDir = `${__dirname}/diffs`;
const demosDir = `${rootDir}/demos`;
const { mkdir, readdir, readFile, writeFile } = fs;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const canvasToPngConverter = (FileReader) => async (canvas) => {
	const blob = await new Promise((resolve) =>
		canvas.toBlob(resolve, "image/png")
	);
	const arrayBuffer = await new Promise((resolve) => {
		const reader = new FileReader();
		reader.onloadend = () => {
			resolve(reader.result);
		};
		reader.readAsArrayBuffer(blob);
	});
	return Buffer.from(new Uint8Array(arrayBuffer));
};

const demoRunner = async () => {
	const fetchPolyfill = await readFile(
		require.resolve("unfetch/polyfill"),
		"utf8"
	);

	return async (demo) => {
		const dom = await JSDOM.fromFile(`${demosDir}/${demo}`, {
			pretendToBeVisual: true,
			resources: "usable",
			runScripts: "dangerously",
			beforeParse(window) {
				window.Path2D = Path2D;
				window.eval(fetchPolyfill);
			},
		});
		await delay(500);
		const canvases = dom.window.document.querySelectorAll("canvas");
		const convertToPng = canvasToPngConverter(dom.window.FileReader);
		const buffers = await Promise.all(
			Array.from(canvases).map(convertToPng)
		);
		dom.window.close();
		return buffers;
	};
};

const loadSnapshot = async (demoFile, canvasIndex) =>
	await readFile(
		`${snapshotDir}/${demoFile.replace(/\.html$/, `.${canvasIndex}.png`)}`
	);

const saveSnapshot = async (demoFile, canvasIndex, buffer) => {
	await mkdir(snapshotDir, { recursive: true });
	await writeFile(
		`${snapshotDir}/${demoFile.replace(/\.html$/, `.${canvasIndex}.png`)}`,
		buffer
	);
};

const generateDiff = (buffer1, buffer2) => {
	const img1 = PNG.sync.read(buffer1);
	const img2 = PNG.sync.read(buffer2);
	const { width, height } = img1;
	const diff = new PNG({ width, height });
	const differentPixels = pixelmatch(
		img1.data,
		img2.data,
		diff.data,
		width,
		height,
		{
			threshold: 0.1,
		}
	);
	if (differentPixels > 0) {
		return {
			differentPixels,
			buffer: PNG.sync.write(diff),
		};
	}
};

const saveDiff = async (demoFile, canvasIndex, buffer) => {
	await mkdir(diffDir, { recursive: true });
	await writeFile(
		`${diffDir}/${demoFile.replace(/\.html$/, `.${canvasIndex}.png`)}`,
		buffer
	);
};

const main = async () => {
	const isUpdateSnapshotMode = process.argv[2] === "-u";

	const runDemo = await demoRunner();
	const demoFiles = (await readdir(demosDir)).filter(
		(entry) => entry.endsWith(".html") && entry !== "index.html"
	);
	for (const demoFile of demoFiles) {
		console.group(demoFile);
		try {
			const images = await runDemo(demoFile);
			for (let i = 0; i < images.length; i++) {
				if (isUpdateSnapshotMode) {
					await saveSnapshot(demoFile, i, images[i]);
				} else {
					const snapshot = await loadSnapshot(demoFile, i);
					const diff = generateDiff(snapshot, images[i]);
					if (diff) {
						await saveDiff(demoFile, i, diff.buffer);
						console.error(
							`${i}. canvas doesn't match snapshot. ${diff.differentPixels} pixels are different. Diff has been saved. Run with "-u" to update snapshot.`
						);
						process.exitCode = 1;
					}
				}
			}
		} catch (err) {
			console.error(err);
			process.exitCode = 1;
		} finally {
			console.groupEnd();
		}
	}
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
