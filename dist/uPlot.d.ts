declare class uPlot {
	/** when passing a function for @targ, call init() after attaching self.root to the DOM */
	constructor(
		opts: uPlot.Options,
		data: uPlot.AlignedData,
		targ?: HTMLElement | ((self: uPlot, init: Function) => void)
	);

	/** chart container */
	readonly root: HTMLElement;

	/** width of the plotting area + axes in CSS pixels */
	readonly width: number;

	/** height of the plotting area + axes in CSS pixels (excludes title & legend height) */
	readonly height: number;

	// TODO: expose opts.gutters?

	/** context of canvas used for plotting area + axes */
	readonly ctx: CanvasRenderingContext2D;

	/** coords of plotting area in canvas pixels (relative to full canvas w/axes) */
	readonly bbox: uPlot.BBox;

	/** coords of selected region in CSS pixels (relative to plotting area) */
	readonly select: uPlot.BBox;

	/** cursor state & opts*/
	readonly cursor: uPlot.Cursor;

//	/** focus opts */
//	readonly focus: uPlot.Focus;

	/** series state & opts */
	readonly series: Array<uPlot.Series>;

	/** scales state & opts */
	readonly scales: {
		[key: string]: uPlot.Scale;
	};

	/** axes state & opts */
	readonly axes: Array<uPlot.Axis>;

	/** hooks, including any added by plugins */
	readonly hooks: uPlot.Hooks;

	/** current data */
	readonly data: uPlot.AlignedData;


	/** clears and redraws the canvas. if rebuildPaths = false, uses cached series' Path2D objects */
	redraw(rebuildPaths?: boolean): void;

	/** defers recalc & redraw for multiple ops, e.g. setScale('x', ...) && setScale('y', ...) */
	batch(txn: Function): void;

	/** destroys DOM, removes resize & scroll listeners, etc. */
	destroy(): void;

	/** sets the chart data & redraws. (default resetScales = true) */
	setData(data: uPlot.AlignedData, resetScales?: boolean): void;

	/** sets the limits of a scale & redraws (used for zooming) */
	setScale(scaleKey: string, limits: { min: number; max: number }): void;

	/** sets the cursor position (relative to plotting area) */
	setCursor(opts: {left: number, top: number}): void;

	// TODO: include other series style opts which are dynamically pulled?
	/** toggles series visibility or focus */
	setSeries(seriesIdx: number, opts: {show?: boolean, focus?: boolean}): void;

	/** adds a series */
	addSeries(opts: uPlot.Series, seriesIdx?: number): void;

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

	/** a deep merge util fn */
	static assign(targ: object, ...srcs: object[]): object;

	/** re-ranges a given min/max by a multiple of the range's magnitude (used internally to expand/snap/pad numeric y scales) */
	static rangeNum(min: number, max: number, mult: number, extra: boolean): uPlot.MinMax;

	/** re-ranges a given min/max outwards to nearest 10% of given min/max's magnitudes, unless fullMags = true */
	static rangeLog(min: number, max: number, fullMags: boolean): uPlot.MinMax;

	/** default numeric formatter using browser's locale: new Intl.NumberFormat(navigator.language).format */
	static fmtNum(val: number): string;

	/** creates an efficient formatter for Date objects from a template string, e.g. {YYYY}-{MM}-{DD} */
	static fmtDate(tpl: string, names?: uPlot.DateNames): (date: Date) => string;

	/** converts a Date into new Date that's time-adjusted for the given IANA Time Zone Name */
	static tzDate(date: Date, tzName: string): Date;
}

declare namespace uPlot {
	export type AlignedData = readonly (number | null)[][];

	export type SyncScales = [string, string];

	export type MinMax = [number, number];

	export type LeftTop = [number, number];

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

//	export type ScatteredData = readonly number[][][];

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
		tzDate?: (ts: number) => Date;

		/** creates an efficient formatter for Date objects from a template string, e.g. {YYYY}-{MM}-{DD} */
		fmtDate?: (tpl: string) => (date: Date) => string;

		series: Series[];

		scales?: {
			[key: string]: Scale;
		},

		axes?: Axis[];

		/** extra space to add in CSS pixels in the absence of a cross-axis (to prevent axis labels at the plotting area limits from being chopped off) */
		gutters?: {
			x?: number;
			y?: number;
		};

		select?: BBox;

		legend?: {
			show?: boolean;	// true
			/** show series values at current cursor.idx */
			live?: boolean;	// true
		};

		cursor?: Cursor;

		focus?: Focus;

		hooks?: Hooks;

		plugins?: {
			/** can mutate provided opts as necessary */
			opts?: (self: uPlot, opts: Options) => void;
			hooks: PluginHooks;
		}[];
	}

	interface Focus {
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

		/** closest data index to cursor (hoveredIdx) */
		idx?: number;

		/** returns data idx used for hover points & legend display (defaults to hoveredIdx) */
		dataIdx?: (self: uPlot, seriesIdx: number, hoveredIdx: number) => number;

		/** fires on debounced mousemove events; returns refined [left, top] tuple to snap cursor position */
		move?: (self: uPlot, mouseLeft: number, mouseTop: number) => LeftTop;

		/** series hover points */
		points?: {
			show?: boolean | ((self: uPlot, seriesIdx: number) => HTMLElement);
		};

		/** determines vt/hz cursor dragging to set selection & setScale (zoom) */
		drag?: {
			setScale?: boolean; // true
			/** toggles dragging along x */
			x?: boolean; // true
			/** toggles dragging along y */
			y?: boolean; // false
			/** min drag distance threshold */
			dist?: number; // 0
			/** when x & y are true, sets an upper drag limit in CSS px for adaptive/unidirectional behavior */
			uni?: number; // null
		};

		/** sync cursor between multiple charts */
		sync?: {
			/** sync key must match between all charts in a synced group */
			key: string;
			/** determines if series toggling and focus via cursor is synced across charts */
			setSeries?: boolean; // true
			/** sets the x and y scales to sync by values. null will sync by relative (%) position */
			scales?: SyncScales; // [xScaleKey, null]
		};

		/** focus series closest to cursor */
		focus?: {
			/** minimum cursor proximity to datapoint in CSS pixels for focus activation */
			prox: number;
		};

		/** lock cursor on mouse click in plotting area */
		lock?: boolean; // false

		/** locked state */
		locked?: false;
	}

	export interface Scale {
		/** is this scale temporal, with series' data in UNIX timestamps? */
		time?: boolean;

		/** determines whether all series' data on this scale will be scanned to find the full min/max range */
		auto?: boolean;

		/** can define a static scale range or re-range an initially-determined range from series data */
		range?: MinMax | ((self: uPlot, initMin: number, initMax: number, scaleKey: string) => MinMax);

		/** scale key from which this scale is derived */
		from?: string,

		/** scale distribution. 1: linear, 2: uniform, 3: logarithmic */
		distr?: 1 | 2 | 3;

		/** current min scale value */
		min?: number,

		/** current max scale value */
		max?: number,
	}

	export interface Series {
		/** series on/off. when off, it will not affect its scale */
		show?: boolean;

		/** className to add to legend parts and cursor hover points */
		class?: string;

		/** scale key */
		scale?: string;

		/** if & how the data is pre-sorted (scale.auto optimization) */
		sorted?: 0 | 1 | -1;

		/** when true, null data values will not cause line breaks */
		spanGaps?: boolean;

		/** legend label */
		label?: string;

		/** inline-legend value formatter. can be an fmtDate formatting string when scale.time: true */
		value?: string | ((self: uPlot, rawValue: number, seriesIdx: number, idx: number) => string | number);

		/** table-legend multi-values formatter */
		values?: (self: uPlot, seriesIdx: number, idx: number) => object;

		paths?: (self: uPlot, seriesIdx: number, idx0: number, idx1: number) => {
			/** path to stroke */
			stroke?: Path2D;

			/** path to fill */
			fill?: Path2D;

			/** path for clipping fill & stroke */
			clip?: Path2D;
		};

		points?: {
			/** if boolean or returns boolean, round points are drawn with defined options, else fn should draw own custom points via self.ctx */
			show?: boolean | ((self: uPlot, seriesIdx: number, idx0: number, idx1: number) => boolean | undefined);

			/** diameter of point in CSS pixels */
			size?: number;

			/** line width of circle outline in CSS pixels */
			width?: CanvasRenderingContext2D['lineWidth'];

			/** line color of circle outline (defaults to series.stroke) */
			stroke?: CanvasRenderingContext2D['strokeStyle'];

			/** fill color of circle (defaults to #fff) */
			fill?: CanvasRenderingContext2D['fillStyle'];
		};

		/** any two adjacent series with band: true, are filled as a single low/high band */
		band?: boolean;

		/** line & legend color */
		stroke?: CanvasRenderingContext2D['strokeStyle'];

		/** line width in CSS pixels */
		width?: CanvasRenderingContext2D['lineWidth'];

		/** area fill & legend color */
		fill?: CanvasRenderingContext2D['fillStyle'];

		/** area fill baseline (default: 0) */
		fillTo?: number | ((self: uPlot, seriesIdx: number, dataMin: number, dataMax: number) => number);

		/** line dash segment array */
		dash?: number[];					// CanvasRenderingContext2D['setLineDash'];

		/** alpha-transparancy */
		alpha?: number;

		/** current min and max data indices rendered  */
		idxs?: MinMax,

		/** current min rendered value */
		min?: number,

		/** current max rendered value */
		max?: number,
	}

	export interface Axis {
		/** axis on/off */
		show?: boolean;

		/** scale key */
		scale?: string;

		/** side of chart - 0: top, 1: rgt, 2: btm, 3: lft */
		side?: number;

		/** height of x axis or width of y axis in CSS pixels alloted for values, gap & ticks, but excluding axis label */
		size?: number;

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
		space?: number | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, plotDim: number) => number);

		/** available divisors for axis ticks, values, grid */
		incrs?: number[] | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, fullDim: number, minSpace: number) => number[]);

		/** determines how and where the axis must be split for placing ticks, values, grid */
		splits?: number[] | ((self: uPlot, axisIdx: number, scaleMin: number, scaleMax: number, foundIncr: number, pctSpace: number) => number[]);

		/** formats values for rendering */
		values?: ((self: uPlot, splits: number[], axisIdx: number, foundSpace: number, foundIncr: number) => Array<string|number>) | (string | number)[][];

		/** values rotation in degrees off horizontal (only bottom axes w/ side: 2) */
		rotate?: number | ((self: uPlot, values: Array<string|number>, axisIdx: number, foundSpace: number) => number);

		/** gridlines to draw from this axis' splits */
		grid?: {
			/** grid on/off */
			show?: boolean; // true

			/** gridline color */
			stroke?: CanvasRenderingContext2D['strokeStyle'];

			/** gridline width in CSS pixels */
			width?: CanvasRenderingContext2D['lineWidth'];

			/** gridline dash array */
			dash?: number[];					// CanvasRenderingContext2D['setLineDash'];
		};

		/** ticks to draw from this axis' splits */
		ticks?: {
			/** ticks on/off */
			show?: boolean; // true

			/** tick color */
			stroke?: CanvasRenderingContext2D['strokeStyle'];

			/** tick line width in CSS pixels */
			width?: CanvasRenderingContext2D['lineWidth'];

			/** tick dash array */
			dash?: number[];					// CanvasRenderingContext2D['setLineDash'];

			/** length of tick in CSS pixels */
			size?: number;
		};
	}

	interface HooksDescription {
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

	export type Hooks = { [P in keyof HooksDescription]: HooksDescription[P][] }
	export type PluginHooks = { [P in keyof HooksDescription]: HooksDescription[P] | HooksDescription[P][] }
}

export default uPlot;
