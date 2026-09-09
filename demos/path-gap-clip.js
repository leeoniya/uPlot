const _ = null;

const data9 = (() => {
  let vals = [null, null, null, 1, 1, 1, 1, 1, null, null, 2, 2, null, 1, undefined, undefined, null, 1, 1, 1, 1, 2, 2, 2, undefined, undefined];
  //	let vals = [2,null,1,null,1,1];
  //	let vals = [2,null,1];

  return [
    vals.map((v, i) => i),
    vals,
    vals.map((v, i) => v == null ? v : v + 0.1),
    vals.map((v, i) => v == null ? v : v + 0.2),
  ];
})();

const data10 = [
  [1578811651, 1578812548, 1578812549, null, 1578812609, 1578812610, 1578813936],
  [331, 331, 319, null, 324, 331, 331],
];

const data6 = (() => {
  const s_blue = [
    [0, 4, 6],
    [1, 0, 1],
  ];

  const s_red = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [_, _, 3, 4, 5, _, 3, 2, 1, 0],
  ];

  const l_green = [
    [1, 8],
    [4.90, 1.55],
  ];

  const l_yellow = [
    [0, 5, 9],
    [1.11, _, 4.44],
  ];

  const l_sin = [
    [0, 1, 3, 4, 5, 7, 8, 9],
    [
      Math.sin(0 * (Math.PI / 180)) * 5,
      Math.sin(10 * (Math.PI / 180)) * 5,
      Math.sin(30 * (Math.PI / 180)) * 5,
      _,
      Math.sin(50 * (Math.PI / 180)) * 5,
      Math.sin(70 * (Math.PI / 180)) * 5,
      Math.sin(80 * (Math.PI / 180)) * 5,
      Math.sin(90 * (Math.PI / 180)) * 5,
    ],
  ];

  let data = uPlot.join([
    s_blue,
    s_red,
    l_green,
    l_yellow,
    l_sin,
  ]);

  return data;
})();

const renders = [
  () => {
    const data = [
      [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303],
      [3330,3326,3322,3324,3325,3328,3338,3344,3348,3357,3362,3365,3368,3371,3372,3375,3375,3365,3354,3354,3360,3362,3364,3368,3371,3371,3371,3370,3369,3369,3367,3364,3363,3363,3365,3366,3368,3371,3373,3375,3379,3383,3385,3384,3363,3361,3355,3353,3353,3353,3354,3355,3356,3356,3357,3358,3359,3360,3362,3365,3369,3372,3375,3378,3374,3374,3375,3352,3352,3352,3353,3357,3370,3362,3364,3356,3349,3349,3350,3356,3360,3368,3370,3370,3371,3372,3372,3374,3374,3376,3376,3376,3361,3359,3359,3362,3364,3367,3368,3370,3371,3372,3373,3373,3351,3350,3346,3344,3344,3345,3350,3353,3359,3365,3371,3376,3376,3370,3359,3358,3353,3351,3346,3346,3347,3348,3348,3352,3378,3385,3387,3386,3386,3375,3372,3346,3347,3362,3364,3366,3368,3371,3368,3349,3349,3347,3346,3347,3348,3351,3353,3356,3360,3363,3366,3363,3361,3357,3354,3353,3349,3350,3351,3355,3353,3352,3352,3354,3355,3351,3336,3335,3336,3336,3342,3350,3357,3362,3369,3373,3366,3352,3344,3343,3345,3352,3361,3366,3370,3367,3353,3332,3332,3334,3337,3345,3350,3355,3362,3365,3368,3367,3387,3366,3359,3344,3334,3335,3334,3335,3331,3331,3352,3358,3371,3367,3368,3353,3320,3315,3317,3322,3333,3348,3366,3376,3384,3385,3372,3363,3342,3340,3341,3347,3352,3358,3362,3368,3369,3352,3350,3337,3333,3334,3332,3333,3333,3343,3355,3368,3373,3344,3344,3347,3349,3353,3358,3360,3365,3340,3327,3327,3329,3354,3352,3356,3357,3354,3349,3341,3338,3338,3347,3360,3372,3377,3376,3374,3370,3366,3363,3343,3339,3338,3339,3340,3342,3347,3355,3360,3364,3365,3364,3365,3365,3365,3351,3350,3350,3351,3352,3353,3354,3356],
      [3332,3332,3326,3327,3331,3338,3345,3349,3360,3362,3367,3368,3371,3373,3375,3376,3377,3376,3365,3360,3362,3364,3368,3372,3373,3373,3373,3372,3370,3370,3369,3367,3365,3367,3367,3368,3372,3374,3376,3380,3384,3385,3386,3386,3385,3363,3361,3356,3354,3354,3355,3356,3357,3358,3358,3360,3360,3363,3367,3371,3375,3383,3384,3386,3381,3378,3377,3376,3363,3353,3358,3372,3373,3375,3369,3366,3357,3353,3356,3364,3368,3375,3375,3372,3372,3373,3374,3375,3377,3378,3377,3378,3376,3366,3363,3365,3367,3368,3370,3371,3374,3379,3381,3378,3373,3354,3353,3347,3345,3351,3353,3365,3369,3372,3377,3381,3381,3376,3370,3360,3359,3354,3351,3348,3350,3349,3352,3380,3388,3391,3392,3392,3392,3389,3376,3372,3362,3365,3368,3370,3381,3379,3375,3368,3350,3349,3347,3348,3351,3359,3365,3367,3366,3367,3368,3368,3366,3365,3358,3362,3361,3361,3360,3356,3356,3355,3356,3357,3360,3360,3353,3337,3338,3345,3353,3363,3369,3371,3382,3383,3373,3366,3352,3346,3353,3361,3368,3373,3373,3372,3367,3354,3334,3338,3346,3353,3356,3364,3366,3373,3373,3387,3390,3390,3367,3359,3347,3338,3339,3341,3337,3354,3359,3371,3376,3378,3376,3374,3357,3320,3323,3337,3353,3369,3377,3387,3403,3415,3414,3373,3367,3347,3350,3354,3360,3363,3370,3372,3372,3369,3353,3350,3338,3335,3334,3336,3349,3357,3374,3374,3377,3375,3352,3351,3355,3359,3368,3369,3368,3365,3340,3333,3355,3360,3361,3360,3358,3358,3356,3353,3343,3347,3361,3373,3381,3379,3377,3376,3374,3373,3366,3363,3344,3340,3340,3343,3347,3357,3364,3367,3366,3367,3366,3366,3366,3365,3365,3352,3351,3352,3354,3354,3356,3364],
      [3331,3330,3326,3325,3327,3333,3341,3346,3353,3359,3364,3367,3369,3371,3374,3375,3376,3371,3360,3357,3361,3363,3365,3370,3372,3372,3372,3371,3369,3369,3368,3366,3364,3364,3365,3367,3370,3372,3375,3377,3382,3384,3385,3385,3373,3362,3358,3354,3353,3353,3355,3356,3356,3357,3358,3359,3360,3361,3364,3367,3372,3375,3380,3381,3379,3377,3376,3367,3356,3352,3354,3364,3372,3371,3366,3362,3351,3350,3353,3360,3365,3371,3373,3371,3372,3372,3373,3374,3375,3377,3376,3376,3368,3362,3360,3364,3366,3367,3369,3370,3372,3374,3377,3374,3360,3352,3349,3345,3344,3348,3352,3356,3364,3370,3373,3378,3379,3372,3365,3359,3357,3352,3348,3347,3348,3348,3349,3367,3384,3387,3389,3389,3388,3378,3374,3359,3355,3363,3366,3368,3373,3374,3372,3355,3349,3348,3347,3348,3350,3352,3355,3359,3363,3366,3367,3365,3362,3362,3355,3357,3357,3356,3354,3356,3354,3354,3354,3356,3357,3355,3343,3336,3336,3339,3347,3353,3361,3365,3377,3378,3369,3361,3349,3344,3348,3358,3363,3369,3371,3370,3361,3337,3333,3336,3342,3350,3353,3361,3364,3369,3370,3372,3389,3372,3362,3353,3338,3337,3336,3336,3334,3337,3356,3365,3373,3375,3372,3361,3331,3317,3320,3328,3340,3361,3371,3382,3391,3399,3392,3370,3345,3343,3346,3350,3356,3361,3366,3371,3371,3364,3351,3348,3335,3334,3333,3334,3340,3350,3361,3371,3376,3353,3346,3348,3352,3356,3364,3366,3366,3361,3332,3329,3335,3358,3357,3359,3358,3357,3352,3347,3340,3342,3352,3367,3377,3378,3376,3375,3373,3368,3364,3350,3341,3339,3339,3341,3344,3352,3358,3364,3365,3365,3365,3365,3365,3365,3359,3351,3351,3351,3353,3353,3355,3361]
    ];

    // add gap
    data.forEach((d, si) => {
      if (si > 0) {
        for (let i = 35; i < 50; i++)
          d[i] = null;
      }
    });

    const opts = {
      title: "Scale range exceeds data range (zoom out)",
      width: 800,
      height: 400,
      scales: {
        x: {
          time: false,
          min: -16,
          max: data[0].at(-1) + 16,
        }
      },
      series: [
        {},
        {
          label: "Low",
          stroke: "green",
          band: true,
          spanGaps: false,
          //	points: {show: false},
        },
        {
          label: "High",
          stroke: "green",
          band: true,
          spanGaps: false,
          //	points: {show: false},
        }
      ],
      bands: [
        {
          show: true,
          series: [2, 1],
          //	values: null,
          fill: "rgba(0, 255, 0, .2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    const opts = {
      title: "Gaps in a band",
      width: 800,
      height: 400,
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          spanGaps: false,
        },
        {
          label: "High",
          stroke: "red",
          spanGaps: false,
        },
        {
          label: "Avg",
          stroke: "green",
          spanGaps: false,
        },
      ],
      bands: [
        {
          show: true,
          series: [2, 1],
          //	values: null,
          fill: "rgba(0, 255, 0, .2)",
        },
      ],
    };

    const data = [
      [1572679693.747, 1572679694.747, 1572679695.747, 1572679696.747, 1572679697.747, 1572679698.746, 1572679699.746],
      [9.5, 10.5, 11.5, null, 13.5, 14.5, 15.5],
      [10.5, 11.5, 12.5, null, 14.5, 15.5, 16.5],
      [10, 11, 12, 13, 14, 15, 16],
    ];

    return new uPlot(opts, data, document.body);
  },

  () => {
    let tables = [
      [
        [1607676419481, 1607680019481, 1607683619481, 1607687219481, 1607690819481, 1607694419481, 1607698019481, 1607698019482],
        [10, 20, 30, 40, 50, 60, 70, 90],
      ],
      [
        [1607676419481, 1607677962338, 1607679505195, 1607681048052, 1607682590909, 1607684133766, 1607685676623, 1607687219480, 1607688762337, 1607690305194, 1607691848051, 1607693390908, 1607694933765, 1607696476622, 1607698019479],
        [1, null, 40, null, 90, null, null, 100, null, null, 100, null, null, 80, null],
      ]
    ];

    let alignedData10 = uPlot.join(tables, tables.map(t => t.map(s => 2)));

    const opts10 = {
      width: 800,
      height: 400,
      title: 'Align & null-fill vs "real" null gaps',
      ms: 1,
      series: [
        {},
        {
          //	show: false,
          stroke: "red",
          fill: "rgba(255,0,0,0.1)",
          spanGaps: false,
        },
        {
          //	show: false,
          stroke: "green",
          fill: "rgba(0,255,0,0.1)",
          spanGaps: false,
        },
      ],
    };

    return new uPlot(opts10, alignedData10, document.body);
  },

  () => {
    let tables = [
      [
        [3, 5, 6, 7, 20],
        [2, 3, 4, 10, 5],
      ],
      [
        [1, 2, 3, 4, 5, 17],
        [7, 2, 1, null, 6, 13],
      ],
      [
        [9, 14, 15, 16],
        [9, 5, null, 1],
      ]
    ];

    let alignedData = uPlot.join(tables);

    const opts = {
      width: 800,
      height: 400,
      title: 'Align & null-fill vs "real" null gaps',
      scales: {
        x: {
          time: false,
        },
      },
      series: [
        {},
        {
          //	show: false,
          stroke: "red",
          fill: "rgba(255,0,0,0.1)",
          spanGaps: false,
        },
        {
          //	show: false,
          stroke: "green",
          fill: "rgba(0,255,0,0.1)",
          spanGaps: false,
        },
        {
          //	show: false,
          stroke: "blue",
          fill: "rgba(0,0,255,0.1)",
          spanGaps: false,
        },
      ],
    };

    return new uPlot(opts, alignedData, document.body);
  },

  () => {
    const opts = {
      title: "Gaps in stepped after",
      width: 800,
      height: 400,
      scales: {
        x: {
          time: false,
        }
      },
      series: [
        {},
        {
          label: "step after",
          stroke: "blue",
          fill: "rgba(0,0,255,0.3)",
          width: 2,
          paths: uPlot.paths.stepped({
            align: 1,
            //	ascDesc: true,
          }),
        },
        {
          label: "linear",
          stroke: "red",
          width: 2,
        },
        {
          label: "spline",
          stroke: "orange",
          width: 2,
          paths: uPlot.paths.spline(),
        },
      ],
    };

    return new uPlot(opts, data9, document.body);
  },

  () => {
    const opts = {
      title: "Gaps in stepped before",
      width: 800,
      height: 400,
      scales: {
        x: {
          time: false,
        }
      },
      series: [
        {},
        {
          label: "step before",
          stroke: "blue",
          fill: "rgba(0,0,255,0.3)",
          width: 2,
          paths: uPlot.paths.stepped({
            align: -1,
            //	ascDesc: true,
          }),
        },
        {
          label: "linear",
          stroke: "red",
          width: 2,
        },
        {
          label: "spline",
          stroke: "orange",
          width: 2,
          paths: uPlot.paths.spline(),
        },
      ],
    };

    return new uPlot(opts, data9, document.body);
  },

  () => {
    const opts = {
      title: "Gaps in stepped after",
      width: 800,
      height: 400,
      scales: {
        x: {
          time: false,
        }
      },
      series: [
        {},
        {
          label: "a",
          stroke: "blue",
          fill: "rgba(0,0,255,0.3)",
          width: 2,
          paths: uPlot.paths.stepped({ align: 1, alignGaps: 1 }),
        },
        {
          label: "b",
          stroke: "red",
          fill: "rgba(255,0,0,0.3)",
          width: 2,
          paths: uPlot.paths.stepped({ align: 1, alignGaps: 1 }),
        },
        {
          label: "c",
          stroke: "green",
          width: 2,
        },
        {
          label: "d",
          stroke: "yellow",
          width: 2,
        },
        {
          label: "e",
          stroke: "black",
          width: 2,
        },
      ],
    };

    return new uPlot(opts, data6, document.body);
  },

  () => {
    const opts = {
      title: "Gaps in stepped before",
      width: 800,
      height: 400,
      scales: {
        x: {
          time: false,
        }
      },
      series: [
        {},
        {
          label: "a",
          stroke: "blue",
          fill: "rgba(0,0,255,0.3)",
          width: 2,
          paths: uPlot.paths.stepped({ align: -1, alignGaps: -1 }),
        },
        {
          label: "b",
          stroke: "red",
          fill: "rgba(255,0,0,0.3)",
          width: 2,
          paths: uPlot.paths.stepped({ align: -1, alignGaps: -1 }),
        },
        {
          label: "c",
          stroke: "green",
          width: 2,
        },
        {
          label: "d",
          stroke: "yellow",
          width: 2,
        },
        {
          label: "e",
          stroke: "black",
          width: 2,
        },
      ],
    };

    return new uPlot(opts, data6, document.body);
  },

  () => {
    let data = data10.slice().map(vals => vals.slice());

    data[0][3] = 1578812550;

    const opts = {
      title: "Single-null pixel-outro bug test",
      width: 300,
      height: 400,
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = data10.slice().map(vals => vals.slice());

    data[0][3] = 1578812608;

    const opts = {
      title: "Single-null pixel-outro bug test",
      width: 300,
      height: 400,
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = data10.slice().map(vals => vals.slice());

    data[0][3] = 1578812550;

    const opts = {
      title: "Single-null pixel-outro bug test",
      width: 300,
      height: 400,
      scales: {
        x: {
          dir: -1,
        }
      },
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    let data = data10.slice().map(vals => vals.slice());

    data[0][3] = 1578812608;

    const opts = {
      title: "Single-null pixel-outro bug test",
      width: 300,
      height: 400,
      scales: {
        x: {
          dir: -1,
        }
      },
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts, data, document.body);
  },

  () => {
    const data5 = [
      [0, 1, 2, 3, 3.001, 5, 6, 7, 8, 9],
      [1, 1, 1, 1, _, 1, 1, 1, 1, 1],
    ];

    const opts5 = {
      title: "Single-null pixel-intro bug test",
      width: 500,
      height: 250,
      scales: {
        x: {
          time: false,
        }
      },
      axes: [
        {
          space: 30,
        }
      ],
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts5, data5, document.body);
  },

  () => {
    const data6 = [
      [0, 1, 2, 3, 4.999, 5, 6, 7, 8, 9],
      [1, 1, 1, 1, _, 1, 1, 1, 1, 1],
    ];

    const opts6 = {
      title: "Single-null pixel-intro bug test",
      width: 500,
      height: 250,
      scales: {
        x: {
          time: false,
        }
      },
      axes: [
        {
          space: 30,
        }
      ],
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts6, data6, document.body);
  },

  () => {
    const data7 = [
      [0, 1, 2, 3, 4.999, 5, 5.001, 7, 8, 9],
      [1, 1, 1, 1, _, 1, 1, 1, 1, 1],
    ];

    const opts7 = {
      title: "Single-null pixel-intro bug test",
      width: 500,
      height: 250,
      scales: {
        x: {
          time: false,
        }
      },
      axes: [
        {
          space: 30,
        }
      ],
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts7, data7, document.body);
  },


  () => {
    const data8 = [
      [0, 1, 2, 3, 4.999, 5, 5.001, 7, 8, 9],
      [1, 1, 1, 1, _, 1, _, 1, 1, 1],
    ];

    const opts8 = {
      title: "Single-null pixel-intro bug test",
      width: 500,
      height: 250,
      scales: {
        x: {
          time: false,
        }
      },
      axes: [
        {
          space: 30,
        }
      ],
      series: [
        {},
        {
          label: "Low",
          stroke: "red",
          fill: "rgba(255, 0, 0, .2)",
        },
      ],
    };

    return new uPlot(opts8, data8, document.body);
  },

  () => {
    let data99 = [
      //	[42000,71999,77999,78033,79800,92400,98400],
      [42000, 71999, 77999, 78000, 79800, 92400, 98400],
      [10, 20, null, 30, undefined, 40, undefined],
    ];

    let opts99 = {
      title: "Undefined",
      width: 600,
      height: 300,
      scales: {
        x: {
          time: false,
        }
      },
      series: [
        {},
        {
          show: true,
          spanGaps: false,
          stroke: "red",
        }
      ]
    };

    return new uPlot(opts99, data99, document.body);
  }
];


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