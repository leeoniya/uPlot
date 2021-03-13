function smooth(data, resolution) {
    if (resolution < data.length) {
        data = SMA(data, Math.trunc(data.length / resolution),
            Math.trunc(data.length / resolution));
    }
    var metrics = new Metrics(data);
    var originalKurt = metrics.kurtosis();
    var minObj = metrics.roughness();
    var windowSize = 1;
    for (var w = Math.round(data.length / 10);
            w >= 2; w -=1) {
        var smoothed = SMA(data, w, 1);
        metrics = new Metrics(smoothed);
        var roughness = metrics.roughness();
        if (roughness < minObj) {
            if (metrics.kurtosis() >= originalKurt) {
                minObj = roughness;
                windowSize = w;
            }
        }
    }
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