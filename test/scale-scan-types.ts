// Compile-only regression: tsc --strict --noEmit --target es2020 --module commonjs test/scale-scan-types.ts
import uPlot = require('../dist/uPlot');

declare const u: uPlot;

type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
type Assert<T extends true> = T;

const full: uPlot.Range.MinMax = uPlot.scan(u, 'y');
const windowed: uPlot.Range.MinMax = uPlot.scan(u, 'y', 0, 10);
const nullIndices: uPlot.Range.MinMax = uPlot.scan(u, 'y', null, null);
const omittedStart: uPlot.Range.MinMax = uPlot.scan(u, 'y', undefined, 10, false);
const cached: uPlot.Range.MinMax = uPlot.scan(u, 'y', null, undefined, true);

const enabled: uPlot.Scale.Scan = true;
const disabled: uPlot.Scale.Scan = false;
const empty: uPlot.Scale.Scan = () => [null, null];
const pureHelper: uPlot.Scale.Scan = uPlot.scan;

const opts: uPlot.Options = {
	width: 400,
	height: 300,
	series: [
		{ scan: false },
		{ scan: true },
		{ auto: false },
		{ auto: true },
		{ scan: false, auto: true },
		{ scan: true, auto: false },
	],
	scales: {
		x: { time: false },
		y: {
			auto: false,
			scan: (self, scaleKey, i0, i1) => {
				type Self = Assert<Equal<typeof self, uPlot>>;
				type Key = Assert<Equal<typeof scaleKey, string>>;
				type Start = Assert<Equal<typeof i0, number | null | undefined>>;
				type End = Assert<Equal<typeof i1, number | null | undefined>>;
				return uPlot.scan(self, scaleKey, i0, i1, true);
			},
		},
		backend: {
			auto: true,
			scan: false,
			range: (self, min, max, scaleKey) => {
				type Min = Assert<Equal<typeof min, number | null>>;
				type Max = Assert<Equal<typeof max, number | null>>;
				return [min ?? 0, max ?? 100];
			},
		},
		fullDomain: {
			scan: (self, scaleKey) => uPlot.scan(self, scaleKey, null, null, true),
		},
	},
};

type SeriesScan = Assert<Equal<uPlot.Series['scan'], boolean | undefined>>;
type SeriesAuto = Assert<Equal<uPlot.Series['auto'], boolean | undefined>>;
type FacetScan = Assert<Equal<uPlot.Series.Facet['scan'], boolean | undefined>>;
type FacetAuto = Assert<Equal<uPlot.Series.Facet['auto'], boolean | undefined>>;

const facetOptions: uPlot.Series.Facet[] = [
	{ scale: 'x' },
	{ scale: 'y', scan: true },
	{ scale: 'y', scan: false },
	{ scale: 'y', auto: true },
	{ scale: 'y', auto: false },
	{ scale: 'y', scan: false, auto: true },
	{ scale: 'y', scan: true, auto: false },
];

const mode2: uPlot.Options = {
	width: 400,
	height: 300,
	mode: 2,
	series: [{}, { scan: true, auto: false, facets: facetOptions }],
};

u.addSeries({ scan: false });
u.addSeries({ auto: false });
u.addSeries({ scan: true, auto: false, facets: facetOptions });

const custom: uPlot.Scale.Scan = self => {
	const bounds: uPlot.Range.MinMax = [10, 20];
	[self.series[1].min, self.series[1].max] = bounds;
	return bounds;
};

const faceted: uPlot.Scale.Scan = self => {
	const facet = self.series[1].facets![1];
	const bounds: uPlot.Range.MinMax = [null, null];
	[facet.min, facet.max] = bounds;
	[self.series[1].min, self.series[1].max] = bounds;
	return bounds;
};

u.setScale('y', { min: 0, max: 100 });
u.setScale('y', { min: null, max: null });
u.setScale('y', { min: 0, max: null });
u.setScale('y', { min: null, max: 100 });

// @ts-expect-error Series participation is boolean, not a scale scan callback.
const seriesCallback: uPlot.Series = { scan: () => [0, 1] };
// @ts-expect-error Series participation cannot be numeric.
const seriesNumber: uPlot.Series = { scan: 1 };
// @ts-expect-error Series participation cannot be a string.
u.addSeries({ scan: 'false' });
// @ts-expect-error The deprecated series alias still requires a boolean.
const seriesAutoCallback: uPlot.Series = { auto: () => true };
// @ts-expect-error The deprecated series alias cannot be numeric.
const seriesAutoNumber: uPlot.Series = { auto: 0 };
// @ts-expect-error Facet participation is boolean, not a scale scan callback.
const facetCallback: uPlot.Series.Facet = { scale: 'y', scan: () => [0, 1] };
// @ts-expect-error Facet participation cannot be numeric.
const facetNumber: uPlot.Series.Facet = { scale: 'y', scan: 1 };
// @ts-expect-error Facet participation cannot be a string.
const facetString: uPlot.Series.Facet = { scale: 'y', scan: 'false' };
// @ts-expect-error The deprecated facet alias still requires a boolean.
const facetAutoCallback: uPlot.Series.Facet = { scale: 'y', auto: () => true };
// @ts-expect-error The deprecated facet alias cannot be a string.
const facetAutoString: uPlot.Series.Facet = { scale: 'y', auto: 'true' };

// @ts-expect-error Scan callbacks return aggregate extrema, not an enable/disable flag.
const booleanCallback: uPlot.Scale.Scan = () => true;
// @ts-expect-error Per-series arrays are not the scan callback contract.
const perSeries: uPlot.Scale.Scan = () => [[0, 1], null];
// @ts-expect-error Index arguments are numeric or nullish.
uPlot.scan(u, 'y', '0');
// @ts-expect-error Cache opt-in is a boolean.
uPlot.scan(u, 'y', null, null, 'true');
// @ts-expect-error A scan callback does not expose the internal viaAutoScaleX argument.
const internalArgument: uPlot.Scale.Scan = (self: uPlot, key: string, i0: number | null | undefined, i1: number | null | undefined, viaAutoScaleX: boolean): uPlot.Range.MinMax => [null, null];
// @ts-expect-error Range inputs can be null when scanning is disabled or has no data.
const nonNullableRange: uPlot.Range.Function = (self: uPlot, min: number, max: number) => [min, max];
