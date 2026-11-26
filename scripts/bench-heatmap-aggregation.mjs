import { aggregateHeatmap } from '../demos/lib/heatmapAggregation.js';
import { generatePoints } from '../demos/lib/heatmapSamples.js';

const usage = 'Usage: node scripts/bench-heatmap-aggregation.mjs [distribution=clusters] [nx=128] [ny=128]';
const args = process.argv.slice(2);
if (args.includes('--help')) {
	console.log(usage);
	process.exit(0);
}

const [distribution = 'clusters', x = '128', y = '128'] = args;
const nx = Number(x), ny = Number(y);
if (args.length > 3 || !Number.isInteger(nx) || nx < 1 || !Number.isInteger(ny) || ny < 1 || nx * ny > 2 ** 24) {
	console.error(usage + '\nnx and ny must be positive integers with nx * ny <= 2**24.');
	process.exit(1);
}

const [xs, ys] = generatePoints(distribution);
const run = () => aggregateHeatmap(xs, ys, nx, ny);
const {data, scratchBytes} = run(); // Untimed warm-up.
const times = [];
for (let i = 0; i < 6; i++) {
	const start = performance.now();
	run();
	times.push(performance.now() - start);
}
times.sort((a, b) => a - b);
console.log(`${distribution}: ${xs.length} points, ${nx} x ${ny} bins`);
console.table([{
	medianMs: (times[2] + times[3]) / 2,
	scratchBytes,
	outputBytes: data[1].reduce((sum, col) => sum + col.byteLength, 0),
	occupied: data[1][0].length,
}]);
