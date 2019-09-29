const fs = require('fs');

import buble from 'rollup-plugin-buble';
import { terser } from 'rollup-plugin-terser';

const pkg = JSON.parse(fs.readFileSync('./package.json', 'utf8'));
const ver = "v" + pkg.version;
const urlVer = "https://github.com/leeoniya/plotty (" + ver + ")";
const banner = [
	"/**",
	"* Copyright (c) " + new Date().getFullYear() + ", Leon Sorokin",
	"* All rights reserved. (MIT Licensed)",
	"*",
	"* plotty.js (Plotty)",
	"* An exceptionally fast, tiny time series chart",
	"* " + urlVer,
	"*/",
	"",
].join("\n");


export default [
	{
		input: './src/plotty.js',
		output: {
			name: 'Plotty',
			file: './dist/plotty.iife.js',
			format: 'iife',
			banner,
		},
		plugins: [
			buble({transforms: { stickyRegExp: false }})
		]
	},
	{
		input: './src/plotty.js',
		output: {
			name: 'Plotty',
			file: './dist/plotty.cjs.js',
			format: 'cjs',
			banner,
		},
		plugins: [
			buble({transforms: { stickyRegExp: false }})
		]
	},
	{
		input: './src/plotty.js',
		output: {
			name: 'Plotty',
			file: './dist/plotty.iife.min.js',
			format: 'iife',
			banner: "/*! " + urlVer + " */",
		},
		plugins: [
			buble({transforms: { stickyRegExp: false }}),
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