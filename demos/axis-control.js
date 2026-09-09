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

        // after
      }
    ]

    // after
  },
];

export default groups;