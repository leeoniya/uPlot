declare class UPlot {
  constructor(opts: UPlot.Options, data: UPlot.Data, ctx: HTMLCanvasElement);
  readonly width: number;
  readonly height: number;
  readonly ctx: CanvasRenderingContext2D;
  readonly bbox: UPlot.BBox;
  readonly select: UPlot.BBox;

  redraw(): void;
  batch(): void;
  destroy(): void;

  setData(data: UPlot.Data, something?: boolean): void;
  setScale(scale: string, limits: { min: number; max: number }): void;
  setCursor(cursor: string): void;
  setSelect(opts: UPlot.SelectOpts, unknown?: boolean): void;

  posToIdx(left: number): number;
  posToVal(leftTop: number, scaleKey: string): number;
  valToPos(val: number, scaleKey: string): number;
}
declare namespace UPlot {
  export type Data = readonly number[][];
  export interface BBox {
    left: number;
    top: number;
    width: number;
    height: number;
  }
  export interface Options {
    title?: string;
    id?: string;
    class?: string;
    width: number;
    height: number;
    series: Array<UPlot.Series>;
    scales: ScaleMap;
    axes: Array<UPlot.Axis>;
    hooks: UPlot.Hooks;
    plugins: Array<{
      hooks: UPlot.Hooks;
    }>;
    select?: {
      show: boolean;
    };
    legend?: {
      show?: boolean;
    };
  }

  export interface SelectOpts {
    show?: number;
    left?: number;
    width?: number;
    top?: number;
    height?: number;
  }

  export interface Cursor {
    show?: boolean;
    points?: {
      show: boolean | (() => boolean);
    };
    x: number;
    y: number;
    drag: {
      setSelect: () => void;
      setScale: () => void;
      x: number;
      y: number;
    };
    sync: {
      key: string;
      setSeries: () => void;
    };
    focus: {};
    lock: boolean;
  }

  interface ScaleMap {
    [key: string]: UPlot.Scale;
  }

  export interface Series {
    show?: boolean;
    spanGaps?: boolean;
    label?: string;
    band?: boolean;
    stroke?: CanvasRenderingContext2D['strokeStyle'];
    width?: CanvasRenderingContext2D['lineWidth'];
    fill?: CanvasRenderingContext2D['fillStyle'];
    dash?: CanvasRenderingContext2D['setLineDash'];
    value?: (u: UPlot, v: number) => void;
  }
  export interface Axis {
    show?: boolean;
    label?: string;
    labelSize?: number;
    labelFont?: string;
    font?: string;
    gap?: number;
    size?: number;
    stroke?: CanvasRenderingContext2D['strokeStyle'];
    grid?: UPlot.GridOpts;
    ticks?: UPlot.TickOpts;
  }
  export interface GridOpts {
    show?: boolean;
    stroke?: CanvasRenderingContext2D['strokeStyle'];
    width?: number;
    dash?: Array<number>;
  }
  export interface TickOpts {
    show?: boolean;
    stroke?: CanvasRenderingContext2D['strokeStyle'];
    width?: number;
    dash?: Array<number>;
    size?: number;
  }
  export interface Scale {
    auto?: boolean;
    range?: [number, number];
    time?: boolean;
    distr?: number;
    stroke?: CanvasRenderingContext2D['strokeStyle'];
  }
  export interface Axis {
    scale?: string;
    space?:
      | number
      | ((
          self: Axis,
          scaleMin: number,
          scaleMax: number,
          dim: number
        ) => number);
    incrs?: Array<number> | ((self: Axis) => Array<number>);
    values?:
      | Array<[number, string, number, string]>
      | ((self: Axis, ticks: Array<number>, space: number) => Array<string>);
  }
  export interface Hooks {
    init?: Array<(self: UPlot) => void>;
    setSelect?: Array<(self: UPlot) => void>;
  }
}

export default UPlot;
