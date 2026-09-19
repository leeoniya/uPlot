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
fs.writeFileSync('./dist/uPlot.min.css', minicss);

import terser from '@rollup/plugin-terser';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const ver = "v" + pkg.version;
const urlVer = "https://github.com/leeoniya/uPlot (" + ver + ")";
const iviUrl = "https://github.com/localvoid/ivi";

const banner = [
	"/**",
	"* Copyright (c) " + new Date().getFullYear() + ", Leon Sorokin",
	"* All rights reserved. (MIT Licensed)",
	"*",
	"* uPlot.js (μPlot)",
	"* A small, fast chart for time series, lines, areas, ohlc & bars",
	"* " + urlVer,
	"* " + iviUrl,
	"*/",
	"",
].join("\n");

function trimTrailingWhitespace() {
	return {
		name: 'trimTrailingWhitespace',
		generateBundle(opts, bundle) {
			for (let file in bundle) {
				let chunk = bundle[file];
				if (chunk.type == 'chunk')
					chunk.code = chunk.code.replace(/[ \t]+$/gm, '');
			}
		},
	};
}

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
				return fs.readFileSync('./dist/uPlot.esm.js', 'utf8')
									.replace(/\/\*\*.*?\*\//gms, '');
			return null;
		}
	};
}

const terserOpts = {
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
};

export default [
	{
		input: './src/uPlot.js',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.esm.js',
			format: 'es',
			banner,
		//	sourcemap: true,
		},
	},
	{
		input: './src/uPlot.js',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.cjs.js',
			format: 'cjs',
			exports: "auto",
			banner,
		},
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
			trimTrailingWhitespace(),
		]
	},
	{
		input: 'uPlot',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.iife.min.js',
			format: 'iife',
			esModule: false,
			banner: "/*! " + urlVer + " */\n/*! " + iviUrl + " */",
		},
		plugins: [
			bannerlessESM(),
			terser(terserOpts),
			trimTrailingWhitespace(),
		]
	},
];