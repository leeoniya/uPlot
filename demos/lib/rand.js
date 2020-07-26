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