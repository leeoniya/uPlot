declare class uPlot {
	/** when passing a function for @targ, call init() after attaching self.root to the DOM */
	constructor(
		opts: uPlot.Options,
		data?: uPlot.AlignedData,
		targ?: HTMLElement | ((self: uPlot, init: Function) => void)
	);

	/** unique instance id */
	readonly uid: string;

	/** chart root */
	readonly root: HTMLElement;

	/** status */
	readonly status: 0 | 1;

	/** width of the plotting area + axes in CSS pixels */
	readonly width: number;

	/** height of the plotting area + axes in CSS pixels (excludes title & legend height) */
	readonly height: number;

	/** requested devicePixelRatio */
	readonly pxRatio: number;

	/** context of canvas used for plotting area + axes. callbacks must preserve its state */
	readonly ctx: CanvasRenderingContext2D;

	/** coords of plotting area in canvas pixels (relative to full canvas w/axes) */
	readonly bbox: uPlot.BBox;

	/** cached global DOMRect of plotting area in CSS pixels */
	get rect(): DOMRect | null;

	/** coords of selected region in CSS pixels (relative to plotting area) */
	readonly select: uPlot.BBox;

	/** cursor state & opts*/
	readonly cursor: uPlot.Cursor;

	readonly legend: uPlot.Legend;

//	/** focus opts */
//	readonly focus: uPlot.Focus;

	/** series state & opts */
	readonly series: uPlot.Series[];

	/** scales state & opts */
	readonly scales: {
		[key: string]: uPlot.Scale;
	};

	/** axes state & opts */
	readonly axes: uPlot.Axis[];

	/** hooks, including any added by plugins */
	readonly hooks: uPlot.Hooks.Arrays;

	/** current data */
	readonly data: uPlot.AlignedData;

	/** .u-over dom element */
	readonly over: HTMLDivElement | null;

	/** .u-under dom element */
	readonly under: HTMLDivElement | null;

	/** clears and redraws the canvas. if rebuildPaths = false, uses cached series' Path2D objects */
	redraw(rebuildPaths?: boolean, recalcAxes?: boolean): void;

	/** batches operations synchronously, without the implicit microtask queue */
	batch(txn: Function, deferHooks?: boolean): void;

	/** destroys DOM, removes resize & scroll listeners, etc. */
	destroy(): void;

	/** sets the chart data & redraws. (default resetScales = true) */
	setData(data: uPlot.AlignedData, resetScales?: boolean): void;

	/** sets scale bounds & redraws. null bounds request auto-ranging */
	setRange(scaleKey: string, min: number | null, max: number | null): void;

	/** sets scale bounds & redraws. null bounds request auto-ranging */
	setScale(scaleKey: string, limits: { min: number | null; max: number | null }): void;

	/** sets the cursor position (relative to plotting area) */
	setCursor(opts: {left: number, top: number}, fireHook?: boolean): void;

	/** sets the legend to the values of the specified idx */
	setLegend(opts: {idx?: number, idxs?: (number | null)[]}, fireHook?: boolean): void;

	// TODO: include other series style opts which are dynamically pulled?
	/** toggles series visibility or focus */
	setSeries(seriesIdx: number | null, opts: {show?: boolean, focus?: boolean}, fireHook?: boolean): void;

	/** adds a series */
	addSeries(opts: uPlot.Series, seriesIdx?: number): void;

	/** deletes a series */
	delSeries(seriesIdx: number): void;

	/** adds a band */
	addBand(opts: uPlot.Band, bandIdx?: number): void;

	/** modifies an existing band */
	setBand(bandIdx: number, opts: uPlot.Band): void;

	/** deletes a band. if null bandIdx, clears all bands */
	delBand(bandIdx?: number | null): void;

	/** sets visually selected region without triggering setScale (zoom). (default fireHook = true) */
	setSelect(opts: {left: number, top: number, width: number, height: number}, fireHook?: boolean): void;

	/** sets the width & height of the plotting area + axes (excludes title & legend height) */
	setSize(opts: { width: number; height: number }): void;

	/** temporarily sets a user-defined devicePixelRatio that's different from window.devicePixelRatio */
	setPxRatio(pxRatio?: number | null): void;

	/** converts a CSS pixel position (relative to plotting area) to the closest data index */
	posToIdx(left: number, canvasPixels?: boolean): number;

	/** converts a CSS pixel position (relative to plotting area) to a value along the given scale */
	posToVal(leftTop: number, scaleKey: string, canvasPixels?: boolean): number;

	/** converts a value along the given scale to a CSS (default) or canvas pixel position. (default canvasPixels = false) */
	valToPos(val: number, scaleKey: string, canvasPixels?: boolean): number;

	/** converts a value along x to the closest data index */
	valToIdx(val: number): number;

	/** updates getBoundingClientRect() cache for cursor positioning. use when plot's position changes (excluding window scroll & resize) */
	syncRect(defer?: boolean): void;

	/** clears selected caches without a redraw. defaults to all categories. see docs for disposal restrictions */
	clearCache(targets?: uPlot.CacheOptions): void;


	/** uPlot's path-builder factories */
	static paths: uPlot.Series.PathBuilderFactories;

	/** a deep merge util fn */
	static assign(targ: object, ...srcs: object[]): object;

	/**
	 * returns aggregate data extrema for a scale. nullish indices use the full array bounds.
	 * cache = true reuses and populates extrema caches, regardless of the requested interval. default: false.
	 */
	static scan(self: uPlot, scaleKey: string, i0?: number | null, i1?: number | null, cache?: boolean): uPlot.Range.MinMax;

	/** expands/snaps numeric bounds with padding and optional zero affinity */
	static rangeNum(min: number, max: number, mult: number, zeroAffinity: boolean): uPlot.Range.MinMax;
	static rangeNum(min: number, max: number, cfg: uPlot.Range.Config): uPlot.Range.MinMax;

	/** re-ranges a given min/max outwards to nearest 10% of given min/max's magnitudes, unless fullMags = true */
	static rangeLog(min: number, max: number, base: uPlot.Scale.LogBase, fullMags: boolean): uPlot.Range.MinMax;

	/** re-ranges a given min/max outwards to nearest 10% of given min/max's magnitudes, unless fullMags = true */
	static rangeAsinh(min: number, max: number, base: uPlot.Scale.LogBase, fullMags: boolean): uPlot.Range.MinMax;

	/** default numeric formatter using browser's locale: new Intl.NumberFormat(navigator.language).format */
	static fmtNum(val: number): string;

	/** maximum decimal places needed for numeric splits */
	static numDec(splits: readonly (number | null)[]): number;

	/** creates an efficient formatter for Date objects from a template string, e.g. {YYYY}-{MM}-{DD} */
	static fmtDate(tpl: string, names?: uPlot.DateNames): (date: Date) => string;

	/** converts a Date or ms timestamp into new Date that's time-adjusted for the given IANA Time Zone Name */
	static tzDate(dateOrTs: Date | number, tzName: string): DateZoned;

	/** outerJoins multiple data tables on table[0] values */
	static join(tables: uPlot.AlignedData[], nullModes?: uPlot.JoinNullMode[][]): uPlot.AlignedData;

	static addGap: uPlot.Series.AddGap;

	static clipGaps: uPlot.Series.ClipPathBuilder;

	/** helper function for grabbing proper drawing orientation vars and fns for a plot instance (all dims in canvas pixels) */
	static orient(u: uPlot, seriesIdx: number, callback: uPlot.OrientCallback): any;

	/** returns a pub/sub instance shared by all plots using the provided key */
	static sync(key: string): uPlot.SyncPubSub;

	/** cached devicePixelRatio (faster than reading it from window.devicePixelRatio) */
	static pxRatio: number;
}

export default uPlot;

declare namespace uPlot {
	type OrientCallback = (
		series: Series,
		dataX: number[],
		dataY: (number | null)[],
		scaleX: Scale,
		scaleY: Scale,
		valToPosX: ValToPos,
		valToPosY: ValToPos,
		xOff: number,
		yOff: number,
		xDim: number,
		yDim: number,
		moveTo: MoveToH | MoveToV,
		lineTo: LineToH | LineToV,
		rect:   RectH   | RectV,
		arc:    ArcH    | ArcV,
		bezierCurveTo: BezierCurveToH | BezierCurveToV,
	) => any;

	type ValToPos = (val: number, scale: Scale, fullDim: number, offset: number) => number;

	type Drawable = Path2D | CanvasRenderingContext2D;

	type MoveToH        = (p: Drawable, x: number, y: number) => void;
	type MoveToV        = (p: Drawable, y: number, x: number) => void;
	type LineToH        = (p: Drawable, x: number, y: number) => void;
	type LineToV        = (p: Drawable, y: number, x: number) => void;
	type RectH          = (p: Drawable, x: number, y: number, w: number, h: number) => void;
	type RectV          = (p: Drawable, y: number, x: number, h: number, w: number) => void;
	type ArcH           = (p: Drawable, x: number, y: number, r: number, startAngle: number, endAngle: number) => void;
	type ArcV           = (p: Drawable, y: number, x: number, r: number, startAngle: number, endAngle: number) => void;
	type BezierCurveToH = (p: Drawable, bp1x: number, bp1y: number, bp2x: number, bp2y: number, p2x: number, p2y: number) => void;
	type BezierCurveToV = (p: Drawable, bp1y: number, bp1x: number, bp2y: number, bp2x: number, p2y: number, p2x: number) => void;

	export const enum JoinNullMode {
		/** use for series with spanGaps: true */
		Remove = 0,
		/** retain explicit nulls gaps (default) */
		Retain = 1,
		/** expand explicit null gaps to include adjacent alignment artifacts (undefined values) */
		Expand = 2,
	}

	export const enum Orientation {
		Horizontal = 0,
		Vertical   = 1,
	}

	export type TypedArray = Int8Array | Uint8Array | Int16Array | Uint16Array | Int32Array | Uint32Array | Uint8ClampedArray | Float32Array | Float64Array;

	export type AlignedData = TypedArray[] | [
		xValues: number[] | TypedArray,
		...yValues: ((number | null | undefined)[] | TypedArray)[],
	]

	export class DateZoned extends Date {
		tz: string;
		#utc: boolean;
		// sön, 1972-10-15 17:25:23,434 GMT+01:00
		#str: string;
		setTimeZone: (tzName: string) => void;
	}

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
		export type MinMax = [min: number | null, max: number | null];

		export type Function = (self: uPlot, initMin: number | null, initMax: number | null, scaleKey: string) => MinMax;

		export interface Limit {
			/** padding as a fraction of the data range */
			pad?: number; // 0.1

			/** soft limit */
			soft?: number;

			/** hard limit */
			hard?: number;
		}

		export interface Config {
			min?: Range.Limit;
			max?: Range.Limit;

			/** zero-affinity threshold as a fraction of the data range. 0 disables */
			zeroIf?: number; // 0.1

			/** treat tiny data ranges as flat below this threshold */
			flat?: number; // 1e-7
		}
	}

	export interface Scales {
		[key: string]: Scale;
	}


	/**
	 * Automatic padding limits in CSS pixels, with 0 <= min <= max. Infinity removes the upper limit.
	 * min reserves an outer margin. Horizontal overflow can increase the padding up to max.
	 * Top/bottom sides use min. A finite max can allow label clipping.
	 * Overflow adjustment supports default alignment (align: 0) and alignTo: 1 only.
	 * It supports unrotated multiline labels. Rotation support is limited to single-line labels on bottom axes.
	 */
	export type PaddingLimits = [min: number, max: number];

	/**
	 * Total padding in CSS pixels: a fixed number, automatic limits, or null for the default heuristic.
	 * Tuple minima reserve space before tick selection. Core then resolves horizontal overflow from the selected labels and final axis sizes.
	 * Default or null padding retains the original heuristic, even with size: 'auto'. Overflow adjustment requires explicit [min, max] tuples.
	 */
	export type PaddingSide = number | PaddingLimits | null;

	export type Padding = [top: PaddingSide, right: PaddingSide, bottom: PaddingSide, left: PaddingSide];

	export interface Legend {
		show?: boolean;	// true
		/** show series values at current cursor.idx */
		live?: boolean;	// true
		/** switches primary interaction mode to toggle-one/toggle-all */
		isolate?: boolean; // false
		/** series indicators */
		markers?: Legend.Markers;

		/** callback for moving the legend elsewhere. e.g. external DOM container */
		mount?: (self: uPlot, el: HTMLElement) => void;

		/** current index (readback-only, not for init) */
		idx?: number | null;
		/** current indices (readback-only, not for init) */
		idxs?: (number | null)[];
		/** current values (readback-only, not for init) */
		values?: Legend.Values;
	}

	export namespace Legend {
		export type Width  = number | ((self: uPlot, seriesIdx: number) => number);

		export type Stroke = CSSStyleDeclaration['borderColor'] | ((self: uPlot, seriesIdx: number) => CSSStyleDeclaration['borderColor']);

		export type Dash   = CSSStyleDeclaration['borderStyle'] | ((self: uPlot, seriesIdx: number) => CSSStyleDeclaration['borderStyle']);

		export type Fill   = CSSStyleDeclaration['background']  | ((self: uPlot, seriesIdx: number) => CSSStyleDeclaration['background']);

		export type Value  = {
			[key: string]: string | number;
		};

		export type Values = Value[];

		export interface Markers {
			show?: boolean;	// true
			/** series indicator line width */
			width?: Legend.Width;
			/** series indicator stroke (CSS borderColor) */
			stroke?: Legend.Stroke;
			/** series indicator fill */
			fill?: Legend.Fill;
			/** series indicator stroke style (CSS borderStyle) */
			dash?: Legend.Dash;
		}
	}

	export type DateFormatterFactory = (tpl: string) => (date: Date) => string;

	export type LocalDateFromUnix = (ts: number) => DateZoned;

	export const enum DrawOrderKey {
		Axes   = 'axes',
		Series = 'series',
	}

	export const enum Mode {
		Aligned = 1,
		Faceted = 2,
	}

	export interface DOMOptions {
		/** creates the .uplot container. false creates only the canvas. */
		uplot?: boolean; // true
		/** creates the .u-over element */
		over?: boolean; // true
		/** creates the .u-under element */
		under?: boolean; // true
	}

	export interface CacheOptions {
		/** series path-builder caches. preserves cached disp colors and point sizes */
		paths?: boolean;
		/** retained data arrays and disp caches. disposes the source data, not a refresh */
		data?: boolean;
	}

	export namespace Stack {
		export interface Group {
			/** series indices ordered from zero outward */
			series: number[];

			/** 0 for bars (split by sign); 1/-1 for lines and areas (away from zero) */
			dir: 1 | -1 | 0;
		}
	}

	export interface Stack {
		groups: Stack.Group[];

		/** normalize each group to proportions */
		percent?: boolean;
	}

	export interface Options {
		/** 1: aligned & ordered, single-x / y-per-series, 2: unordered & faceted, per-series/per-point x,y,size,label,color,shape,etc. */
		mode?: Mode,

		/** chart title */
		title?: string;

		/** DOM elements to create */
		dom?: DOMOptions;

		/** id to set on chart root */
		id?: string;

		/** className to add to chart root */
		class?: string;

		/** width of plotting area + axes in CSS pixels */
		width: number;

		/** height of plotting area + axes in CSS pixels (excludes title & legend height) */
		height: number;

		/** initial devicePixelRatio, if different than window.devicePixelRatio */
		pxRatio?: number;

		/** Canvas 2D context attributes for creation */
		ctxAttrs?: CanvasRenderingContext2DSettings;

		/** data for chart, if none is provided as argument to constructor */
		data?: AlignedData;

		/** converts a unix timestamp to Date that's time-adjusted for the desired timezone */
		tzDate?: LocalDateFromUnix;

		/** creates an efficient formatter for Date objects from a template string, e.g. {YYYY}-{MM}-{DD} */
		fmtDate?: DateFormatterFactory;

		/** timestamp multiplier that yields 1 millisecond */
		ms?: 1e-3 | 1; // 1e-3

		/** drawing order for axes/grid & series (default: ["axes", "series"]) */
		drawOrder?: DrawOrderKey[];

		/** whether vt & hz lines of series/grid/ticks should be crisp/sharp or sub-px antialiased */
		pxAlign?: boolean | number; // true

		series: Series[];

		bands?: Band[];

		/** cumulative stacking groups */
		stack?: Stack;

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

		/** caches to retain after rendering (default: all) */
		cache?: CacheOptions;
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

	export interface Select extends BBox {
		/** div into which .u-select will be placed: .u-over or .u-under */
		over?: boolean; // true
	}

	export interface SyncPubSub {
		key:   string;
		sub:   (client: uPlot) => void;
		unsub: (client: uPlot) => void;
		pub:   (type: string, client: uPlot, x: number, y: number, w: number, h: number, i: number) => void;
		plots: uPlot[];
	}

	export namespace Cursor {
		export type LeftTop              = [left: number, top: number];

		export type MouseListener        = (e: MouseEvent) => void;

		export type MouseListenerFactory = (self: uPlot, targ: HTMLElement, handler: MouseListener) => MouseListener | null;

		export type DataIdxRefiner       = (self: uPlot, seriesIdx: number, closestIdx: number, xValue: number) => number | null;

		export type MousePosRefiner      = (self: uPlot, mouseLeft: number, mouseTop: number) => LeftTop;

		export interface Bind {
			mousedown?:   MouseListenerFactory;
			mouseup?:     MouseListenerFactory;
			click?:       MouseListenerFactory;
			dblclick?:    MouseListenerFactory;

			mousemove?:   MouseListenerFactory;
			mouseleave?:  MouseListenerFactory;
			mouseenter?:  MouseListenerFactory;
		}

		export namespace Points {
			export type Show   = boolean | ((self: uPlot, seriesIdx: number) => HTMLElement);
			export type Size   = number  | ((self: uPlot, seriesIdx: number) => number);
			export type BBox   = (self: uPlot, seriesIdx: number) => uPlot.BBox;
			export type Width  = number  | ((self: uPlot, seriesIdx: number, size: number) => number);
			export type Stroke = CanvasRenderingContext2D['strokeStyle'] | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['strokeStyle']);
			export type Fill   = CanvasRenderingContext2D['fillStyle']   | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['fillStyle']);
		}

		export interface Points {
			show?:   Points.Show;
			/** only show single y-closest point on hover (only works when cursor.focus.prox >= 0) */
			one?:    boolean;
			/** hover point diameter in CSS pixels */
			size?:   Points.Size;
			/** hover point bbox in CSS pixels (will be used instead of size) */
			bbox?:   Points.BBox;
			/** hover point outline width in CSS pixels */
			width?:  Points.Width;
			/** hover point outline color, pattern or gradient */
			stroke?: Points.Stroke;
			/** hover point fill color, pattern or gradient */
			fill?:   Points.Fill;
		}

		export type DragSetRange = boolean | ((self: uPlot, scaleKey: string, min: number, max: number) => [min: number, max: number] | null);

		export interface Drag {
			/** applies drag bounds; a callback can adjust them or return null to cancel that scale */
			setRange?: DragSetRange; // true
			/** @deprecated Use setRange. */
			setScale?: boolean; // null
			/** toggles dragging along x */
			x?: boolean; // true
			/** toggles dragging along y */
			y?: boolean; // false
			/** min drag distance threshold */
			dist?: number; // 0
			/** when x & y are true, sets an upper drag limit in CSS px for adaptive/unidirectional behavior */
			uni?: number; // null
			/** post-drag "click" event proxy, default is to prevent these click events */
			click?: (self: uPlot, e: MouseEvent) => void;
		}

		export namespace Sync {
			export type Scales = [xScaleKey: string | null, yScaleKey: string | null];

			export type Filter = (type: string, client: uPlot, x: number, y: number, w: number, h: number, i: number) => boolean;

			export interface Filters {
				/** filters emitted events */
				pub?: Filter;
				/** filters received events */
				sub?: Filter;
			}

			export type ScaleKeyMatcher = (subScaleKey: string | null, pubScaleKey: string | null) => boolean;

			export type SeriesIdxMatcher = (sub: uPlot, pub: uPlot, pubSeriesIdx: number) => number | null;

			export type Match = [matchX: ScaleKeyMatcher, matchY: ScaleKeyMatcher, matchSeriesIdx?: SeriesIdxMatcher];

			export type Values = [xScaleValue: number, yScaleValue: number];
		}

		export interface Sync {
			/** sync key must match between all charts in a synced group */
			key: string;
			/** determines if series toggling and focus via cursor is synced across charts */
			setSeries?: boolean; // true
			/** sets the x and y scales to sync by values. null will sync by relative (%) position */
			scales?: Sync.Scales; // [xScaleKey, null]
			/** fns that match x and y scale keys and seriesIdxs between publisher and subscriber */
			match?: Sync.Match;
			/** event filters */
			filters?: Sync.Filters;
			/** sync scales' values at the cursor position (exposed for read-back by subscribers) */
			values?: Sync.Values,
		}

		// options that compile the cursor.dataIdx callback (the index scanner)
		export interface Hover {
			/** minimum cursor proximity to datapoint in CSS pixels for point hover */
			prox?: number | null | ((self: uPlot, seriesIdx: number, closestIdx: number, xValue: number) => number | null); // null/Infinity
			/** when non-zero, will only proximity-test indices forward or backward */
			bias?: HoverBias; // 0
			/** what values to treat as non-hoverable and trigger scanning to another index */
			skip?: any[]; // [undefined]
		}

		export interface Focus {
			/** minimum cursor proximity to datapoint in CSS pixels for focus activation, disabled: < 0, enabled: <= 1e6 */
			prox: number;
			/** when non-zero, will only focus next series towards or away from zero */
			bias?: FocusBias; // 0
			/** measures cursor y distance to a series in CSS pixels (for triggering setSeries hook with closest) */
			dist?: (self: uPlot, seriesIdx: number, dataIdx: number, valPos: number, curPos: number) => number;
		}

		export const enum FocusBias {
			None          =  0,
			AwayFromZero  =  1,
			TowardsZero   = -1,
		}

		export const enum HoverBias {
			None     =  0,
			Forward  =  1,
			Backward = -1,
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
		idx?: number | null;

		/** returns data idx used for hover points & legend display (defaults to closestIdx) */
		dataIdx?: Cursor.DataIdxRefiner;

		/** a series-matched array of indices returned by dataIdx() */
		idxs?: (number | null)[];

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

		/** focus series closest to cursor (y) */
		focus?: Cursor.Focus;

		/** hover data points closest to cursor (x) */
		hover?: Cursor.Hover;

		/** lock cursor on mouse click in plotting area */
		lock?: boolean; // false

		/** the most recent mouse event */
		event?: MouseEvent;
	}

	export namespace Scale {
		export type Auto = boolean | ((self: uPlot, resetScales: boolean) => boolean);

		export type Scan = boolean | ((self: uPlot, scaleKey: string, i0?: number | null, i1?: number | null, viaAutoScaleX?: boolean) => Range.MinMax);

		export type Range = Range.MinMax | Range.Function | Range.Config;

		export const enum Distr {
			Linear      = 1,
			Ordinal     = 2,
			Logarithmic = 3,
			ArcSinh     = 4,
			Custom      = 100,
		}

		export type LogBase = 10 | 2;

		export type Clamp = number | ((self: uPlot, val: number, scaleMin: number, scaleMax: number, scaleKey: string) => number);
	}

	export interface Scale {
		/** is this scale temporal, with series' data in UNIX timestamps? */
		time?: boolean;

		/** automatically recalculates this scale's range (default: true) */
		auto?: Scale.Auto;

		/**
		 * calculates data extrema for range(). true uses the cached scanner; false supplies [null, null].
		 * custom callbacks must populate participating series/facet min/max caches.
		 */
		scan?: Scale.Scan;

		/** can define a static scale range or re-range an initially-determined range from series data */
		range?: Scale.Range;

		/** scale key from which this scale is derived */
		from?: string;

		/** scale distribution. 1: linear, 2: ordinal, 3: logarithmic, 4: arcsinh */
		distr?: Scale.Distr; // 1

		/** logarithmic base */
		log?: Scale.LogBase; // 10;

		/**
		 * For log scales, replaces values <= 0 during positioning (default: scaleMin / 10).
		 * For default adaptive asinh, excludes absolute values <= this nonnegative cutoff from threshold selection (default: 0).
		 * Adaptive asinh calls the callback once per threshold calculation, with val = 0 and the current scale bounds.
		 * The asinh cutoff does not clamp data values or affect explicit numeric or callback asinh settings.
		 */
		clamp?: Scale.Clamp;

		/** arcsinh linear threshold (default: adaptive) */
		asinh?: number | ((self: uPlot, scaleKey: string) => number);

		/** forward transform fn, with custom distr: 100 */
		fwd?: (v: number) => number;
		/** backward transform fn, with custom distr: 100 */
		bwd?: (v: number) => number;

		/** current min scale value */
		min?: number;

		/** current max scale value */
		max?: number;

		/** scale direction */
		dir?: 1 | -1;

		/** scale orientation - 0: hz, 1: vt */
		ori?: 0 | 1;

		/** own key (for read-back) */
		key?: string;
	}

	export namespace Series {
		export interface Paths {
			/** path to stroke */
			stroke?: Path2D | Map<CanvasRenderingContext2D['strokeStyle'], Path2D> | null;

			/** path to fill */
			fill?: Path2D | Map<CanvasRenderingContext2D['fillStyle'], Path2D> | null;

			/** path for clipping fill & stroke (used for gaps) */
			clip?: Path2D | null;

			/** yMin-ward (dir: -1) and/or yMax-ward (dir: 1) clips built using the stroke path (inverted dirs from band.dir fills) */
			band? : Path2D | null | [yMinClip: Path2D, yMaxClip: Path2D];

			/** tuples of canvas pixel coordinates that were used to construct the gaps clip */
			gaps?: [from: number, to: number][];

			/** line width in CSS pixels, if differs from series.width (for dynamic rendering optimization) */
			width?: number;

			/** fill style, if differs from series.fill (for dynamic rendering optimization) */
			_fill?: CanvasRenderingContext2D['fillStyle'];

			/** stroke style, if differs from series.stroke (for dynamic rendering optimization) */
			_stroke?: CanvasRenderingContext2D['strokeStyle'];

			/** bitmap of whether the band clip should be applied to stroke, fill, or both */
			flags?: number;
		}

		export interface SteppedPathBuilderOpts {
			align?: -1 | 1; // 1

			alignGaps?: -1 | 0 | 1; // 0

			// whether to draw ascenders/descenders at null/gap boundaries
			ascDesc?: boolean; // false

			// extend hz lines to plot edges when x scale is beyond x data limits?
			extend?: boolean; // false
		}

		export const enum BarsPathBuilderFacetUnit {
			ScaleValue   = 1,
			PixelPercent = 2,
			Color        = 3,
		}

		export const enum BarsPathBuilderFacetKind {
			Unary      = 1,
			Discrete   = 2,
			Continuous = 3,
		}

		export type BarsPathBuilderFacetValue = number | null | undefined;

		export type BarsPathBuilderFacet<T = BarsPathBuilderFacetValue> = {
			/** unit of measure for output of values() */
			unit: BarsPathBuilderFacetUnit;
		} & PathBuilderFacet<T>;

		/** uniform bar width. variable widths, including log-scale X widths, are not yet supported */
		export type BarsPathBuilderSizeFacet = {unit: 1 | 2} & PathBuilderUnaryFacet<number>;

		export type PathBuilderColor = CanvasRenderingContext2D['fillStyle'] | null | undefined;

		/** enum values and per-datapoint indices, indexed by the original data index */
		export type PathBuilderDiscreteValues<T = unknown> = readonly [enum: readonly T[], idxs: ArrayLike<number>];

		/** one value for the entire series */
		export interface PathBuilderUnaryFacet<T> {
			kind: BarsPathBuilderFacetKind.Unary;
			values: (self: uPlot, seriesIdx: number, idx0: number, idx1: number) => T;
		}

		/** kind selects the return format. omitted kind means Continuous */
		export type PathBuilderFacet<T> = PathBuilderUnaryFacet<T> | {
			kind: BarsPathBuilderFacetKind.Discrete;
			values: (self: uPlot, seriesIdx: number, idx0: number, idx1: number) => PathBuilderDiscreteValues<T>;
		} | {
			kind?: BarsPathBuilderFacetKind.Continuous;
			values: (self: uPlot, seriesIdx: number, idx0: number, idx1: number) => ArrayLike<T>;
		};

		export type PathBuilderColorValues = PathBuilderColor | ArrayLike<PathBuilderColor> | PathBuilderDiscreteValues<PathBuilderColor>;

		/** shared bar and point colors. bars group equal colors; points with disp paint individually.
		 *  full-range values (0..N-1) are cached per series/descriptor. descriptors and callbacks must remain stable.
		 *  core data replacement and series changes clear the cache. null/undefined colors suppress the channel.
		 */
		export type PathBuilderColorFacet = {unit?: 3} & PathBuilderFacet<PathBuilderColor>;

		/** bbox in canvas pixels, including stroke. useful for a spatial index */
		export type PathBuilderEach = (self: uPlot, seriesIdx: number, idx: number, left: number, top: number, width: number, height: number) => void;

		/** custom per-datapoint styling and positioning. geometry callbacks run on each rebuild */
		export interface BarsPathBuilderDisplay {
			x0?: BarsPathBuilderFacet<number>;
		//	x1?: BarsPathBuilderFacet;
			y0?: BarsPathBuilderFacet;
			y1?: BarsPathBuilderFacet;
			size?: BarsPathBuilderSizeFacet;
			fill?: PathBuilderColorFacet;
			stroke?: PathBuilderColorFacet;
		}

		/** radii for bar end (at bar's value) and bar start (baseline, zero)  */
		export type BarsPathBuilderRadii = [endRadius: number, baseRadius: number];

		export type BarsPathBuilderRadius = number | BarsPathBuilderRadii | ((self: uPlot, seriesIdx: number) =>  BarsPathBuilderRadii);

		export interface BarsPathBuilderOpts {
			align?: -1 | 0 | 1; // 0

			size?: [factor?: number, max?: number, min?: number];

			// corner radius factor of bar size (0 - 0.5)
			radius?: BarsPathBuilderRadius; // 0

			/** CSS-pixel gaps that reduce bar width. A number is equivalent to [0, gap].
			 *  For align: 1 or -1, leading insets the anchored edge along the bar's direction.
			 *  Centered bars remain centered and use the sum of both gaps.
			 */
			gap?: number | [leading: number, trailing: number];

			/** custom bar geometry and cached colors */
			disp?: BarsPathBuilderDisplay;

			/** called with bbox geometry of each drawn bar in canvas pixels. useful for spatial index, etc. */
			each?: PathBuilderEach;
		}

		/** finite CSS outer diameters including stroke, cached like colors. sizes <= stroke width skip the point */
		export type PointsPathBuilderSizeFacet = {unit?: 3} & PathBuilderFacet<number>;

		/** maps raw values through a native scale, independently of plot dimensions and orientation */
		export type PointsPathBuilderScaledSizeFacet = {
			unit?: 1;
			scale: string;
			/** ascending CSS outer diameters [minDiameter, maxDiameter] at the scale min/max. transformed values are clamped to this range. maxDiameter / 2 pads the center-culling window */
			range: [number, number];
		} & PathBuilderFacet<number>;

		/** custom per-point colors and sizes. positions come from the series data */
		export interface PointsPathBuilderDisplay {
			fill?: PathBuilderColorFacet;
			stroke?: PathBuilderColorFacet;
			/** supplying size clips fills and strokes strictly to the plot, even when all sizes are equal. omitted size retains expanded marker clipping */
			size?: PointsPathBuilderSizeFacet | PointsPathBuilderScaledSizeFacet;
		}

		export interface PointsPathBuilderOpts {
			/** draws each point immediately in data order, fill then stroke, and returns null. omitted disp retains single-path behavior */
			disp?: PointsPathBuilderDisplay;

			/** called with each drawn point's full bbox, including stroke, in canvas pixels. bounds are not truncated by plot clipping */
			each?: PathBuilderEach;
		}

		export interface LinearPathBuilderOpts {
			alignGaps?: -1 | 0 | 1; // 0
		}

		export interface SplinePathBuilderOpts {
			alignGaps?: -1 | 0 | 1; // 0
		}

		/** builder for series.points.paths. reads series.points options. scale-backed disp.size expands center inclusion by its maximum radius without changing scale ranges */
		export type PointsPathBuilderFactory  = (opts?: PointsPathBuilderOpts) => Points.PathBuilder;
		export type LinearPathBuilderFactory  = (opts?: LinearPathBuilderOpts) => Series.PathBuilder;
		export type SplinePathBuilderFactory  = (opts?: SplinePathBuilderOpts) => Series.PathBuilder;
		export type SteppedPathBuilderFactory = (opts?: SteppedPathBuilderOpts) => Series.PathBuilder;
		export type BarsPathBuilderFactory    = (opts?: BarsPathBuilderOpts) => Series.PathBuilder;

		export interface PathBuilderFactories {
			linear?:  LinearPathBuilderFactory;
			spline?:  SplinePathBuilderFactory;
			stepped?: SteppedPathBuilderFactory;
			bars?:    BarsPathBuilderFactory;
			points?:  PointsPathBuilderFactory;
		}

		export type Stroke = CanvasRenderingContext2D['strokeStyle'] | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['strokeStyle']);

		export type Fill = CanvasRenderingContext2D['fillStyle'] | ((self: uPlot, seriesIdx: number) => CanvasRenderingContext2D['fillStyle']);

		export type Cap = CanvasRenderingContext2D['lineCap'];

		export namespace Points {
			export interface Paths {
				/** path to stroke */
				stroke?: Path2D | null;

				/** path to fill */
				fill?: Path2D | null;

				/** path for clipping fill & stroke */
				clip?: Path2D | null;

				/** bitmap of whether the clip should be applied to stroke, fill, or both */
				flags?: number;
			}

			export type Show = boolean | ((self: uPlot, seriesIdx: number, idx0: number, idx1: number, gaps?: null | number[][]) => boolean | undefined);

			export type Filter = number[] | null | ((self: uPlot, seriesIdx: number, show: boolean, gaps?: null | number[][]) => number[] | null);

			export type PathBuilder = (self: uPlot, seriesIdx: number, idx0: number, idx1: number, filtIdxs?: number[] | null) => Paths | null;
		}

		export interface Points {
			/** if boolean or returns boolean, round points are drawn with defined options, else fn should draw own custom points via self.ctx */
			show?: Points.Show;

			paths?: Points.PathBuilder;

			/** may return an array of points indices to draw */
			filter?: Points.Filter;

			/** diameter of point in CSS pixels */
			size?: number;

			/** minimum avg space between point centers before they're shown (default: size * 2) */
			space?: number;

			/** line width of circle outline in CSS pixels */
			width?: number;

			/** line color of circle outline (defaults to series.stroke) */
			stroke?: Stroke;

			/** line dash segment array */
			dash?: number[];

			/** line cap */
			cap?: Series.Cap;

			/** fill color of circle (defaults to #fff) */
			fill?: Fill;
		}

		export interface Facet {
			scale: string;

			/** includes this facet in data scans */
			scan?: boolean; // true

			/** @deprecated Use scan. */
			auto?: boolean;

			sorted?: Sorted;

			/** cached data extrema */
			min?: number | null;
			max?: number | null;
		}

		export type Gap = [from: number, to: number];

		export type Gaps = Gap[];

		export type GapsRefiner = Gaps | ((self: uPlot, seriesIdx: number, idx0: number, idx1: number, nullGaps: Gaps) => Gaps);

		export type AddGap = (gaps: Gaps, from: number, to: number) => void;

		export type ClipPathBuilder = (gaps: Gaps, ori: Orientation, left: number, top: number, width: number, height: number) => Path2D | null;

		export type PathBuilder = (self: uPlot, seriesIdx: number, idx0: number, idx1: number) => Paths | null;

		export type MinMaxIdxs = [minIdx: number, maxIdx: number];

		export type Value = string | ((self: uPlot, rawValue: number, seriesIdx: number, idx: number | null) => string | number);

		export type Values = (self: uPlot, seriesIdx: number, idx: number | null) => object;

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

		/** includes this series in data scans (default: true for data series) */
		scan?: boolean;

		/** @deprecated Use scan. */
		auto?: boolean;

		/** if & how the data is pre-sorted (data scanning optimization) */
		sorted?: Series.Sorted;

		/** when true, null data values will not cause line breaks */
		spanGaps?: boolean;

		// 0: also erase interpolation to left and right of null regions, 1: to right only, -1: to left only
		alignGaps?: -1 | 0 | 1; // 0

		/** may mutate and/or augment gaps array found from null values */
		gaps?: Series.GapsRefiner;

		/** whether path and point drawing should offset canvas to try drawing crisp lines */
		pxAlign?: number | boolean; // 1

		/** legend label */
		label?: string | HTMLElement;

		/** inline-legend value formatter. can be an fmtDate formatting string when scale.time: true */
		value?: Series.Value;

		/** table-legend multi-values formatter */
		values?: Series.Values;

		paths?: Series.PathBuilder;

		/** rendered datapoints */
		points?: Series.Points;

		/** facets */
		facets?: Series.Facet[];

		/** line width in CSS pixels */
		width?: number;

		/** line & legend color */
		stroke?: Series.Stroke;

		/** area fill & legend color */
		fill?: Series.Fill;

		/** area fill baseline (default: 0) */
		fillTo?: Series.FillTo;

		/** line dash segment array */
		dash?: number[];

		/** line cap */
		cap?: Series.Cap;

		/** alpha-transparancy */
		alpha?: number;

		/** current min and max data indices rendered */
		idxs?: Series.MinMaxIdxs;

		/** cached minimum data value */
		min?: number | null;

		/** cached maximum data value */
		max?: number | null;
	}

	export namespace Band {
		export type Fill = CanvasRenderingContext2D['fillStyle'] | ((self: uPlot, bandIdx: number, highSeriesFill: CanvasRenderingContext2D['fillStyle']) => CanvasRenderingContext2D['fillStyle']);

		export type Bounds = [fromSeriesIdx: number, toSeriesIdx: number];
	}

	export interface Band {
		/** band on/off */
	//	show?: boolean;

		/** series indices of upper and lower band edges */
		series: Band.Bounds;

		/** area fill style */
		fill?: Band.Fill;

		/** whether to fill towards yMin (-1) or yMax (+1) between "from" & "to" series */
		dir?: 1 | -1; // -1
	}

	export namespace Axis {
		export interface Nice {
			/** aligns multi-hour ticks to local midnight across DST */
			dst?: boolean; // true
			/** includes month-start ticks for multi-day increments */
			first?: boolean; // false
		}

		/** must return an array of same length as splits, e.g. via splits.map() */
		export type Filter = (self: uPlot, splits: number[], axisIdx: number, foundSpace: number, foundIncr: number) => (number | null)[];

		/**
		 * Axis size in CSS pixels. 'auto' fits ticks, gap, and selected labels. Axis titles use labelSize separately.
		 * Automatic sizing supports default alignment (align: 0) and alignTo: 1 only.
		 * It supports unrotated multiline labels. Rotation support is limited to single-line labels on bottom axes.
		 * Explicit numeric sizes and size callbacks retain support for custom alignment and drawn rotated multiline labels.
		 * Unrotated horizontal autosizing reads current label strings for height without measurement of their widths.
		 * Core measures widths only for vertical or rotated sizing, or automatic padding. Unchanged labels reuse cached widths.
		 *
		 * With an automatic horizontal axis, layout selects all horizontal ticks once from a provisional plot width, then sizes all horizontal axes together.
		 * This width reserves explicit numeric vertical axis widths. Automatic vertical axes and vertical axes with size callbacks reserve 50px each.
		 * These reservations also include axis titles.
		 * Selected horizontal ticks remain unchanged through final layout.
		 *
		 * Early tick callbacks cannot depend on a newly calculated provisional height or fixed horizontal axis allocations.
		 * Horizontal size callbacks run after this tick selection and still receive null values. Vertical size callbacks receive formatted values.
		 * Without an automatic horizontal axis, layout order does not change.
		 */
		export type Size = number | 'auto' | ((self: uPlot, values: Axis.StaticValues | null, axisIdx: number) => number);

		export type Space = number | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, plotDim: number) => number);

		export type Incrs = number[] | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, fullDim: number, minSpace: number) => number[]);

		export type Splits = number[] | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, foundIncr: number, foundSpace: number) => number[]);

		export type StaticValues = (string | number | null)[];

		export type DynamicValues = (self: uPlot, splits: number[], axisIdx: number, foundSpace: number, foundIncr: number) => StaticValues;

		export type TimeValuesConfig = (string | number | null)[][];

		export type TimeValuesTpl = string;

		export type Values = StaticValues | DynamicValues | TimeValuesTpl | TimeValuesConfig;

		export type Label = string | ((self: uPlot, axisIdx: number, foundIncr: number, foundSpace: number) => string);

		export type Stroke = CanvasRenderingContext2D['strokeStyle'] | ((self: uPlot, axisIdx: number) => CanvasRenderingContext2D['strokeStyle']);

		export const enum Side {
			Top    = 0,
			Right  = 1,
			Bottom = 2,
			Left   = 3,
		}

		export const enum Align {
			Default = 0,
			Left    = 1,
			Right   = 2,
		}

		export const enum AlignTo {
			/** axis gap is on the inside; text is placed at outer gap boundary */
			Inside  = 1,
			/** axis gap is on the outside; text is placed at inner gap boundary */
			Outside = 2,
		}

		export type Rotate = number | ((self: uPlot, values: (string | number)[], axisIdx: number, foundSpace: number) => number);

		interface OrthoLines {
			/** on/off */
			show?: boolean; // true

			/** line color */
			stroke?: Stroke;

			/** line width in CSS pixels */
			width?: number;

			/** line dash segment array */
			dash?: number[];

			/** line cap */
			cap?: Series.Cap;
		}

		export interface Border extends OrthoLines {}

		interface FilterableOrthoLines extends OrthoLines {
			/** can filter which splits render lines. e.g splits.map(v => v % 2 == 0 ? v : null) */
			filter?: Filter;
		}

		export interface Grid extends FilterableOrthoLines {}

		export interface Ticks extends FilterableOrthoLines {
			/** length of tick in CSS pixels */
			size?: number;
		}
	}

	export interface Axis {
		/** axis on/off */
		show?: boolean;

		/** creates the .u-axis DOM rectangle */
		dom?: boolean; // true

		/** scale key */
		scale?: string;

		/** side of chart - 0: top, 1: rgt, 2: btm, 3: lft */
		side?: Axis.Side;

		/** horizontal axis height or vertical axis width in CSS pixels for values, gap & ticks, excluding the axis label */
		size?: Axis.Size;

		/** gap between axis values and axis baseline (or ticks, if enabled) in CSS pixels */
		gap?: number;

		/** font used for axis values. runtime changes to font, lineGap, and side are unsupported. */
		font?: CanvasRenderingContext2D['font'];

		/** font-size multiplier for multi-line axis values (similar to CSS line-height: 1.5em) */
		lineGap?: number; // 1.5

		/** color of axis label & values */
		stroke?: Axis.Stroke;

		/** axis label text */
		label?: Axis.Label;

		/** height of x axis label or width of y axis label in CSS pixels alloted for label text + labelGap */
		labelSize?: number;

		/** gap between label baseline and tick values in CSS pixels */
		labelGap?: number;

		/** font used for axis label */
		labelFont?: CanvasRenderingContext2D['font'];

		/** target grid & tick spacing in CSS pixels. automatic horizontal sizing uses provisional width, so final spacing can be smaller.
				 * horizontal tick-aware ranging passes raw extrema to callbacks. */
		space?: Axis.Space;

		/** tick-count growth factor for tick-aware Y ranging. 0 retains two edge ticks */
		ramp?: number; // 1

		/** enforces the dimension/ramp-derived interval count for tick-aware Y ranging */
		exact?: boolean; // false

		/** available divisors for axis ticks, values, grid */
		incrs?: Axis.Incrs;

		/** calendar adjustments for built-in time-axis splits */
		nice?: Axis.Nice;

		/** determines how and where the axis must be split for placing ticks, values, grid */
		splits?: Axis.Splits;

		/** can filter which splits are passed to axis.values() for rendering. e.g splits.map(v => v % 2 == 0 ? v : null) */
		filter?: Axis.Filter;

		/** formats values for rendering. return a new array when labels change. */
		values?: Axis.Values;

		/** values rotation in degrees off horizontal (only bottom axes w/ side: 2) */
		rotate?: Axis.Rotate;

		/** Text alignment of axis values: 0: default, 1: left, 2: right. Automatic sizing and tuple overflow support only 0. */
		align?: Axis.Align;

		/** Baseline for text alignment of axis values: 1: inside, 2: outside. Automatic sizing and tuple overflow support only 1. */
		alignTo?: Axis.AlignTo;

		/** gridlines to draw from this axis' splits */
		grid?: Axis.Grid;

		/** ticks to draw from this axis' splits */
		ticks?: Axis.Ticks;

		/** axis border/edge rendering */
		border?: Axis.Border;
	}

	export namespace Hooks {
		export interface Defs {
			/** fires after opts are defaulted & merged but data has not been set and scales have not been ranged */
			init?:       (self: uPlot, opts: Options, data: AlignedData) => void;

			/** fires after each initial and subsequent series addition (discern via self.status == 0 or 1) */
			addSeries?:  (self: uPlot, seriesIdx: number) => void;

			/** fires after each series deletion */
			delSeries?:  (self: uPlot, seriesIdx: number) => void;

			/** fires after any scale has changed */
			setScale?:   (self: uPlot, scaleKey: string) => void;

			/** fires after the cursor is moved */
			setCursor?:  (self: uPlot) => void;

			/** fires when cursor changes idx and legend updates (or should update) */
			setLegend?:  (self: uPlot) => void;

			/** fires after a selection is completed */
			setSelect?:  (self: uPlot) => void;

			/** fires after a series is toggled or focused */
			setSeries?:  (self: uPlot, seriesIdx: number | null, opts: {show?: boolean, focus?: boolean}) => void;

			/** fires after data is updated updated */
			setData?:    (self: uPlot) => void;

			/** fires after chart size, plot geometry, or axes change */
			setSize?:    (self: uPlot) => void;

			/** fires at start of every redraw */
			drawClear?:  (self: uPlot) => void;

			/** fires after all axes are drawn */
			drawAxes?:   (self: uPlot) => void;

			/** fires after each series is drawn */
			drawSeries?: (self: uPlot, seriesIdx: number) => void;

			/** fires after everything is drawn */
			draw?:       (self: uPlot) => void;

			/** fires after the chart is fully initialized and in the DOM */
			ready?:      (self: uPlot) => void;

			/** fires after the chart is destroyed */
			destroy?:    (self: uPlot) => void;

			/** fires after .u-over's getBoundingClientRect() is called (due to scroll or resize events) */
			syncRect?:   (self: uPlot, rect: DOMRect) => void;
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
}

export as namespace uPlot;
