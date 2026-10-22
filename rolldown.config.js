import fs from 'node:fs';

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

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const ver = "v" + pkg.version;
const urlVer = "https://github.com/leeoniya/uPlot (" + ver + ")";

const banner = [
	"/**",
	"* Copyright (c) " + new Date().getFullYear() + ", Leon Sorokin",
	"* All rights reserved. (MIT Licensed)",
	"*",
	"* uPlot.js (μPlot)",
	"* A small, fast chart for time series, lines, areas, ohlc & bars",
	"* " + urlVer,
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

const minifyOpts = {
	compress: {
		target: 'es2022',
		treeshake: { propertyReadSideEffects: false },
	},
	mangle: { toplevel: false, reserved: ['uPlot'] },
	codegen: { removeWhitespace: true, legalComments: 'inline' },
};

export default [
	{
		input: './src/uPlot.js',
		output: {
			name: 'uPlot',
			file: './dist/uPlot.esm.js',
			format: 'es',
			minify: false,
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
			minify: false,
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
			minify: false,
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
			banner: "/*! " + urlVer + " */",
			minify: minifyOpts,
			comments: { legal: true, annotation: false, jsdoc: false },
		},
		plugins: [
			bannerlessESM(),
			trimTrailingWhitespace(),
		]
	},
];