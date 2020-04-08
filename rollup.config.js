const fs = require('fs');

function cssmin(css) {
	return css
		.replace(/\s{1,}/g, ' ')
		.replace(/\{\s{1,}/g,"{")
		.replace(/\}\s{1,}/g,"}")
		.replace(/\;\s{1,}/g,";")
		.replace(/\/\*\s{1,}/g,"/*")
		.replace(/\*\/\s{1,}/g,"*/");
}

let minicss = cssmin(fs.readFileSync('./src/uPlot.css', 'utf8'));
fs.mkdirSync("./dist", { recursive: true });
fs.writeFileSync('./dist/uPlot.min.css', minicss);

import buble from 'rollup-plugin-buble';
import replace from 'rollup-plugin-replace';
import { terser } from 'rollup-plugin-terser';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const ver = "v" + pkg.version;
const urlVer = "https://github.com/leeoniya/uPlot (" + ver + ")";
const banner = [
	"/**",
	"* Copyright (c) " + new Date().getFullYear() + ", Leon Sorokin",
	"* All rights reserved. (MIT Licensed)",
	"*",
	"* uPlot.js (μPlot)",
	"* An exceptionally fast, tiny time series chart",
	"* " + urlVer,
	"*/",
	"",
].join("\n");

function bannerlessESM() {
	return {
		name: 'stripBanner',
		resolveId(importee) {
			if (importee == 'uPlot')
				return importee;
			return null;
		},
		load(id) {
			if (id == 'uPlot')
				return fs.readFileSync('./dist/uPlot.esm.js', 'utf8').replace(/\/\*\*.*?\*\//gms, '');
			return null;
		}
	};
}

const FEATS = {
	FEAT_TIME: true,
	FEAT_CURSOR: true,
	FEAT_LEGEND: true,
	FEAT_PATHS: true,
	FEAT_POINTS: true,
//	FEAT_GAPS: false,
};

export default [
	{
		input: './src/uPlot.js',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.esm.js',
			format: 'es',
			esModule: false,
			banner,
		},
		plugins: [
			replace(FEATS),
		]
	},
	{
		input: 'uPlot',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.iife.js',
			format: 'iife',
			esModule: false,
			banner,
		},
		plugins: [
			bannerlessESM(),
			replace(FEATS),
			buble(),
		]
	},
	{
		input: 'uPlot',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.cjs.js',
			format: 'cjs',
			esModule: false,
			banner,
		},
		plugins: [
			bannerlessESM(),
			replace(FEATS),
			buble(),
		]
	},
	{
		input: 'uPlot',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.iife.min.js',
			format: 'iife',
			esModule: false,
			banner: "/*! " + urlVer + " */",
		},
		plugins: [
			bannerlessESM(),
			replace(FEATS),
			buble(),
			terser({
				compress: {
					inline: 0,
					passes: 2,
					keep_fargs: false,
					pure_getters: true,
					unsafe: true,
					unsafe_comps: true,
					unsafe_math: true,
					unsafe_undefined: true,
				},
				output: {
					comments: /^!/
				}
			}),
		]
	},
];
