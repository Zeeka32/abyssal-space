// Sun-centered orbits in a shared ecliptic. Content is generated only after Start.
const STAR = [0, 0, 0, 160];
const BLACK_HOLE = { name: 'NADIR', p: [6100, 450, -3800], r: 65 };
const BODIES = [
  { name: 'AURELIA', type: 'Ringed gas giant', r: 150, kind: 1, seed: 3.7, spin: .018, air: .055, orbitRadius: 1750, phase: 4.65, inclination: .022 },
  { name: 'VERDANT', type: 'Oceanic terrestrial world', r: 78, kind: 0, seed: 8.2, spin: .025, air: .075, orbitRadius: 950, phase: 2.15, inclination: .012 },
  { name: 'SELENE', type: 'Cratered moon', r: 30, kind: 2, seed: 12.4, spin: .012, air: 0, orbitRadius: 460, phase: .7, inclination: .09 },
  { name: 'CINDER', type: 'Volcanic world', r: 88, kind: 3, seed: 18.1, spin: .021, air: .025, orbitRadius: 500, phase: .2, inclination: .028 },
  { name: 'VEIL', type: 'Frozen outer world', r: 108, kind: 4, seed: 23.8, spin: .014, air: .045, orbitRadius: 3400, phase: 3.5, inclination: .018 },
  { name: 'KESTREL', type: 'Rocky frontier', r: 50, kind: 2, seed: 31.2, spin: .016, air: 0, orbitRadius: 2550, phase: .55, inclination: .025 },
];
for (let i = 0; i < BODIES.length; i++) {
  const b = BODIES[i], r = b.orbitRadius, a = b.phase, inc = b.inclination;
  b.parent = i === 2 ? 0 : -1;
  b.u = new Float64Array([r * cos(a), r * sin(a) * sin(inc), r * sin(a) * cos(inc)]);
  b.v = new Float64Array([-r * sin(a), r * cos(a) * sin(inc), r * cos(a) * cos(inc)]);
  b.period = i === 2 ? 110 : 420 * pow(r / 1750, 1.5);
  const parent = b.parent < 0 ? STAR : BODIES[b.parent].p;
  b.p = [parent[0] + b.u[0], parent[1] + b.u[1], parent[2] + b.u[2]];
  b.start = new Float64Array(b.p);
}
function updateOrbits(time) {
  for (const b of BODIES) {
    const parent = b.parent < 0 ? STAR : BODIES[b.parent].p;
    const a = time * TAU / b.period, c = cos(a), s = sin(a);
    for (let k = 0; k < 3; k++) b.p[k] = parent[k] + b.u[k] * c + b.v[k] * s;
  }
}
// Separate fixed world-space objects: never included in the local orbital update or destinations.
const DISTANT_WORLDS = [
  { p: [-33000, -4000, -15500], r: 4200, kind: 1, seed: 43.1, spin: .001, air: .045 },
  { p: [0, -4500, -38000], r: 3000, kind: 4, seed: 57.3, spin: .0015, air: .025 },
  { p: [17000, -8000, 26000], r: 3000, kind: 0, seed: 68.2, spin: .0008, air: .04 },
];
const RING_TILT = .38, RING_TWIST = -.27;
const RING_Q = qMul(qAxis(0, 0, 1, RING_TWIST), qAxis(1, 0, 0, RING_TILT));
const OVERVIEW = [3500, 3300, 4900, 0, 0, 0];
const POSES = [OVERVIEW];
for (let i = 1; i < BODIES.length; i++) {
  const b = BODIES[i], parent = b.parent < 0 ? STAR : BODIES[b.parent].p;
  // View from the illuminated side; offsets are independent of the world's orbital phase.
  let x = parent[0] - b.p[0], z = parent[2] - b.p[2]; const len = hypot(x, z);
  x /= len; z /= len;
  const distance = b.r * 3.5;
  POSES.push([b.p[0] + (x * .9 - z * .45) * distance, b.p[1] + b.r * 1.3, b.p[2] + (z * .9 + x * .45) * distance, ...b.p]);
}
POSES.push([BLACK_HOLE.p[0] + 350, BLACK_HOLE.p[1] + 110, BLACK_HOLE.p[2] + 770, ...BLACK_HOLE.p]);
const DESTINATIONS = ['THE SOLAR SYSTEM', ...BODIES.slice(1).map(b => b.name), BLACK_HOLE.name];
const FLY = new Float32Array([
  ...POSES[0], ...POSES[3], ...POSES[1], ...POSES[2],
  BODIES[0].p[0] + 430, 290, BODIES[0].p[2] + 500, ...BODIES[0].p,
  ...POSES[5], ...POSES[4], ...POSES[6], ...POSES[0],
]);

function makeWorld() {
  const planets = [], atmospheres = [], asteroids = [];
  for (const b of BODIES) {
    const q = b.kind === 1 ? RING_Q : qAxis(0, 0, 1, b.seed * .07);
    planets.push(...b.p, b.r, ...q, b.kind, b.seed, b.spin, b.air);
    b.airIndex = b.air ? atmospheres.length : -1;
    if (b.air) atmospheres.push(...b.p, b.r * (1 + b.air), ...q, b.kind, b.seed, 0, b.air);
  }
  planets.push(...STAR.slice(0, 3), STAR[3], 0, 0, 0, 1, 6, 4, .009, 0);
  for (const b of DISTANT_WORLDS) planets.push(...b.p, b.r, ...qAxis(0, 0, 1, b.seed * .07), b.kind, b.seed, b.spin, b.air);
  const count = [6500, 3200, 1400][LV];
  rseed(42);
  for (let i = 0; i < count; i++) {
    const a = rnd() * TAU, rad = rr(2850, 3050), size = rr(.65, 3.8) * (rnd() < .035 ? 3 : 1);
    asteroids.push(STAR[0] + cos(a) * rad, STAR[1] + rr(-34, 34) + sin(a * 3) * 24, STAR[2] + sin(a) * rad, size,
      ...qRand(), 5, rnd() * 100, rr(-.12, .12), rr(.0005, .0018));
  }
  rseed(43);
  const b = BODIES[0];
  for (let i = 0; i < [1800, 900, 400][LV]; i++) {
    const a = rnd() * TAU, r = rr(207, 317), x = cos(a) * r, z = sin(a) * r, y = rr(-1.5, 1.5);
    const yy = y * cos(RING_TILT) - z * sin(RING_TILT), zz = y * sin(RING_TILT) + z * cos(RING_TILT);
    asteroids.push(x * cos(RING_TWIST) - yy * sin(RING_TWIST), x * sin(RING_TWIST) + yy * cos(RING_TWIST), zz,
      rr(.18, 1.1), ...qRand(), 5, rnd() * 100, rr(-.1, .1), -1);
  }
  const orbits = [];
  for (const b of BODIES) if (b.parent < 0) {
    for (let j = 0; j < 360; j++) for (let end = 0; end < 2; end++) {
      const a = (j + end) / 360 * TAU;
      for (let k = 0; k < 3; k++) orbits.push(STAR[k] + b.u[k] * cos(a) + b.v[k] * sin(a));
    }
  }
  return { planets: new Float32Array(planets), atmospheres: new Float32Array(atmospheres), asteroids: new Float32Array(asteroids), orbits: new Float32Array(orbits) };
}

function meshAsteroid() {
  return icosphere(LV > 1 ? 1 : 2, (x, y, z) => {
    const r = .78 + fbm(x * 2.9 + 7, y * 2.9, z * 2.9, 3) * .44;
    return [x * r, y * r * .8, z * r * 1.08];
  });
}

function meshRing() {
  const m = new Mesh(), seg = [512, 384, 256][LV];
  for (let i = 0; i <= seg; i++) {
    const a = i / seg * TAU;
    m.v(cos(a) * 1.34, 0, sin(a) * 1.34);
    m.v(cos(a) * 2.16, 0, sin(a) * 2.16);
  }
  for (let i = 0; i < seg; i++) m.quad(i * 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  return m;
}
