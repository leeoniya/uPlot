const { Console } = require("console");
const { promises: fs } = require("fs");
const { Transform } = require("stream");
const { JSDOM, VirtualConsole } = require("jsdom");
require("canvas-5-polyfill");

const rootDir = `${__dirname}/..`;
const snapshotDir = `${__dirname}/snapshots`;
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

const saveSnapshot = async (demo, canvasIndex, buffer) => {
	await mkdir(snapshotDir, { recursive: true });
	await writeFile(
		`${snapshotDir}/${demo.replace(/\.html$/, "")}.${canvasIndex}.png`,
		buffer
	);
};

const main = async () => {
	const runDemo = await demoRunner();
	const demos = (await readdir(demosDir)).filter(
		(entry) => entry.endsWith(".html") && entry !== "index.html"
	);
	for (const demo of demos) {
		console.log(demo);
		try {
			const images = await runDemo(demo);
			for (let i = 0; i < images.length; i++) {
				await saveSnapshot(demo, i, images[0]);
			}
		} catch (err) {
			console.error(err);
		}
	}
};

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
