// ============================================================================
// development tools: only in dev.html (npm run build:dev), never in index.html
// ============================================================================
//   F    fly the camera along the scripted path (FLY in world.js), one minute through the whole world
//   B    the same flight as a benchmark: the resolution stays fixed, every frame is timed, the result is shown at the end
//   F, B or 1-7 during a flight stop it
// Read-only diagnostics and explicit camera controls for local browser verification.
globalThis.__astral = {
  pose: i => { destination(i); ui(false); render(); },
  pause: value => { simulationPaused = value; },
  orbits: time => {
    updateOrbits(time);
    const snapshot = BODIES.map(b => ({ p: [...b.p], r: b.r, radius: b.orbitRadius, period: b.period, parent: b.parent }));
    updateOrbits(F[TIME]); return snapshot;
  },
  state: () => ({ ready: !dead, menu, width: W, height: H, quality: LV, samples: AA, gpuMs: F[GPU],
    camera: [F[CX], F[CY], F[CZ]], time: F[TIME], adapter: { vendor: adapter.info?.vendor, architecture: adapter.info?.architecture, device: adapter.info?.device, description: adapter.info?.description },
    planets: BODIES.length, asteroids: nAsteroids, audio: AC?.state || 'not started', muted,
    propulsion: { ...AUDIO_STATE }, centers: BODIES.map(b => [...b.p]) }),
  path: t => { F[FLT] = t; flyAt(); return [F[CX], F[CY], F[CZ]]; },
  bodies: BODIES,
  star: STAR,
  distant: () => DISTANT_WORLDS.map((b, i) => ({ p: Array.from(world.planets.subarray((BODIES.length + 1 + i) * 12, (BODIES.length + 1 + i) * 12 + 3)), r: b.r })),
  hole: BLACK_HOLE,
  collide: (x, y, z, dx, dy, dz) => {
    F[CX] = x; F[CY] = y; F[CZ] = z; moveCamera(dx, dy, dz);
    return [F[CX], F[CY], F[CZ]];
  },
};
{
  const LOGN = 1 << 16, logFrame = new Float32Array(LOGN), logGpu = new Float32Array(LOGN);
  let flying = false, bench = false, last = 0, nFrame = 0, nGpu = 0;
  const stop = () => { flying = bench = false; dynT = 0; };
  const report = () => {
    const st = (a, n) => { const s = Array.from(a.subarray(0, n)).sort((x, y) => x - y); let sum = 0; for (const v of s) sum += v; return { n, avg: sum / n, p99: s[min(n - 1, floor(n * 0.99))], max: s[n - 1] }; };
    const fm = (o) => `avg ${o.avg.toFixed(2)}  p99 ${o.p99.toFixed(2)}  max ${o.max.toFixed(2)} ms`;
    const f = st(logFrame, nFrame);
    info.textContent = `Fly-through ${W}x${H}, ${f.n} frames\nframe  ${fm(f)}\nGPU    ${nGpu ? fm(st(logGpu, nGpu)) : 'timestamp-query unavailable'}`;
  };
  // frame() moves the free camera and then calls render(): step in between and put the camera on the path instead
  const draw = render;
  render = () => {
    if (flying) {
      const dtr = F[LAST] - last; last = F[LAST];
      F[FLT] += min(dtr / 1000, 0.1); flyAt();
      if (bench) { if (nFrame < LOGN) logFrame[nFrame++] = dtr; if (F[GPU] > 0 && nGpu < LOGN) logGpu[nGpu++] = F[GPU]; }
      if (F[FLT] >= FLYT) { if (bench) report(); stop(); }
    }
    draw();
  };
  addEventListener('keydown', (e) => {
    if (menu || e.repeat) return;
    if (e.code === 'KeyF' || e.code === 'KeyB') {
      if (flying) stop();
      else {
        trackingBody = -1; flying = true; bench = e.code === 'KeyB'; F[FLT] = 0; last = F[LAST]; nFrame = nGpu = 0;
        // a benchmark hides the stats line and holds the resolution: dynT at -Infinity keeps frame() from tuning it
        if (bench) { hud = false; info.textContent = ''; dynT = -Infinity; }
      }
    } else if (/Digit[1-7]/.test(e.code)) stop();
  });
}
