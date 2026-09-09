const renders = [
  () => {
    let data = [
      Array.from({ length: 30 }, (v, i) => i),
      Array(30).fill(5),
    ];

    const opts = {
      title: "Normal",
      width: 800,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          stroke: "red",
          fill: "rgba(255,0,0,0.2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = [
      Array.from({ length: 200 }, (v, i) => i),
      Array(200).fill(5),
    ];

    const opts = {
      title: "No stroke, red fill",
      width: 800,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          width: 0,
          fill: "red",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = [
      Array.from({ length: 200 }, (v, i) => i),
      Array(200).fill(5),
    ];

    const opts = {
      title: "Too thin, but stroke width 0, use normal fill",
      width: 800,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          width: 0,
          stroke: "red",
          fill: "rgba(255,0,0,0.2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = [
      Array.from({ length: 200 }, (v, i) => i),
      Array(200).fill(5),
    ];

    const opts = {
      title: "Too thin, use stroke color for fill",
      width: 800,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          stroke: "red",
          fill: "rgba(255,0,0,0.2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = [
      Array.from({ length: 200 }, (v, i) => i),
      Array(200).fill(5),
    ];

    const opts = {
      title: "Still stroke & fill",
      width: 1000,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          stroke: "red",
          fill: "rgba(255,0,0,0.2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = [
      Array.from({ length: 200 }, (v, i) => i),
      Array(200).fill(5),
    ];

    const opts = {
      title: "Still stroke & fill",
      width: 1200,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          stroke: "red",
          fill: "rgba(255,0,0,0.2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = [
      Array.from({ length: 200 }, (v, i) => i),
      Array(200).fill(5),
    ];

    const opts = {
      title: "Still stroke & fill",
      width: 1600,
      height: 200,
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          paths: uPlot.paths.bars(),
          stroke: "red",
          fill: "rgba(255,0,0,0.2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },


];

















/*
// todo: maxBarWidth
[
  { set(xOpts, sOpts, bOpts, val) { bOpts.align   = val; }, vals: [0, 1, -1]},
  { set(xOpts, sOpts, bOpts, val) { bOpts.size[0] = val; }, vals: [0.6, 1]},
  { set(xOpts, sOpts, bOpts, val) { bOpts.gap     = val; }, vals: [0, 16]},
  { set(xOpts, sOpts, bOpts, val) { sOpts.width   = val; }, vals: [1, 0, 4]},
  { set(xOpts, sOpts, bOpts, val) { xOpts.dir     = val; }, vals: [1, -1]},
]
*/

// document.body.appendChild(document.createElement('br'));

let opts = [
  { align: 0, width: 0.6, gap: 0 },
  { align: 0, width: 0.6, gap: 16 },
  { align: 0, width: 1.0, gap: 0 },
  { align: 0, width: 1.0, gap: 16 },

  { align: 1, width: 0.6, gap: 0 },
  { align: 1, width: 0.6, gap: 16 },
  { align: 1, width: 1.0, gap: 0 },
  { align: 1, width: 1.0, gap: 16 },

  { align: -1, width: 0.6, gap: 0 },
  { align: -1, width: 0.6, gap: 16 },
  { align: -1, width: 1.0, gap: 0 },
  { align: -1, width: 1.0, gap: 16 },
];

let data = [
  [0, 1, 2, 3, 4],
  [0, 1, 2, 3, 4],
];

opts.forEach(o => {
  [1, 4].forEach(strokeWidth => {
    [1, -1].forEach(dir => {
      renders.push(() => {
        let bars = uPlot.paths.bars({ align: o.align, size: [o.width, Infinity], gap: o.gap });

        let opts = {
          title: JSON.stringify({ ...o, dir, stroke: strokeWidth }).replaceAll('"', '').replaceAll(',', ', '),
          width: 400,
          height: 200,
          scales: {
            x: {
              time: false,
              dir,
            }
          },
          series: [
            {},
            {
              width: strokeWidth,
              stroke: '#00f',
              fill: 'rgb(0,0,255,0.1)',
              paths: bars,
            }
          ],
        };

        return new uPlot(opts, data, document.body);

      });
    });
  });
  // document.body.appendChild(document.createElement('br'));
});


const groups = [
  {
    // name: solid areas
    // before

    steps: renders.map(render => ({
      // before

      // can return one or more plots
      render: async () => {
        return new Promise(res => {
          let u = render();
          queueMicrotask(() => res([u]));
        });
      },

      // after
    })),

    // after
  },
];

export default groups;