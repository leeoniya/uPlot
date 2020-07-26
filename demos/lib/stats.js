// ported from https://stackoverflow.com/questions/14683467/finding-the-first-and-third-quartiles/51264621#51264621
function percentile(arr, p) {
	// algo derived from Aczel pg 15 bottom
	if (p >= 1)
		return arr[arr.length - 1];

	let left = 0,
		right = 0;

	let n =   p * (arr.length - 1) + 1;

	let pos = p * (arr.length + 1);

	if (pos >= 1) {
		left  = arr[Math.floor(n) - 1];
		right = arr[Math.floor(n)];
	}
	else {
		left = arr[0];
		right = arr[1];
	}

	if (left == right)
		return left;

	let part = n - Math.floor(n);

	return left + part * (right - left);
}

function geoMean(arr) {
	let logSum = arr.reduce((acc, val) => acc + Math.log(val), 0);
	return Math.exp(logSum / arr.length);
}

function stats(arr) {
	arr = arr.slice().sort((a,b) => a-b);
	var n = arr.length;
	var sum = arr.reduce((acc, val) => acc + val, 0);
//	var prod = arr.reduce((acc, val) => acc * val, 1);
	var amean = sum / n;
//	var gmean = Math.pow(prod, 1 / n);
	var gmean = geoMean(arr);
//	var median = n % 2 === 0 ? (arr[n / 2 - 1] + arr[n / 2]) / 2 : arr[(n - 1) / 2];
	var median = percentile(arr, 0.5);
	var q1 = percentile(arr, 0.25);
	var q3 = percentile(arr, 0.75);
	var variance = 0;
	var stddev = 0;

	var v1 = 0,
		v2 = 0;

	for (var i = 0; i < n; i++) {
		var dMean = arr[i] - amean;
		v1 += Math.pow(dMean, 2);
		v2 += dMean;
	}

	v2 *= v2 / n;
	variance = Math.max((v1 - v2) / (n - 1), 0);
	stddev = Math.sqrt(variance);

	return {
		count: n,
		min: Math.min.apply(Math, arr),
		max: Math.max.apply(Math, arr),
		sum: +sum.toFixed(2),
		median: +median.toFixed(2),
		q1: +q1.toFixed(2),
		q3: +q3.toFixed(2),
	//	iq: +(q3 - q1).toFixed(2),
		amean: +amean.toFixed(2),
		gmean: +gmean.toFixed(2),
		variance: +variance.toFixed(2),
		stddev: +stddev.toFixed(2),
	};
}