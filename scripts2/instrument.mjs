// console.time('mock-dom');

import { GlobalRegistrator } from '@happy-dom/global-registrator';

GlobalRegistrator.register({ width: 1920, height: 1080 });

function defProp(obj, name, rest) {
  Object.defineProperty(obj, name, {
    enumerable: false,
    ...rest,
  });

  return obj;
}

function getMock(meths = [], props = []) {
  const log = [];
  const out = { log };

  let last = [null];

  meths.forEach(name => {
    defProp(out, name, {
      value: (...args) => {
        // console.log(name, args);

        if (name !== last[0])
          log.push(last = [name, args]);
        else
          last.push(args);
      }
    });
  });

  props.forEach(name => {
    defProp(out, name, {
      set: val => {
        // console.log(name, val);

        if (name !== last[0])
          log.push(last = [name, val]);
        else
          last.push(val);
      },
    });
  });

  return out;
}

const CanProto = HTMLCanvasElement.prototype;
const widthProp = Object.getOwnPropertyDescriptor(CanProto, 'width');
const heightProp = Object.getOwnPropertyDescriptor(CanProto, 'height');

CanProto.getContext = function() {
  if (this.ctx != null)
    return this.ctx;

  const mock = getMock(
    ['clearRect', 'fillText', 'translate', 'rotate', 'setLineDash', 'beginPath', 'moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'stroke', 'fill', 'save', 'restore', 'clip', 'fillRect', 'arc', 'arcTo'],
    ['strokeStyle', 'fillStyle', 'lineWidth', 'font', 'textAlign', 'textBaseline', 'lineJoin', 'lineCap'],
  );

  mock.width = 0;
  mock.height = 0;

  Object.defineProperties(this, {
    ctx: {
      value: mock,
      enumerable: false,
      writable: false,
      configurable: false,
    },
    width: {
      ...widthProp,
      set(val) {
        widthProp.set.call(this, mock.width = val);
      }
    },
    height: {
      ...heightProp,
      set(val) {
        heightProp.set.call(this, mock.height = val);
      }
    },
  });

  return mock;
};

global.Path2D = function() {
  return getMock(['moveTo', 'lineTo', 'bezierCurveTo', 'quadraticCurveTo', 'rect', 'arc', 'arcTo', 'ellipse', 'roundRect', 'closePath', 'addPath']);
};

// console.timeEnd('mock-dom');
