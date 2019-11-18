import {
	WIDTH,
	HEIGHT,
	firstChild,
	nextSibling,
	createElement,
	classList,
} from './strings';

import {
	round,
} from './utils';

export const rAF = requestAnimationFrame;
export const doc = document;
export const win = window;
export const pxRatio = devicePixelRatio;

export function addClass(el, c) {
	el[classList].add(c);
}

export function remClass(el, c) {
	el[classList].remove(c);
}

export function setStylePx(el, name, value) {
	el.style[name] = value + "px";
}

export function setOriRotTrans(style, origin, rot, trans) {
	style.transformOrigin = origin;
	style.transform = "rotate(" + rot + "deg) translateY(" + trans + "px)";
}

export function makeCanvas(wid, hgt) {
	const can = doc[createElement]("canvas");
	const ctx = can.getContext("2d");

	can[WIDTH] = round(wid * pxRatio);
	can[HEIGHT] = round(hgt * pxRatio);
	setStylePx(can, WIDTH, wid);
	setStylePx(can, HEIGHT, hgt);

	return {
		can,
		ctx,
	};
}

export function placeDiv(cls, targ) {
	let div = doc[createElement]("div");

	if (cls != null)
		addClass(div, cls);

	if (targ != null)
		targ.appendChild(div);

	return div;
}

export function clearFrom(ch) {
	let next;
	while (next = ch[nextSibling])
		next.remove();
	ch.remove();
}

export function trans(el, xPos, yPos) {
	el.style.transform = "translate(" + xPos + "px," + yPos + "px)";
}

const evOpts = {passive: true};

export function on(ev, el, cb) {
	el.addEventListener(ev, cb, evOpts);
}

export function off(ev, el, cb) {
	el.removeEventListener(ev, cb, evOpts);
}