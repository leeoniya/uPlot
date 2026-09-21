import { plotStep } from './renderDemo.js';

function randInt(min, max) {
  const minCeiled = Math.ceil(min);
  const maxFloored = Math.floor(max);
  return Math.floor(Math.random() * (maxFloored - minCeiled + 1) + minCeiled);
}

function render() {
  // const loop = 500001;
  const loop = 30;

  const data = getData(loop);

  function f(x) {
    return Math.random() - 0.5 + Math.sin(x * 0.00002) * 40 + Math.sin(x * 0.001) * 5 + Math.sin(x * 0.1) * 2;
  }

  function getData(max) {
    const data = [
      Array(loop),
      Array(loop)
    ];

    for (let x = 0; x < max; x++) {
      data[0][x] = x;
      // data[1][x] = f(x);
      data[1][x] = randInt(-50, 50);
    }

    return data;
  }

  const opts = {
    title: "Axis Control",
    width: 1048,
    height: 600,
    scales: {
      x: {
        time: false,
        //	auto: false,
        //	range: [0, 6],
      },
      y: {
        auto: false,
        range: [-50, 50],
      },
    },
    series: [
      {
        label: "x",
      },
      {
        label: "sin(x)",
        stroke: "red",
      }
    ],
    axes: [
      {
        //	size: 30,
        label: "X Axis Label",
        labelSize: 20,
      },
      {
        space: 50,
        //	size: 40,
        side: 1,
        label: "Y Axis Label",
        labelGap: 8,
        labelSize: 8 + 12 + 8,
        stroke: "red",
      }
    ],
  };

  let u = new uPlot(opts, data, document.body);

  return u;
}

function durationLabels(u, splits, axisIdx, space, foundIncr) {
  const dec = uPlot.numDec(splits, foundIncr);
  return splits.map(v => v == null ? "" : `${v.toFixed(dec)} ms`);
}

function decimalLabels(max) {
  const opts = {
    title: `Custom labels: durations up to ${max} ms`,
    width: 600,
    height: 300,
    cursor: {drag: {x: false, y: true}},
    scales: {
      x: {time: false},
    },
    series: [{}, {label: "Duration", stroke: "purple"}],
    axes: [
      {},
      {
        size: 100,
        space: 50,
        values: durationLabels,
      },
    ],
  };

  return new uPlot(opts, [
    [0, 1, 2, 3, 4],
    [0, max / 4, max * 3 / 4, max / 2, max],
  ], document.body);
}

const groups = [
  {
    // name: solid areas
    // before

    steps: [
      {
        // before

        // can return one or more plots
        ...plotStep(render),

        // after
      }
    ]

    // after
  },
  {
    name: "Decimal-aware custom labels with uPlot.numDec(). Drag vertically to zoom. Double-click to reset.",
    steps: [
      plotStep(() => decimalLabels(1)),
      plotStep(() => decimalLabels(0.001)),
    ],
  },
];

export default groups;