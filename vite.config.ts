import { readFileSync, writeFileSync } from "node:fs";
import { defineConfig } from "vite-plus";
import type { PackUserConfig } from "vite-plus/pack";

const pkg = JSON.parse(readFileSync("./package.json", "utf8"));
const urlVer = "https://github.com/leeoniya/uPlot (v" + pkg.version + ")";

const banner = [
	"/**",
	"* Copyright (c) " + new Date().getFullYear() + ", Leon Sorokin",
	"* All rights reserved. (MIT Licensed)",
	"*",
	"* uPlot.js (μPlot)",
	"* A small, fast chart for time series, lines, areas, ohlc & bars",
	"* " + urlVer,
	"*/",
].join("\n");

function cssmin(css: string) {
	return css
		.replace(/\s{1,}/g, " ")
		.replace(/\{\s{1,}/g, "{")
		.replace(/\}\s{1,}/g, "}")
		.replace(/;\s{1,}/g, ";")
		.replace(/\/\*\s{1,}/g, "/*")
		.replace(/\*\/\s{1,}/g, "*/");
}

const staticAssets = {
	name: "uplot-static-assets",
	buildStart() {
		writeFileSync("./dist/uPlot.min.css", cssmin(readFileSync("./src/uPlot.css", "utf8")));

		// CommonJS typings for require("uplot"), derived from the hand-written ESM typings
		let dts = readFileSync("./dist/uPlot.d.ts", "utf8");
		writeFileSync("./dist/uPlot.d.cts", dts.replace(/^export default uPlot;$/m, "export = uPlot;"));
	},
};

const trimTrailingWhitespace = {
	name: "uplot-trim-trailing-whitespace",
	renderChunk: (code: string) => code.replace(/[ \t]+$/gm, ""),
};

function lib(
	format: "esm" | "cjs" | "iife",
	file: string,
	opts: Partial<PackUserConfig> = {},
): PackUserConfig {
	return {
		entry: { uPlot: "./src/uPlot.js" },
		format,
		platform: "browser",
		target: false,
		outDir: "./dist",
		// dist also contains the hand-written uPlot.d.ts
		clean: false,
		dts: false,
		hash: false,
		globalName: "uPlot",
		banner,
		plugins: [trimTrailingWhitespace],
		// ESM is implicitly strict; rollup emitted "use strict" for cjs & iife
		outputOptions: { entryFileNames: file, exports: "auto", strict: true },
		...opts,
	};
}

export default defineConfig({
	pack: [
		lib("esm", "uPlot.esm.js", { plugins: [staticAssets, trimTrailingWhitespace] }),
		// .cjs, since package.json has "type": "module"
		lib("cjs", "uPlot.cjs"),
		lib("iife", "uPlot.iife.js"),
		lib("iife", "uPlot.iife.min.js", { minify: true, banner: "/*! " + urlVer + " */" }),
	],
	fmt: {},
	lint: {
		jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
		rules: { "vite-plus/prefer-vite-plus-imports": "error" },
		options: { typeAware: true, typeCheck: true },
	},
});
