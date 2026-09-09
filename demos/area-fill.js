function render() {
  let xs = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30];
  let vals = [-10, -9, -8, -7, -6, -5, -4, -3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10];

  let data = [
    new Float32Array(xs),
    new Float32Array(xs.map((t, i) => vals[Math.floor(Math.random() * vals.length)])),
    new Float32Array(xs.map((t, i) => vals[Math.floor(Math.random() * vals.length)])),
    new Float32Array(xs.map((t, i) => vals[Math.floor(Math.random() * vals.length)])),
  ];

  let fmtVal = (u, raw, sidx, didx) => {
    if (didx == null) {
      let d = u.data[sidx];
      return `${d[d.length - 1]} (last)`;
    }

    return raw == null ? '' : raw;
  };

  const opts = {
    width: 1920,
    height: 600,
    title: "Area Fill",
    scales: {
      x: {
        time: false,
      },
    },
    series: [
      {},
      {
        stroke: "red",
        fill: "rgba(255,0,0,0.1)",
        value: fmtVal,
      },
      {
        stroke: "green",
        fill: "rgba(0,255,0,0.1)",
        value: fmtVal,
      },
      {
        stroke: "blue",
        fill: "rgba(0,0,255,0.1)",
        value: fmtVal,
      },
    ],
  };

  let u = new uPlot(opts, data, document.body);

  return u;
}

const groups = [
  {
    // name: solid areas
    // before

    steps: [
      {
        // before

        // can return one or more plots
        render: async () => {
          return new Promise(res => {
            let u = render();
            queueMicrotask(() => res([u]));
          });
        },
        verify: async (plots, snapshots, assert) => {

        },

        // after
      }
    ]

    // after
  },
];

export default groups;