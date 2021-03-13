/* 
 * Free FFT and convolution (JavaScript)
 * 
 * Copyright (c) 2014 Project Nayuki
 * https://www.nayuki.io/page/free-small-fft-in-multiple-languages
 * 
 * (MIT License)
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

"use strict";


/* 
 * Computes the discrete Fourier transform (DFT) of the given complex vector, storing the result back into the vector.
 * The vector can have any length. This is a wrapper function.
 */
function transform(real, imag) {
    if (real.length != imag.length)
        throw "Mismatched lengths";
    
    var n = real.length;
    if (n == 0)
        return;
    else if ((n & (n - 1)) == 0)  // Is power of 2
        transformRadix2(real, imag);
    else  // More complicated algorithm for arbitrary sizes
        transformBluestein(real, imag);
}


/* 
 * Computes the inverse discrete Fourier transform (IDFT) of the given complex vector, storing the result back into the vector.
 * The vector can have any length. This is a wrapper function. This transform does not perform scaling, so the inverse is not a true inverse.
 */
function inverseTransform(real, imag) {
    transform(imag, real);
}


/* 
 * Computes the discrete Fourier transform (DFT) of the given complex vector, storing the result back into the vector.
 * The vector's length must be a power of 2. Uses the Cooley-Tukey decimation-in-time radix-2 algorithm.
 */
function transformRadix2(real, imag) {
    // Initialization
    if (real.length != imag.length)
        throw "Mismatched lengths";
    var n = real.length;
    if (n == 1)  // Trivial transform
        return;
    var levels = -1;
    for (var i = 0; i < 32; i++) {
        if (1 << i == n)
            levels = i;  // Equal to log2(n)
    }
    if (levels == -1)
        throw "Length is not a power of 2";
    var cosTable = new Array(n / 2);
    var sinTable = new Array(n / 2);
    for (var i = 0; i < n / 2; i++) {
        cosTable[i] = Math.cos(2 * Math.PI * i / n);
        sinTable[i] = Math.sin(2 * Math.PI * i / n);
    }

    // Bit-reversed addressing permutation
    for (var i = 0; i < n; i++) {
        var j = reverseBits(i, levels);
        if (j > i) {
            var temp = real[i];
            real[i] = real[j];
            real[j] = temp;
            temp = imag[i];
            imag[i] = imag[j];
            imag[j] = temp;
        }
    }

    // Cooley-Tukey decimation-in-time radix-2 FFT
    for (var size = 2; size <= n; size *= 2) {
        var halfsize = size / 2;
        var tablestep = n / size;
        for (var i = 0; i < n; i += size) {
            for (var j = i, k = 0; j < i + halfsize; j++, k += tablestep) {
                var tpre =  real[j+halfsize] * cosTable[k] + imag[j+halfsize] * sinTable[k];
                var tpim = -real[j+halfsize] * sinTable[k] + imag[j+halfsize] * cosTable[k];
                real[j + halfsize] = real[j] - tpre;
                imag[j + halfsize] = imag[j] - tpim;
                real[j] += tpre;
                imag[j] += tpim;
            }
        }
    }

    // Returns the integer whose value is the reverse of the lowest 'bits' bits of the integer 'x'.
    function reverseBits(x, bits) {
        var y = 0;
        for (var i = 0; i < bits; i++) {
            y = (y << 1) | (x & 1);
            x >>>= 1;
        }
        return y;
    }
}


/*
 * Computes the discrete Fourier transform (DFT) of the given complex vector, storing the result back into the vector.
 * The vector can have any length. This requires the convolution function, which in turn requires the radix-2 FFT function.
 * Uses Bluestein's chirp z-transform algorithm.
 */
function transformBluestein(real, imag) {
    // Find a power-of-2 convolution length m such that m >= n * 2 + 1
    if (real.length != imag.length)
        throw "Mismatched lengths";
    var n = real.length;
    var m = 1;
    while (m < n * 2 + 1)
        m *= 2;

    // Trignometric tables
    var cosTable = new Array(n);
    var sinTable = new Array(n);
    for (var i = 0; i < n; i++) {
        var j = i * i % (n * 2);  // This is more accurate than j = i * i
        cosTable[i] = Math.cos(Math.PI * j / n);
        sinTable[i] = Math.sin(Math.PI * j / n);
    }

    // Temporary vectors and preprocessing
    var areal = new Array(m);
    var aimag = new Array(m);
    for (var i = 0; i < n; i++) {
        areal[i] =  real[i] * cosTable[i] + imag[i] * sinTable[i];
        aimag[i] = -real[i] * sinTable[i] + imag[i] * cosTable[i];
    }
    for (var i = n; i < m; i++)
        areal[i] = aimag[i] = 0;
    var breal = new Array(m);
    var bimag = new Array(m);
    breal[0] = cosTable[0];
    bimag[0] = sinTable[0];
    for (var i = 1; i < n; i++) {
        breal[i] = breal[m - i] = cosTable[i];
        bimag[i] = bimag[m - i] = sinTable[i];
    }
    for (var i = n; i <= m - n; i++)
        breal[i] = bimag[i] = 0;

    // Convolution
    var creal = new Array(m);
    var cimag = new Array(m);
    convolveComplex(areal, aimag, breal, bimag, creal, cimag);

    // Postprocessing
    for (var i = 0; i < n; i++) {
        real[i] =  creal[i] * cosTable[i] + cimag[i] * sinTable[i];
        imag[i] = -creal[i] * sinTable[i] + cimag[i] * cosTable[i];
    }
}


/*
 * Computes the circular convolution of the given real vectors. Each vector's length must be the same.
 */
function convolveReal(x, y, out) {
    if (x.length != y.length || x.length != out.length)
        throw "Mismatched lengths";
    var zeros = new Array(x.length);
    for (var i = 0; i < zeros.length; i++)
        zeros[i] = 0;
    convolveComplex(x, zeros, y, zeros.slice(), out, zeros.slice());
}


/*
 * Computes the circular convolution of the given complex vectors. Each vector's length must be the same.
 */
function convolveComplex(xreal, ximag, yreal, yimag, outreal, outimag) {
    if (xreal.length != ximag.length || xreal.length != yreal.length || yreal.length != yimag.length || xreal.length != outreal.length || outreal.length != outimag.length)
        throw "Mismatched lengths";

    var n = xreal.length;
    xreal = xreal.slice();
    ximag = ximag.slice();
    yreal = yreal.slice();
    yimag = yimag.slice();

    transform(xreal, ximag);
    transform(yreal, yimag);
    for (var i = 0; i < n; i++) {
        var temp = xreal[i] * yreal[i] - ximag[i] * yimag[i];
        ximag[i] = ximag[i] * yreal[i] + xreal[i] * yimag[i];
        xreal[i] = temp;
    }
    inverseTransform(xreal, ximag);
    for (var i = 0; i < n; i++) {  // Scaling (because this FFT implementation omits it)
        outreal[i] = xreal[i] / n;
        outimag[i] = ximag[i] / n;
    }
}

/**********************************************************************************/

function binarySearch(head, tail, data, minObj, originalKurt, windowSize) {
    while (head <= tail) {
        var w = Math.round((head + tail) / 2);
        var smoothed = SMA(data, w, 1);
        var metrics = new Metrics(smoothed);
        if (metrics.kurtosis() >= originalKurt) { /* Search second half if feasible */
            var roughness = metrics.roughness();
            if (roughness < minObj) {
                windowSize = w;
                minObj = roughness;
            }
            head = w + 1;
        } else { /* Search first half */
            tail = w - 1;
        }
    }
    return windowSize;
}


function smooth(data, resolution) {
    /* Ignore the last value if it's NaN */
    if (isNaN(data[data.length-1])) {
        data = data.slice(0, -1);
    }
    if (data.length >= 2 * resolution ) {
        data = SMA(data, Math.trunc(data.length / resolution),
            Math.trunc(data.length / resolution));
    }
    var acf = new ACF(data, Math.round(data.length / 10));
    var peaks = acf.findPeaks();
    var metrics = new Metrics(data);
    var originalKurt = metrics.kurtosis();
    var minObj = metrics.roughness();
    var windowSize = 1;
    var lb = 1;
    var largestFeasible = -1;
    var tail = data.length / 10;
    for (var i = peaks.length - 1; i >= 0; i -=1) {
        var w = peaks[i];
        if (w < lb || w == 1) {
            break;
        } else if (Math.sqrt(1 - acf.correlations[w]) * windowSize >
            Math.sqrt(1 - acf.correlations[windowSize]) * w) {
            continue;
        }
        var smoothed = SMA(data, w, 1);
        metrics = new Metrics(smoothed);
        var roughness = metrics.roughness();
        if (metrics.kurtosis() >= originalKurt) {
            if (roughness < minObj) {
                minObj = roughness;
                windowSize = w;
            }
            lb = Math.round(Math.max(w * Math.sqrt((acf.maxACF - 1) / (acf.correlations[w] - 1)), lb));
            if (largestFeasible < 0) { largestFeasible = i; }
        }
    }
    if (largestFeasible > 0) {
        if (largestFeasible < peaks.length - 2) { tail = peaks[largestFeasible + 1]; }
        lb = Math.max(lb, peaks[largestFeasible] + 1);
    }
    windowSize = binarySearch(lb, tail, data, minObj, originalKurt, windowSize);

    return SMA(data, windowSize, 1);
}


function SMA(data, range, slide) {
    var windowStart = 0;
    var sum = 0;
    var count = 0;
    var values = [];

    for (var i = 0; i < data.length; i ++) {
        if (isNaN(data[i])) { data[i] = 0; }
        if (i - windowStart >= range) {
            values.push(sum / count);
            var oldStart = windowStart;
            while (windowStart < data.length && windowStart - oldStart < slide) {
                sum -= data[windowStart];
                count -= 1;
                windowStart += 1;
            }
        }
        sum += data[i];
        count += 1;
    }
    if (count == range) {
        values.push(sum / count);
    }
    return values;
}

class ACF {
    constructor(values, maxLag) {
        this.mean = Metrics.mean(values);
        this.values = values;
        this.correlations = new Array(maxLag);
        this.CORR_THRESH = 0.2;
        this.maxACF = 0;
        this.calculate();
    }

    calculate() {
        /* Padding to the closest power of 2 */
        var len = Math.pow(2, Math.trunc(Math.log2(this.values.length)) + 1)
        var fftreal = new Array(len).fill(0);
        var fftimg = new Array(len).fill(0);
        for (var i = 0; i < this.values.length; i += 1) {
            fftreal[i] = this.values[i] - this.mean;
        }
        /* F_R(f) = FFT(X) */
        transform(fftreal, fftimg);
        /* S(f) = F_R(f)F_R*(f) */
        for (var i = 0; i < fftreal.length; i += 1) {
            fftreal[i] = Math.pow(fftreal[i], 2) + Math.pow(fftimg[i], 2);
            fftimg[i] = 0;
        }
        /*  R(t) = IFFT(S(f)) */
        inverseTransform(fftreal, fftimg);
        for (var i = 1; i < this.correlations.length; i += 1) {
            this.correlations[i] = fftreal[i] / fftreal[0];
        }
    }

    findPeaks() {
        var peakIndices = [];
        if (this.correlations.length > 1) {
            var positive = this.correlations[1] > this.correlations[0];
            var max = 1;
            for (var i = 2; i < this.correlations.length; i += 1) {
                if (!positive && this.correlations[i] > this.correlations[i - 1]) {
                    max = i;
                    positive = !positive;
                } else if (positive && this.correlations[i] > this.correlations[max]) {
                    max = i;
                } else if (positive && this.correlations[i] < this.correlations[i - 1]) {
                    if (max > 1 && this.correlations[max] > this.CORR_THRESH) {
                        peakIndices.push(max);
                        if (this.correlations[max] > this.maxACF) {
                            this.maxACF = this.correlations[max];
                        }
                    }
                    positive = !positive;
                }
            }
        }
        /* If there is no autocorrelation peak within the MAX_WINDOW boundary,
        # try windows from the largest to the smallest */
        if (peakIndices.length <= 1) {
            for (var i = 2; i < this.correlations.length; i += 1) {
                peakIndices.push(i);
            }
        }
        return peakIndices;
    }
}

class Metrics {
    constructor(values) {
        this.len = values.length;
        this.values = values;
        this.m = Metrics.mean(values);
    }

    static mean(values) {
        var m = 0;
        for (var i = 0; i < values.length; i += 1) {
            m += values[i];
        }
        return m / values.length;
    }

    static std(values) {
        var m = Metrics.mean(values);
        var std = 0;
        for (var i = 0; i < values.length; i += 1) {
            std += Math.pow((values[i] - m), 2);
        }
        return Math.sqrt(std / values.length);
    }

    kurtosis() {
        var u4 = 0, variance = 0;
        for (var i = 0; i < this.len; i ++) {
            u4 += Math.pow((this.values[i] - this.m), 4);
            variance += Math.pow((this.values[i] - this.m), 2);
        }
        return this.len * u4 / Math.pow(variance, 2);
    }

    roughness() {
        return Metrics.std(this.diffs());
    }

    diffs() {
         var diff = new Array(this.len - 1);
         for (var i = 1; i < this.len; i += 1) {
            diff[i - 1] = this.values[i] - this.values[i - 1];
         }
         return diff;
    }
}
