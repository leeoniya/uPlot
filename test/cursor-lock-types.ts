// Compile-only regression: tsc --strict --noEmit --target es2020 --module nodenext test/cursor-lock-types.ts
import uPlot from '../dist/uPlot.js';

declare const u: uPlot;

const locked: boolean | undefined = u.cursor._lock;

if (!u.cursor._lock) {
	u.cursor._lock = true;
}

const opts: uPlot.Cursor = {
	lock: true,
};
