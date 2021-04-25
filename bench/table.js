const fs = require('fs');

const results = JSON.parse(fs.readFileSync("results.json"));

/*
// sort results by js,rend,paint,sys
results.sort((a, b) => {
	return (a[3][0] + a[3][1] + a[3][2] + a[3][3]) - (b[3][0] + b[3][1] + b[3][2] + b[3][3]);
});
*/

const heads = [
	"lib",
	"size",
	"done",
	"js,rend,paint,sys",
	"heap peak,final",
	"mousemove (10s)",
];

function padRight(str, padStr, len) {
	str += "";
	return str + padStr.repeat(len - str.length);
}

function padLeft(str, padStr, len) {
	str += "";
	return padStr.repeat(len - str.length) + str;
}

const widths = heads.map(h => h.length);

const texts = results.map((res, i) => {
	let out = [
		res[0],
		padLeft(res[1], " ", 4) + " KB",
		padLeft(res[2] == null ? '---' : res[2], " ", 4) + " ms",
		res[3].map((v, i) =>
			i == 0 || i == 3 ? padLeft(Math.round(v / 10), " ", 4) :
			padLeft(Math.round(v / 10), " ", 3)
		).join(" "),
		res[4].map(v => padLeft(Math.round(v), " ", 3)).join(" MB ") + " MB",
		res[5] == null ? '---' : res[5].map(v => padLeft(Math.round(v), " ", 4)).join(" "),
	];

	widths.forEach((w, i) => {
		widths[i] = Math.max(w, out[i].length);
	});

	return out;
});

let table = '';

widths.forEach((w, i) => {
	table += "| " + padRight(heads[i], " ", widths[i] + 1);
});
table += "|\n";

widths.forEach((w, i) => {
	table += "| " + padRight("", "-", widths[i]) + " ";
});
table += "|\n";

texts.forEach((res, i) => {
	widths.forEach((w, i) => {
		table += "| " + padRight(res[i], " ", widths[i] + 1);
	});

	table += "|\n";
});

texts.forEach((res, i) => {
	table = table.replace(" " + res[0], ` <a href="https://leeoniya.github.io/uPlot/bench/${res[0]}.html">${res[0]}</a>`);
});

fs.writeFileSync("table.md", table, 'utf8');