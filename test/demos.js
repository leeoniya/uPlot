const { Console } = require("console");
const { promises: fs } = require("fs");
const { JSDOM, VirtualConsole } = require("jsdom");
const PNG = require("pngjs").PNG;
const pixelmatch = require("pixelmatch");
const { Transform } = require("stream");
require("canvas-5-polyfill");

const rootDir = `${__dirname}/..`;
const snapshotDir = `${__dirname}/snapshots`;
const diffDir = `${__dirname}/diffs`;
const demosDir = `${rootDir}/demos`;
const { mkdir, readdir, readFile, writeFile } = fs;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const transform = (linePrefix) =>
	new Transform({
		transform(chunk, _encoding, callback) {
			let data = Buffer.isBuffer(chunk) ? chunk.toString() : chunk;
			if (!this._started || this._prefixNext) {
				data = linePrefix + data;
				this._started = true;
				this._prefixNext = false;
			}

			if (data.endsWith("\n")) {
				data =
					data.slice(0, -1).replace(/\n/g, `\n${linePrefix}`) + "\n";
				this._prefixNext = true;
			} else {
				data = data.replace(/\n/g, `\n${linePrefix}`);
			}

			callback(null, data);
		},
	});

const demoRunner = async () => {
	const fetchPonyfill = await readFile(
		require.resolve("unfetch/polyfill"),
		"utf8"
	);

	return async (demo) => {
		const stdout = transform(demo + " ");
		const stderr = transform(demo + " ");
		try {
			stdout.pipe(process.stdout);
			stderr.pipe(process.stderr);
			const virtualConsole = new VirtualConsole();
			virtualConsole.sendTo(new Console({ stdout, stderr }));
			const dom = await JSDOM.fromFile(`${demosDir}/${demo}`, {
				pretendToBeVisual: true,
				resources: "usable",
				runScripts: "dangerously",
				virtualConsole,
				beforeParse(window) {
					window.Path2D = Path2D;
					window.eval(fetchPonyfill);
				},
			});
			await delay(1000);
			const canvases = dom.window.document.querySelectorAll("canvas");
			const images = await Promise.all(
				Array.from(canvases).map(async (canvas, i) => {
					const blob = await new Promise((resolve) =>
						canvas.toBlob(resolve, "image/png")
					);
					const arrayBuffer = await new Promise((resolve) => {
						const reader = new dom.window.FileReader();
						reader.onloadend = () => {
							resolve(reader.result);
						};
						reader.readAsArrayBuffer(blob);
					});
					return Buffer.from(new Uint8Array(arrayBuffer));
				})
			);
			dom.window.close();
			return images;
		} finally {
			stdout.end();
			stdout.unpipe();
			stderr.end();
			stderr.unpipe();
		}
	};
};

const loadSnapshot = async (demo, canvasIndex) =>
	await readFile(
		`${snapshotDir}/${demo.replace(/\.html$/, "")}.${canvasIndex}.png`
	);

const saveSnapshot = async (demo, canvasIndex, buffer) => {
	await mkdir(snapshotDir, { recursive: true });
	await writeFile(
		`${snapshotDir}/${demo.replace(/\.html$/, "")}.${canvasIndex}.png`,
		buffer
	);
};

const saveDiff = async (demo, canvasIndex, buffer) => {
	await mkdir(diffDir, { recursive: true });
	await writeFile(
		`${diffDir}/${demo.replace(/\.html$/, "")}.${canvasIndex}.png`,
		buffer
	);
};

const main = async () => {
	const updateSnapshots = process.argv[2] === "-u";

	const runDemo = await demoRunner();
	const demos = (await readdir(demosDir)).filter(
		(entry) => entry.endsWith(".html") && entry !== "index.html"
	);
	for (const demo of demos) {
		console.log(demo);
		try {
			const images = await runDemo(demo);
			for (let i = 0; i < images.length; i++) {
				if (updateSnapshots) {
					await saveSnapshot(demo, i, images[i]);
				} else {
					const snapshot = await loadSnapshot(demo, i);
					const img1 = PNG.sync.read(snapshot);
					const img2 = PNG.sync.read(images[i]);
					const { width, height } = img1;
					const diff = new PNG({ width, height });
					const mismatch = pixelmatch(
						img1.data,
						img2.data,
						diff.data,
						width,
						height,
						{
							threshold: 0.1,
						}
					);
					if (mismatch > 0) {
						await saveDiff(demo, i, PNG.sync.write(diff));
						console.error(
							`${demo} ${i}. canvas does not match snapshot. ${mismatch} different pixels. Diff saved. Run with "-u" to update snapshot.`
						);
						process.exitCode = 1;
					}
				}
			}
		} catch (err) {
			console.error(err);
			process.exitCode = 1;
		}
	}
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
