import { spikeData, adjacentSpikeData } from './decimation.js';

export const libraryCases = [
  {id: 'opposite', data: spikeData(false), detail: [4980, 5060]},
  {id: 'sparse', data: spikeData(true)},
  {id: 'adjacent', data: adjacentSpikeData(), detail: [4980, 5060]},
];

export function echartsOptions([xs, ys], sampled) {
  return {
    animation: false,

    xAxis: {type: 'value', min: xs[0], max: xs[xs.length - 1]},
    yAxis: {type: 'value', min: -120, max: 120},
    series: [{
      type: 'line',
      data: xs.map((x, i) => [x, ys[i]]),
      sampling: sampled ? 'lttb' : 'none',
      showSymbol: false,
      smooth: false,
      lineStyle: {width: 1, color: sampled ? 'red' : 'green'},
      emphasis: {disabled: true},
      silent: true,
    }],
  };
}

export function chartjsOptions([xs, ys], sampled) {
  return {
    type: 'line',
    data: {
      datasets: [{
        data: xs.map((x, i) => ({x, y: ys[i]})),
        borderColor: sampled ? 'red' : 'green',
        borderWidth: 1,
        pointRadius: 0,
        tension: 0,
        fill: false,
      }],
    },
    options: {
      animation: false,
      responsive: false,

      parsing: false,
      normalized: true,
      events: [],
      scales: {
        x: {type: 'linear', min: xs[0], max: xs[xs.length - 1]},
        y: {type: 'linear', min: -120, max: 120},
      },
      plugins: {
        legend: {display: false},
        tooltip: {enabled: false},
        decimation: {
          enabled: sampled,
          algorithm: 'lttb',

        },
      },
    },
  };
}

// These are the processed series, not getOption()'s original input data.
export function echartsSelected(chart) {
  const data = chart.getModel().getSeriesByIndex(0).getData();
  const xDim = data.mapDimension('x');
  const yDim = data.mapDimension('y');
  return Array.from({length: data.count()}, (_, i) => [data.get(xDim, i), data.get(yDim, i)]);
}

function showResult(figure, points, detail, sampled, pixelRatio) {
  const ys = points.map(point => point[1]);
  figure.querySelector('output').textContent = `${points.length.toLocaleString('en-US')} samples; ` +
    `+100: ${ys.filter(y => y === 100).length}, -100: ${ys.filter(y => y === -100).length}; DPR: ${pixelRatio}`;

  if (!detail)
    return;

  // Magnify the already-selected polyline. A chart zoom can change LTTB buckets
  // or disable decimation, hiding the very loss this detail view must show.
  const canvas = figure.querySelector('.detail');
  const ctx = canvas.getContext('2d');
  const [min, max] = detail;
  const xPos = x => 40 + (x - min) / (max - min) * (canvas.width - 60);
  const yPos = y => 10 + (120 - y) / 240 * (canvas.height - 30);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = '#ccc';
  ctx.beginPath();
  ctx.moveTo(40, yPos(0));
  ctx.lineTo(canvas.width - 20, yPos(0));
  ctx.stroke();
  ctx.fillStyle = '#555';
  ctx.font = '12px sans-serif';
  ctx.fillText(min, 40, canvas.height - 2);
  ctx.fillText(max, canvas.width - 50, canvas.height - 2);
  ctx.fillText('+100', 0, yPos(100) + 4);
  ctx.fillText('-100', 0, yPos(-100) + 4);
  ctx.save();
  ctx.beginPath();
  ctx.rect(40, 0, canvas.width - 60, canvas.height - 20);
  ctx.clip();
  ctx.strokeStyle = sampled ? 'red' : 'green';
  ctx.beginPath();
  points.forEach(([x, y], i) => {
    if (i === 0)
      ctx.moveTo(xPos(x), yPos(y));
    else
      ctx.lineTo(xPos(x), yPos(y));
  });
  ctx.stroke();
  ctx.restore();
}

export function renderLibraryComparisons(library, lib) {
  for (const {id, data, detail} of libraryCases) {
    for (const sampled of [false, true]) {
      const figure = document.getElementById(`${library}-${id}-${sampled ? 'lttb' : 'raw'}`);
      let points, pixelRatio;

      if (library === 'echarts') {
        const chart = lib.init(figure.querySelector('.chart'));
        chart.setOption(echartsOptions(data, sampled));
        points = echartsSelected(chart);
        pixelRatio = chart.getDevicePixelRatio();
      }
      else {
        const chart = new lib(figure.querySelector('.chart'), chartjsOptions(data, sampled));
        points = chart.data.datasets[0].data.map(({x, y}) => [x, y]);
        pixelRatio = chart.currentDevicePixelRatio;
      }

      showResult(figure, points, detail, sampled, pixelRatio);
    }
  }
}
