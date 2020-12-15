declare class uPlot {
	/** when passing a function for @targ, call init() after attaching self.root to the DOM */
	constructor(
		opts: Options,
		data?: Data,
		targ?: HTMLElement | ((self: uPlot, init: Function) => void)
	);

	/** chart container */
	readonly root: HTMLElement;

	/** status */
	readonly status: 0 | 1;

	/** width of the plotting area + axes in CSS pixels */
	readonly width: number;

	/** height of the plotting area + axes in CSS pixels (excludes title & legend height) */
	readonly height: number;

	/** context of canvas used for plotting area + axes */
	readonly ctx: CanvasRenderingContext2D;

	/** coords of plotting area in canvas pixels (relative to full canvas w/axes) */
	readonly bbox: BBox;

	/** coords of selected region in CSS pixels (relative to plotting area) */
	readonly select: BBox;

	/** cursor state & opts*/
	readonly cursor: Cursor;

//	/** focus opts */
//	readonly focus: Focus;

	/** series state & opts */
	readonly series: Series[];

	/** scales state & opts */
	readonly scales: {
		[key: string]: Scale;
	};

	/** axes state & opts */
	readonly axes: Axis[];

	/** hooks, including any added by plugins */
	readonly hooks: Hooks.Arrays;

	/** current data */
	readonly data: AlignedData;


	/** clears and redraws the canvas. if rebuildPaths = false, uses cached series' Path2D objects */
	redraw(rebuildPaths?: boolean): void;

	/** defers recalc & redraw for multiple ops, e.g. setScale('x', ...) && setScale('y', ...) */
	batch(txn: Function): void;

	/** destroys DOM, removes resize & scroll listeners, etc. */
	destroy(): void;

	/** sets the chart data & redraws. (default resetScales = true) */
	setData(data: Data, resetScales?: boolean): void;

	/** sets the limits of a scale & redraws (used for zooming) */
	setScale(scaleKey: string, limits: { min: number; max: number }): void;

	/** sets the cursor position (relative to plotting area) */
	setCursor(opts: {left: number, top: number}): void;

	// TODO: include other series style opts which are dynamically pulled?
	/** toggles series visibility or focus */
	setSeries(seriesIdx: number, opts: {show?: boolean, focus?: boolean}): void;

	/** adds a series */
	addSeries(opts: Series, seriesIdx?: number): void;

	/** deletes a series */
	delSeries(seriesIdx: number): void;

	/** sets visually selected region without triggering setScale (zoom). (default fireHook = true) */
	setSelect(opts: {left: number, top: number, width: number, height: number}, fireHook?: boolean): void;

	/** sets the width & height of the plotting area + axes (excludes title & legend height) */
	setSize(opts: { width: number; height: number }): void;

	/** converts a CSS pixel position (relative to plotting area) to the closest data index */
	posToIdx(left: number): number;

	/** converts a CSS pixel position (relative to plotting area) to a value along the given scale */
	posToVal(leftTop: number, scaleKey: string): number;

	/** converts a value along the given scale to a CSS (default) or canvas pixel position. (default canvasPixels = false) */
	valToPos(val: number, scaleKey: string, canvasPixels?: boolean): number;

	/** converts a value along x to the closest data index */
	valToIdx(val: number): number;

	/** updates getBoundingClientRect() cache for cursor positioning. use when plot's position changes (excluding window scroll & resize) */
	syncRect(): void;

	/** uPlot's default line path builder (handles nulls/gaps & data decimation) */
	static paths: Series.PathBuilderFactories;

	/** a deep merge util fn */
	static assign(targ: object, ...srcs: object[]): object;

	/** re-ranges a given min/max by a multiple of the range's magnitude (used internally to expand/snap/pad numeric y scales) */
	static rangeNum: ((min: number, max: number, mult: number, extra: boolean) => Range.MinMax) | ((min: number, max: number, cfg: Range.Config) => Range.MinMax);

	/** re-ranges a given min/max outwards to nearest 10% of given min/max's magnitudes, unless fullMags = true */
	static rangeLog(min: number, max: number, base: Scale.LogBase, fullMags: boolean): Range.MinMax;

	/** default numeric formatter using browser's locale: new Intl.NumberFormat(navigator.language).format */
	static fmtNum(val: number): string;

	/** creates an efficient formatter for Date objects from a template string, e.g. {YYYY}-{MM}-{DD} */
	static fmtDate(tpl: string, names?: DateNames): (date: Date) => string;

	/** converts a Date into new Date that's time-adjusted for the given IANA Time Zone Name */
	static tzDate(date: Date, tzName: string): Date;

	/** outerJoins multiple data tables on table[0] values */
	static join(tables: AlignedData[], nullModes?: JoinNullMode[][]): AlignedDataWithGapTest;

	static addGap: Series.AddGap;

	static clipGaps: Series.ClipPathBuilder;
}

export const enum JoinNullMode {
	/** use for series with spanGaps = true */
	Ignore = 0,
	/** default */
	Gaps   = 1,
	/** expand explicit null gaps to include adjacent alignment nulls */
	Expand = 2,
}

export const enum Orientation {
	Horizontal = 0,
	Vertical   = 1,
}

export type AlignedData = [
	xValues: number[],
	...yValues: (number | null)[][],
]

export interface AlignedDataWithGapTest {
	data: AlignedData | null,
	isGap: Series.isGap,
}

export type Data = AlignedData | AlignedDataWithGapTest;

export interface DateNames {
	/** long month names */
	MMMM: string[];

	/** short month names */
	MMM:  string[];

	/** long weekday names (0: Sunday) */
	WWWW: string[];

	/** short weekday names (0: Sun) */
	WWW:  string[];
}

export namespace Range {
	export type MinMax = [min: number, max: number];

	export type Function = (self: uPlot, initMin: number, initMax: number, scaleKey: string) => MinMax;

	export const enum SoftMode {
		Off    = 0,
		Always = 1,
		Near   = 2,
	}

	export interface Limit {
		/** initial multiplier for dataMax-dataMin delta */
		pad?: number; // 0.1

		/** soft limit */
		soft?: number; // 0

		/** soft mode - 0: off, 1: if data extreme falls within soft limit, 2: if data extreme & padding exceeds soft limit */
		mode?: SoftMode; // 2

		/** hard limit */
		hard?: number;
	}

	export interface Config {
		min: Range.Limit;
		max: Range.Limit;
	}
}

export interface Scales {
	[key: string]: Scale;
}

type SidesWithAxes = [top: boolean, right: boolean, bottom: boolean, left: boolean];

export type PaddingSide = number | null | ((self: uPlot, side: Axis.Side, sidesWithAxes: SidesWithAxes, cycleNum: number) => number);

export type Padding = [top: PaddingSide, right: PaddingSide, bottom: PaddingSide, left: PaddingSide];

export interface Legend {
	show?: boolean;	// true
	/** show series values at current cursor.idx */
	live?: boolean;	// true
	/** series indicator stroke */
	stroke?: Legend.Stroke;
	/** series indicator fill */
	fill?: Legend.Fill;
}

export namespace Legend {
	export type Stroke = (self: uPlot, seriesIdx: number) => Series.Stroke | null;

	export type Fill = (self: uPlot, seriesIdx: number) => Series.Fill | null;
}

export type DateFormatterFactory = (tpl: string) => (date: Date) => string;

export type LocalDateFromUnix = (ts: number) => Date;

export const enum DrawOrderKey {
	Axes   = 'axes',
	Series = 'series',
}

export interface Options {
	/** chart title */
	title?: string;

	/** id to set on chart div */
	id?: string;

	/** className to add to chart div */
	class?: string;

	/** width of plotting area + axes in CSS pixels */
	width: number;

	/** height of plotting area + axes in CSS pixels (excludes title & legend height) */
	height: number;

	/** data for chart, if none is provided as argument to constructor */
	data?: AlignedData,

	/** converts a unix timestamp to Date that's time-adjusted for the desired timezone */
	tzDate?: LocalDateFromUnix;

	/** creates an efficient formatter for Date objects from a template string, e.g. {YYYY}-{MM}-{DD} */
	fmtDate?: DateFormatterFactory;

	/** timestamp multiplier that yields 1 millisecond */
	ms?: 1e-3 | 1; // 1e-3

	/** drawing order for axes/grid & series (default: ["axes", "series"]) */
	drawOrder?: DrawOrderKey[];

	series: Series[];

	scales?: Scales;

	axes?: Axis[];

	/** padding per side, in CSS pixels (can prevent cross-axis labels at the plotting area limits from being chopped off) */
	padding?: Padding;

	select?: Select;

	legend?: Legend;

	cursor?: Cursor;

	focus?: Focus;

	hooks?: Hooks.Arrays;

	plugins?: Plugin[];
}

export interface Focus {
	/** alpha-transparancy of de-focused series */
	alpha: number;
}

export interface BBox {
	show?: boolean;
	left: number;
	top: number;
	width: number;
	height: number;
}

interface Select extends BBox {
	/** div into which .u-select will be placed: .u-over or .u-under */
	over?: boolean; // true
}

export namespace Cursor {
	export type LeftTop              = [left: number, top: number];

	export type MouseListener        = (e: MouseEvent) => null;

	export type MouseListenerFactory = (self: uPlot, targ: HTMLElement, handler: MouseListener) => MouseListener | null;

	export type DataIdxRefiner       = (self: uPlot, seriesIdx: number, closestIdx: number, xValue: number) => number;

	export type MousePosRefiner      = (self: uPlot, mouseLeft: number, mouseTop: number) => LeftTop;

	export interface Bind {
		mousedown?:   MouseListenerFactory,
		mouseup?:     MouseListenerFactory,
		click?:       MouseListenerFactory,
		dblclick?:    MouseListenerFactory,

		mousemove?:   MouseListenerFactory,
		mouseleave?:  MouseListenerFactory,
		mouseenter?:  MouseListenerFactory,
	}

	export namespace Points {
		export type Show   = boolean | ((self: uPlot, seriesIdx: number) => HTMLElement);
		export type Size   = number  | ((self: uPlot, seriesIdx: number) => number);
		export type Width  = number  | ((self: uPlot, seriesIdx: number, size: number) => number);
		export type Stroke = CanvasRenderingContext2D['strokeStyle'] | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['strokeStyle']);
		export type Fill   = CanvasRenderingContext2D['fillStyle']   | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['fillStyle']);
	}

	export interface Points {
		show?:   Points.Show;
		/** hover point diameter in CSS pixels */
		size?:   Points.Size;
		/** hover point outline width in CSS pixels */
		width?:  Points.Width;
		/** hover point outline color, pattern or gradient */
		stroke?: Points.Stroke;
		/** hover point fill color, pattern or gradient */
		fill?:   Points.Fill;
	}

	export interface Drag {
		setScale?: boolean; // true
		/** toggles dragging along x */
		x?: boolean; // true
		/** toggles dragging along y */
		y?: boolean; // false
		/** min drag distance threshold */
		dist?: number; // 0
		/** when x & y are true, sets an upper drag limit in CSS px for adaptive/unidirectional behavior */
		uni?: number; // null
	}

	export namespace Sync {
		export type Scales = [xScaleKey: string, yScaleKey: string];
	}

	export interface Sync {
		/** sync key must match between all charts in a synced group */
		key: string;
		/** determines if series toggling and focus via cursor is synced across charts */
		setSeries?: boolean; // true
		/** sets the x and y scales to sync by values. null will sync by relative (%) position */
		scales?: Sync.Scales; // [xScaleKey, null]
	}

	export interface Focus {
		/** minimum cursor proximity to datapoint in CSS pixels for focus activation */
		prox: number;
	}
}

export interface Cursor {
	/** cursor on/off */
	show?: boolean;

	/** vertical crosshair on/off */
	x?: boolean;

	/** horizontal crosshair on/off */
	y?: boolean;

	/** cursor position left offset in CSS pixels (relative to plotting area) */
	left?: number;

	/** cursor position top offset in CSS pixels (relative to plotting area) */
	top?: number;

	/** closest data index to cursor (closestIdx) */
	idx?: number;

	/** returns data idx used for hover points & legend display (defaults to closestIdx) */
	dataIdx?: Cursor.DataIdxRefiner;

	/** fires on debounced mousemove events; returns refined [left, top] tuple to snap cursor position */
	move?: Cursor.MousePosRefiner;

	/** series hover points */
	points?: Cursor.Points;

	/** event listener proxies (can be overridden to tweak interaction behavior) */
	bind?: Cursor.Bind;

	/** determines vt/hz cursor dragging to set selection & setScale (zoom) */
	drag?: Cursor.Drag;

	/** sync cursor between multiple charts */
	sync?: Cursor.Sync;

	/** focus series closest to cursor */
	focus?: Cursor.Focus;

	/** lock cursor on mouse click in plotting area */
	lock?: boolean; // false
}

export namespace Scale {
	export type Auto = boolean | ((self: uPlot, resetScales: boolean) => boolean);

	export type Range = Range.MinMax | Range.Function | Range.Config;

	export const enum Distr {
		Linear      = 1,
		Ordinal     = 2,
		Logarithmic = 3,
	}

	export type LogBase = 10 | 2;

	export type Clamp = number | ((self: uPlot, val: number, scaleMin: number, scaleMax: number, scaleKey: string) => number);
}

export interface Scale {
	/** is this scale temporal, with series' data in UNIX timestamps? */
	time?: boolean;

	/** determines whether all series' data on this scale will be scanned to find the full min/max range */
	auto?: Scale.Auto;

	/** can define a static scale range or re-range an initially-determined range from series data */
	range?: Scale.Range;

	/** scale key from which this scale is derived */
	from?: string,

	/** scale distribution. 1: linear, 2: ordinal, 3: logarithmic */
	distr?: Scale.Distr;

	/** logarithmic base */
	log?: Scale.LogBase; // 10;

	/** clamps log scale values <= 0 (default = scaleMin / 10) */
	clamp?: Scale.Clamp;

	/** current min scale value */
	min?: number,

	/** current max scale value */
	max?: number,
}

export namespace Series {
	export type isGap = (self: uPlot, seriesIdx: number, idx: number) => boolean;

	export interface Paths {
		/** path to stroke */
		stroke?: Path2D | null;

		/** path to fill */
		fill?: Path2D | null;

		/** path for clipping fill & stroke */
		clip?: Path2D | null;
	}

	export type LinearPathBuilderFactory  = () => Series.PathBuilder;
	export type SplinePathBuilderFactory  = () => Series.PathBuilder;
	export type SteppedPathBuilderFactory = (opts?: {align?: -1 | 1}) => Series.PathBuilder;
	export type BarsPathBuilderFactory    = (opts?: {size?: [factor?: number, max?: number]}) => Series.PathBuilder;

	export interface PathBuilderFactories {
		linear?:  LinearPathBuilderFactory;
		spline?:  SplinePathBuilderFactory;
		stepped?: SteppedPathBuilderFactory;
		bars?:    BarsPathBuilderFactory;
	}

	export type Stroke = CanvasRenderingContext2D['strokeStyle'] | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['strokeStyle']);

	export type Fill = CanvasRenderingContext2D['fillStyle'] | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['fillStyle']);

	export namespace Points {
		export type Show = boolean | ((self: uPlot, seriesIdx: number, idx0: number, idx1: number) => boolean | undefined);
	}

	export interface Points {
		/** if boolean or returns boolean, round points are drawn with defined options, else fn should draw own custom points via self.ctx */
		show?: Points.Show;

		/** diameter of point in CSS pixels */
		size?: number;

		/** minimum avg space between point centers before they're shown (default: size * 2) */
		space?: number;

		/** line width of circle outline in CSS pixels */
		width?: number;

		/** line color of circle outline (defaults to series.stroke) */
		stroke?: Stroke;

		/** fill color of circle (defaults to #fff) */
		fill?: Fill;
	}

	export type Gap = [from: number, to: number];

	export type Gaps = Gap[];

	export type AddGap = (gaps: Gaps, from: number, to: number) => void;

	export type ClipPathBuilder = (gaps: Gaps, ori: Orientation, left: number, top: number, width: number, height: number) => Path2D | null;

	export type PathBuilder = (self: uPlot, seriesIdx: number, idx0: number, idx1: number) => Paths | null;

	export type MinMaxIdxs = [minIdx: number, maxIdx: number];

	export type Value = string | ((self: uPlot, rawValue: number, seriesIdx: number, idx: number) => string | number);

	export type Values = (self: uPlot, seriesIdx: number, idx: number) => object;

	export type FillTo = number | ((self: uPlot, seriesIdx: number, dataMin: number, dataMax: number) => number);

	export const enum Sorted {
		Unsorted    =  0,
		Ascending   =  1,
		Descending  = -1,
	}
}

export interface Series {
	/** series on/off. when off, it will not affect its scale */
	show?: boolean;

	/** className to add to legend parts and cursor hover points */
	class?: string;

	/** scale key */
	scale?: string;

	/** whether this series' data is scanned during auto-ranging of its scale */
	auto?: boolean; // true

	/** if & how the data is pre-sorted (scale.auto optimization) */
	sorted?: Series.Sorted;

	/** when true, null data values will not cause line breaks */
	spanGaps?: boolean;

	/** tests a datapoint for inclusion in gap array and path clipping */
	isGap?: Series.isGap;

	/** legend label */
	label?: string;

	/** inline-legend value formatter. can be an fmtDate formatting string when scale.time: true */
	value?: Series.Value;

	/** table-legend multi-values formatter */
	values?: Series.Values;

	paths?: Series.PathBuilder;

	/** rendered datapoints */
	points?: Series.Points;

	/** any two adjacent series with band: true, are filled as a single low/high band */
	band?: boolean;

	/** line width in CSS pixels */
	width?: number;

	/** line & legend color */
	stroke?: Series.Stroke;

	/** area fill & legend color */
	fill?: Series.Fill;

	/** area fill baseline (default: 0) */
	fillTo?: Series.FillTo;

	/** line dash segment array */
	dash?: number[];					// CanvasRenderingContext2D['setLineDash'];

	/** alpha-transparancy */
	alpha?: number;

	/** current min and max data indices rendered */
	idxs?: Series.MinMaxIdxs,

	/** current min rendered value */
	min?: number,

	/** current max rendered value */
	max?: number,
}

export namespace Axis {
	/** must return an array of same length as splits, e.g. via splits.map() */
	export type Filter = (self: uPlot, splits: number[], axisIdx: number, foundSpace: number, foundIncr: number) => (number | null)[];

	export type Size = number | ((self: uPlot, values: string[], axisIdx: number, cycleNum: number) => number);

	export type Space = number | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, plotDim: number) => number);

	export type Incrs = number[] | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, fullDim: number, minSpace: number) => number[]);

	export type Splits = number[] | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, foundIncr: number, pctSpace: number) => number[]);

	export type Values = ((self: uPlot, splits: number[], axisIdx: number, foundSpace: number, foundIncr: number) => (string | number | null)[]) | (string | number | null)[][] | string;

	export const enum Side {
		Top    = 0,
		Right  = 1,
		Bottom = 2,
		Left   = 3,
	}

	export const enum Align {
		Left  = 1,
		Right = 2,
	}

	export type Rotate = number | ((self: uPlot, values: (string | number)[], axisIdx: number, foundSpace: number) => number);

	export interface Grid {
		/** on/off */
		show?: boolean; // true

		/** can filter which splits render lines. e.g splits.map(v => v % 2 == 0 ? v : null) */
		filter?: Axis.Filter;

		/** line color */
		stroke?: CanvasRenderingContext2D['strokeStyle'];

		/** line width in CSS pixels */
		width?: number;

		/** line dash array */
		dash?: number[];					// CanvasRenderingContext2D['setLineDash'];
	}

	export interface Ticks extends Grid {
		/** length of tick in CSS pixels */
		size?: number;
	}
}

export interface Axis {
	/** axis on/off */
	show?: boolean;

	/** scale key */
	scale?: string;

	/** side of chart - 0: top, 1: rgt, 2: btm, 3: lft */
	side?: Axis.Side;

	/** height of x axis or width of y axis in CSS pixels alloted for values, gap & ticks, but excluding axis label */
	size?: Axis.Size;

	/** gap between axis values and axis baseline (or ticks, if enabled) in CSS pixels */
	gap?: number;

	/** font used for axis values */
	font?: CanvasRenderingContext2D['font'];

	/** color of axis label & values */
	stroke?: CanvasRenderingContext2D['strokeStyle'];

	/** axis label text */
	label?: string;

	/** height of x axis label or width of y axis label in CSS pixels */
	labelSize?: number;

	/** font used for axis label */
	labelFont?: CanvasRenderingContext2D['font'];

	/** minimum grid & tick spacing in CSS pixels */
	space?: Axis.Space;

	/** available divisors for axis ticks, values, grid */
	incrs?: Axis.Incrs;

	/** determines how and where the axis must be split for placing ticks, values, grid */
	splits?: Axis.Splits;

	/** can filter which splits are passed to axis.values() for rendering. e.g splits.map(v => v % 2 == 0 ? v : null) */
	filter?: Axis.Filter;

	/** formats values for rendering */
	values?: Axis.Values;

	/** values rotation in degrees off horizontal (only bottom axes w/ side: 2) */
	rotate?: Axis.Rotate;

	/** text alignment of axis values - 1: left, 2: right */
	align?: Axis.Align;

	/** gridlines to draw from this axis' splits */
	grid?: Axis.Grid;

	/** ticks to draw from this axis' splits */
	ticks?: Axis.Ticks;
}

export namespace Hooks {
	export interface Defs {
		/** fires after opts are defaulted & merged but data has not been set and scales have not been ranged */
		init?:       (self: uPlot, opts: Options, data: AlignedData) => void;

		/** fires after any scale has changed */
		setScale?:   (self: uPlot, scaleKey: string) => void;

		/** fires after the cursor is moved (debounced by rAF) */
		setCursor?:  (self: uPlot) => void;

		/** fires after a selection is completed */
		setSelect?:  (self: uPlot) => void;

		/** fires after a series is toggled or focused */
		setSeries?:  (self: uPlot, seriesIdx: number, opts: Series) => void;

		/** fires after data is updated updated */
		setData?:    (self: uPlot) => void;

		/** fires after the chart is resized */
		setSize?:    (self: uPlot) => void;

		/** fires at start of every redraw */
		drawClear?:  (self: uPlot) => void;

		/** fires after all axes are drawn */
		drawAxes?:   (self: uPlot) => void;

		/** fires after each series is drawn */
		drawSeries?: (self: uPlot, seriesKey: string) => void;

		/** fires after everything is drawn */
		draw?:       (self: uPlot) => void;

		/** fires after the chart is fully initialized and in the DOM */
		ready?:      (self: uPlot) => void;

		/** fires after the chart is destroyed */
		destroy?:    (self: uPlot) => void;
	}

	export type Arrays = {
		[P in keyof Defs]: Defs[P][]
	}

	export type ArraysOrFuncs = {
		[P in keyof Defs]: Defs[P][] | Defs[P]
	}
}

export interface Plugin {
	/** can mutate provided opts as necessary */
	opts?: (self: uPlot, opts: Options) => void | Options;
	hooks: Hooks.ArraysOrFuncs;
}

export default uPlot;
