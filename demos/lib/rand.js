// gaussian (normal) random with optional skew
// https://stackoverflow.com/a/49434653/973988
function randn_bm(min, max, skew) {
	skew = skew || 1;
	let u = 0, v = 0;
	while(u === 0) u = Math.random(); //Converting [0,1) to (0,1)
	while(v === 0) v = Math.random();
	let num = Math.sqrt( -2.0 * Math.log( u ) ) * Math.cos( 2.0 * Math.PI * v );

	num = num / 10.0 + 0.5; // Translate to 0 -> 1
	if (num > 1 || num < 0) num = randn_bm(min, max, skew); // resample between 0 and 1 if out of range
	num = Math.pow(num, skew); // Skew
	num *= max - min; // Stretch to fill range
	num += min; // offset to min
	return num;
}

https://gist.github.com/bluesmoon/7925696
var spareRandom = null;

function normalRandom() {
	let val, u, v, s, mul;

	if (spareRandom !== null) {
		val = spareRandom;
		spareRandom = null;
	}
	else {
		do {
			u = Math.random()*2-1;
			v = Math.random()*2-1;

			s = u*u+v*v;
		} while(s === 0 || s >= 1);

		mul = Math.sqrt(-2 * Math.log(s) / s);

		val = u * mul;
		spareRandom = v * mul;
	}

	return val;
}

function normalRandomInRange(min, max) {
	let val;
	do {
		val = normalRandom();
	} while(val < min || val > max);

	return val;
}

function normalRandomScaled(mean, stddev) {
	let r = normalRandom();

	r = r * stddev + mean;

	return Math.round(r);
}

function lnRandomScaled(gmean, gstddev) {
	let r = normalRandom();

	r = r * Math.log(gstddev) + Math.log(gmean);

	return Math.round(Math.exp(r));
}


/*
// https://stackoverflow.com/a/11383603
function skew(skewTo,stdDev){
    var rand = (Math.random()*2 - 1) + (Math.random()*2 - 1) + (Math.random()*2 - 1);
    return skewTo + rand*stdDev;
}

function getRandom(skewTo){
    var difference = Math.min(skewTo-MIN_NUMBER, MAX_NUMBER-skewTo);
    var steps = 5;
    var total = 0.0;
    for(var i=1; i<=steps; i++)
        total += skew(skewTo, 1.0*i*difference/steps);
    return total/steps

}
*/

// https://stackoverflow.com/a/39187274
function gaussianRand() {
  var rand = 0;

  for (var i = 0; i < 6; i += 1) {
    rand += Math.random();
  }

  return rand / 6;
}

function gaussianRandom(start, end) {
  return Math.floor(start + gaussianRand() * (end - start + 1));
}



function randInt(min, max) { // min and max included
  return Math.floor(Math.random() * (max - min + 1) + min);
}

// https://spin.atomicobject.com/2019/09/30/skew-normal-prng-javascript/
const randomNormals = (rng) => {
    let u1 = 0, u2 = 0;
    //Convert [0,1) to (0,1)
    while (u1 === 0) u1 = rng();
    while (u2 === 0) u2 = rng();
    const R = Math.sqrt(-2.0 * Math.log(u1));
    const Θ = 2.0 * Math.PI * u2;
    return [R * Math.cos(Θ), R * Math.sin(Θ)];
};


const randomSkewNormal = (rng, ξ, ω, α = 0) => {
    const [u0, v] = randomNormals(rng);
    if (α === 0) {
        return ξ + ω * u0;
    }
    const 𝛿 = α / Math.sqrt(1 + α * α);
    const u1 = 𝛿 * u0 + Math.sqrt(1 - 𝛿 * 𝛿) * v;
    const z = u0 >= 0 ? u1 : -u1;
    return ξ + ω * z;
};