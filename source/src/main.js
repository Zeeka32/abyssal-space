// Direct WebGPU renderer: HDR, multisample geometry, bloom, dynamic resolution.
const $ = id => document.getElementById(id);
const canvas = $('c'), info = $('i'), body = document.body;
const rot = matchMedia('(orientation:portrait) and (pointer:coarse)');
let dead = false;
const say = async (message, fraction) => {
  $('s').textContent = message; $('b').style.transform = `scaleX(${fraction})`;
  await new Promise(resolve => setTimeout(resolve, 20));
};
const fail = message => { throw new Error(message, { cause: 1 }); };
if (!navigator.gpu) fail('This scene needs WebGPU. Open it in a current Chrome or Edge.');
await say('Connecting to the stars...', .08);
const adapter = await navigator.gpu.requestAdapter({ powerPreference: 'high-performance' });
if (!adapter) fail('No WebGPU adapter found. Enable hardware acceleration and try again.');
const hasTS = adapter.features.has('timestamp-query');
const device = await adapter.requestDevice({ requiredFeatures: hasTS ? ['timestamp-query'] : [] });
keep('astralLoad', '1');
device.lost.then(lost => {
  if (lost.reason === 'destroyed') return;
  dead = true;
  if (LV < 2) { keep('astral', LV + 1); location.reload(); return; }
  body.className = 'l e'; $('s').textContent = 'The graphics device was lost. Reload to try again.';
});
device.addEventListener('uncapturederror', e => {
  console.error('GPU: ' + e.error.message);
  dead = true; body.className = 'l e'; $('s').textContent = 'A graphics error occurred: ' + e.error.message;
});
$('w').hidden = !!navigator.userAgentData;
const ctx = canvas.getContext('webgpu'), FMT = navigator.gpu.getPreferredCanvasFormat();
const Q = device.queue, HDR = 'rgba16float', DEPTH = 'depth32float', TU = GPUTextureUsage, BU = GPUBufferUsage, SS = GPUShaderStage;
const buf = (data, usage) => {
  const b = device.createBuffer({ size: data.byteLength, usage: usage | BU.COPY_DST });
  Q.writeBuffer(b, 0, data); return b;
};
const tex = (w, h, format, usage, samples = 1) => device.createTexture({ size: [w, h], format, usage, sampleCount: samples });
const mod = async code => {
  const m = device.createShaderModule({ code });
  const compilation = await m.getCompilationInfo();
  const errors = compilation.messages.filter(m => m.type === 'error');
  if (errors.length) throw new Error(errors.map(m => `WGSL ${m.lineNum}:${m.linePos} ${m.message}`).join('\n'));
  return m;
};
const UB = new Float32Array(44), ubo = device.createBuffer({ size: 176, usage: BU.UNIFORM | BU.COPY_DST });
const bgl = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.VERTEX | SS.FRAGMENT, buffer: {} }] });
const layout = device.createPipelineLayout({ bindGroupLayouts: [bgl] });
const bg = device.createBindGroup({ layout: bgl, entries: [{ binding: 0, resource: { buffer: ubo } }] });
const vbLayout = { arrayStride: 16, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }, { shaderLocation: 1, offset: 12, format: 'snorm8x4' }] };
const instanceLayout = { arrayStride: 48, stepMode: 'instance', attributes: [
  { shaderLocation: 2, offset: 0, format: 'float32x4' }, { shaderLocation: 3, offset: 16, format: 'float32x4' }, { shaderLocation: 4, offset: 32, format: 'float32x4' }] };
const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } };
const scenePipe = (module, transparent = false, sky = false) => device.createRenderPipeline({
  layout, vertex: { module, entryPoint: 'vs', buffers: sky ? [] : [vbLayout, instanceLayout] },
  fragment: { module, entryPoint: 'fs', targets: [{ format: HDR, blend: transparent ? blend : undefined }] },
  primitive: { topology: 'triangle-list', cullMode: sky || transparent ? 'none' : 'back' },
  depthStencil: { format: DEPTH, depthWriteEnabled: !transparent && !sky, depthCompare: sky ? 'always' : 'greater' },
  multisample: { count: AA },
});
await say('Forming planetary atmospheres...', .24);
const pSky = scenePipe(await mod(W_SKY), false, true), pPlanet = scenePipe(await mod(W_PLANET));
const mHole = await mod(W_HOLE);
const pHole = device.createRenderPipeline({ layout, vertex: { module: mHole, entryPoint: 'vs' },
  fragment: { module: mHole, entryPoint: 'fs', targets: [{ format: HDR, blend }] },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
const pRing = scenePipe(await mod(W_RING), true);
const mOrbit = await mod(W_ORBIT);
const pOrbit = device.createRenderPipeline({ layout,
  vertex: { module: mOrbit, entryPoint: 'vs', buffers: [{ arrayStride: 12, attributes: [{ shaderLocation: 0, offset: 0, format: 'float32x3' }] }] },
  fragment: { module: mOrbit, entryPoint: 'fs', targets: [{ format: HDR }] }, primitive: { topology: 'line-list' },
  depthStencil: { format: DEPTH, depthWriteEnabled: true, depthCompare: 'greater' }, multisample: { count: AA } });
const sClamp = device.createSampler({ magFilter: 'linear', minFilter: 'linear' });
const blitLayout = device.createBindGroupLayout({ entries: [{ binding: 0, visibility: SS.FRAGMENT, texture: {} }, { binding: 1, visibility: SS.FRAGMENT, sampler: {} }] });
const blitPL = device.createPipelineLayout({ bindGroupLayouts: [blitLayout] }), mBlit = await mod(W_BLIT);
const blitPipe = (entry, add = false) => device.createRenderPipeline({ layout: blitPL, vertex: { module: mBlit, entryPoint: 'vs' },
  fragment: { module: mBlit, entryPoint: entry, targets: [{ format: HDR, blend: add ? { color: { srcFactor: 'one', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } } : undefined }] } });
const pDown0 = blitPipe('fsDown0'), pDown = blitPipe('fsDown'), pUp = blitPipe('fsUp', true);
const mPost = await mod(W_POST);
const pPost = device.createRenderPipeline({ layout: 'auto', vertex: { module: mPost, entryPoint: 'vs' }, fragment: { module: mPost, entryPoint: 'fs', targets: [{ format: FMT }] } });

await say('Scattering the asteroid belt...', .52);
const world = makeWorld();
const uploadMesh = mesh => { const m = mesh.build(); return { vb: buf(m.vb, BU.VERTEX), ib: buf(m.ib, BU.INDEX), n: m.ib.length }; };
const sphere = uploadMesh(icosphere(LV > 1 ? 4 : 5)), rock = uploadMesh(meshAsteroid()), ring = uploadMesh(meshRing());
const planets = buf(world.planets, BU.VERTEX), asteroids = buf(world.asteroids, BU.VERTEX);
const orbitLines = buf(world.orbits, BU.VERTEX), nOrbitVertices = world.orbits.length / 3;
world.orbits = null;
// A shell draws only its front faces, avoiding doubled atmospheric opacity.
const airModule = await mod(W_ATMOSPHERE);
const pAirFront = device.createRenderPipeline({ layout, vertex: { module: airModule, entryPoint: 'vs', buffers: [vbLayout, instanceLayout] },
  fragment: { module: airModule, entryPoint: 'fs', targets: [{ format: HDR, blend }] },
  primitive: { cullMode: 'back' }, depthStencil: { format: DEPTH, depthWriteEnabled: false, depthCompare: 'greater' }, multisample: { count: AA } });
const atmosphereData = new Float32Array(world.atmospheres.length), atmospheres = buf(atmosphereData, BU.VERTEX);
const atmosphereOrder = new Uint8Array(world.atmospheres.length / 12), atmosphereDistance = new Float64Array(atmosphereOrder.length);
const ringData = new Float32Array([...BODIES[0].p, BODIES[0].r, ...RING_Q, 1, 0, 0, 0]), ringInstance = buf(ringData, BU.VERTEX);
const nPlanets = world.planets.length / 12, nAsteroids = world.asteroids.length / 12;
world.asteroids = null;

const F = new Float64Array(32), P6 = new Float64Array(6);
const CX = 0, CY = 1, CZ = 2, YAW = 3, PIT = 4, FX = 5, FY = 6, FZ = 7, RX = 8, RZ = 9, UX = 10, UY = 11, UZ = 12, VX = 13, VY = 14, VZ = 15, TIME = 16, FLT = 17, LAST = 18, GPU = 19, HUDT = 20, SPL = 21;
const FLYN = FLY.length / 6, FLYT = 60, LUTN = 1024, flyLUT = new Float32Array(LUTN + 1);
const flightBase = FLY.slice(), flightAnchor = new Int8Array(FLYN).fill(-1);
for (let i = 0; i < FLYN; i++) {
  let nearest = 500;
  for (let j = 0; j < BODIES.length; j++) {
    const p = BODIES[j].start, o = i * 6;
    const d = hypot(FLY[o + 3] - p[0], FLY[o + 4] - p[1], FLY[o + 5] - p[2]);
    if (d < nearest) { nearest = d; flightAnchor[i] = j; }
  }
}
function aim() {
  const dx = P6[3] - P6[0], dy = P6[4] - P6[1], dz = P6[5] - P6[2];
  F[CX] = P6[0]; F[CY] = P6[1]; F[CZ] = P6[2];
  F[YAW] = atan2(dx, -dz); F[PIT] = atan2(dy, hypot(dx, dz));
}
const lookAt = (x, y, z, tx, ty, tz) => { P6.set([x, y, z, tx, ty, tz]); aim(); F[VX] = F[VY] = F[VZ] = 0; };
let trackingBody = -1;
let simulationPaused = false;
function destination(i) {
  updateOrbits(F[TIME]);
  const pose = POSES[i], b = i > 0 ? BODIES[i] : null;
  for (let k = 0; k < 6; k++) P6[k] = pose[k] + (b ? b.p[k % 3] - b.start[k % 3] : 0);
  aim(); F[VX] = F[VY] = F[VZ] = 0; trackingBody = b ? i : -1;
  mdx = mdy = lkx = lky = l2x = l2y = 0;
  $('sector').textContent = DESTINATIONS[i];
  $('nav').querySelectorAll('button').forEach((b, j) => { b.classList.toggle('selected', i === j); b.setAttribute('aria-pressed', i === j); });
}
function flyRaw() {
  const s = F[SPL], i = min(floor(s), FLYN - 2), u = s - i;
  for (let o = 0; o < 6; o++) {
    const a = FLY[max(0, i - 1) * 6 + o], b = FLY[i * 6 + o], c = FLY[(i + 1) * 6 + o], d = FLY[min(FLYN - 1, i + 2) * 6 + o];
    P6[o] = .5 * (2 * b + (c - a) * u + (2 * a - 5 * b + 4 * c - d) * u * u + (3 * b - a - 3 * c + d) * u * u * u);
  }
  aim();
}
{
  const M = 4096, len = new Float32Array(M + 1); let px = 0, py = 0, pz = 0;
  for (let k = 0; k <= M; k++) {
    F[SPL] = k / M * (FLYN - 1); flyRaw();
    if (k) len[k] = len[k - 1] + hypot(F[CX] - px, F[CY] - py, F[CZ] - pz);
    px = F[CX]; py = F[CY]; pz = F[CZ];
  }
  for (let k = 0, j = 0; k <= LUTN; k++) {
    const d = k / LUTN * len[M]; while (j < M - 1 && len[j + 1] < d) j++;
    flyLUT[k] = (j + (d - len[j]) / max(len[j + 1] - len[j], 1e-6)) / M * (FLYN - 1);
  }
}
function flyAt() {
  // Move the tour's control points with their destination, preserving the framing.
  for (let i = 0; i < FLYN; i++) {
    const b = flightAnchor[i] < 0 ? null : BODIES[flightAnchor[i]];
    for (let k = 0; k < 6; k++) FLY[i * 6 + k] = flightBase[i * 6 + k] + (b ? b.p[k % 3] - b.start[k % 3] : 0);
  }
  const s = clamp(F[FLT] / FLYT, 0, 1) * LUTN, k = min(floor(s), LUTN - 1);
  F[SPL] = mix(flyLUT[k], flyLUT[k + 1], s - k); flyRaw();
  moveCamera(0, 0, 0);
}

const PIXMAX = 2560 * 1440, PIXMIN = mob ? 250000 : 500000, NB = 5;
let W = 0, H = 0, DW = 0, DH = 0, pix = max(PIXMIN, min(PIXMAX, +SV[1] || (LV > 1 ? 640 * 360 : mob ? 1280 * 720 : PIXMAX)));
let dynT = 0, dynN = 0, dynG = 0, dynGN = 0, dynBad = 0;
let targets = [], passScene, passPost, bgPost, bloomPass = [], bloomBG = [];
const colorAtt = (view, clear = true) => ({ view, loadOp: clear ? 'clear' : 'load', storeOp: 'store', clearValue: [0, 0, 0, 1] });
const blitBG = view => device.createBindGroup({ layout: blitLayout, entries: [{ binding: 0, resource: view }, { binding: 1, resource: sClamp }] });
function resize() {
  DW = max(2, round(canvas.clientWidth * devicePixelRatio)); DH = max(2, round(canvas.clientHeight * devicePixelRatio));
  const scale = min(1, sqrt(pix / (DW * DH))), w = max(2, round(DW * scale) & ~1), h = max(2, round(DH * scale) & ~1);
  if (W === w && H === h) return;
  W = w; H = h; canvas.width = W; canvas.height = H;
  ctx.configure({ device, format: FMT, alphaMode: 'opaque' });
  for (const t of targets) t.destroy();
  const result = tex(W, H, HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING);
  const depth = tex(W, H, DEPTH, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING, AA);
  targets = [result, depth]; let ms;
  if (AA > 1) { ms = tex(W, H, HDR, TU.RENDER_ATTACHMENT, AA); targets.push(ms); }
  const vScene = result.createView();
  passScene = { colorAttachments: [{ view: AA > 1 ? ms.createView() : vScene, resolveTarget: AA > 1 ? vScene : undefined,
    loadOp: 'clear', storeOp: AA > 1 ? 'discard' : 'store', clearValue: [0, 0, 0, 1] }],
    depthStencilAttachment: { view: depth.createView(), depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' } };
  const bl = [];
  for (let i = 0; i < NB; i++) { const t = tex(max(1, W >> (i + 1)), max(1, H >> (i + 1)), HDR, TU.RENDER_ATTACHMENT | TU.TEXTURE_BINDING); targets.push(t); bl.push(t.createView()); }
  bloomPass = []; bloomBG = [];
  for (let i = 0; i < NB; i++) { bloomPass.push({ colorAttachments: [colorAtt(bl[i])] }); bloomBG.push(blitBG(i ? bl[i - 1] : vScene)); }
  for (let i = NB - 1; i > 0; i--) { bloomPass.push({ colorAttachments: [colorAtt(bl[i - 1], false)] }); bloomBG.push(blitBG(bl[i])); }
  bgPost = device.createBindGroup({ layout: pPost.getBindGroupLayout(0), entries: [{ binding: 0, resource: { buffer: ubo } }, { binding: 1, resource: sClamp }, { binding: 2, resource: vScene }, { binding: 3, resource: bl[0] }, { binding: 4, resource: depth.createView() }] });
  passPost = { colorAttachments: [colorAtt(null)] };
  UB[32] = W; UB[33] = H; UB[34] = 1 / W; UB[35] = 1 / H;
  dynT = -500; dynN = dynG = dynGN = 0;
}
resize(); addEventListener('resize', resize);

let qs, qResolve, tsBegin, tsEnd;
const qRead = [];
if (hasTS) {
  qs = device.createQuerySet({ type: 'timestamp', count: 2 });
  qResolve = device.createBuffer({ size: 16, usage: BU.QUERY_RESOLVE | BU.COPY_SRC });
  for (let i = 0; i < 4; i++) {
    const b = device.createBuffer({ size: 16, usage: BU.MAP_READ | BU.COPY_DST });
    const slot = { b, busy: false, done: null };
    slot.done = () => {
      const times = new BigInt64Array(b.getMappedRange()); F[GPU] = Number(times[1] - times[0]) / 1e6;
      b.unmap(); slot.busy = false;
      if (dynT > 0 && F[GPU] > 0) { dynG += F[GPU]; dynGN++; }
    };
    qRead.push(slot);
  }
  tsBegin = { querySet: qs, beginningOfPassWriteIndex: 0 }; tsEnd = { querySet: qs, endOfPassWriteIndex: 1 };
}

const TANH = .6, NEAR = .2, submitList = [null];
function drawMesh(r, mesh, instances, count) {
  r.setVertexBuffer(0, mesh.vb); r.setVertexBuffer(1, instances); r.setIndexBuffer(mesh.ib, 'uint32'); r.drawIndexed(mesh.n, count);
}
function render() {
  if (dead) return;
  updateOrbits(F[TIME]);
  for (let i = 0; i < BODIES.length; i++) {
    const b = BODIES[i];
    for (let k = 0; k < 3; k++) {
      world.planets[i * 12 + k] = b.p[k];
      if (b.airIndex >= 0) world.atmospheres[b.airIndex + k] = b.p[k];
    }
  }
  for (let k = 0; k < 3; k++) { ringData[k] = BODIES[0].p[k]; UB[40 + k] = BODIES[0].p[k]; }
  Q.writeBuffer(planets, 0, world.planets); Q.writeBuffer(ringInstance, 0, ringData);
  const cx = F[CX], cy = F[CY], cz = F[CZ], cp = cos(F[PIT]), fy = sin(F[PIT]), rx = cos(F[YAW]), rz = sin(F[YAW]);
  const fx = cp * rz, fz = -cp * rx, ux = -rz * fy, uy = cp, uz = rx * fy;
  F[FX] = fx; F[FY] = fy; F[FZ] = fz; F[RX] = rx; F[RZ] = rz; F[UX] = ux; F[UY] = uy; F[UZ] = uz;
  const sx = 1 / (TANH * W / H), sy = 1 / TANH, m = UB;
  m[0] = rx * sx; m[4] = 0; m[8] = rz * sx; m[12] = -(rx * cx + rz * cz) * sx;
  m[1] = ux * sy; m[5] = uy * sy; m[9] = uz * sy; m[13] = -(ux * cx + uy * cy + uz * cz) * sy;
  m[2] = 0; m[6] = 0; m[10] = 0; m[14] = NEAR;
  m[3] = fx; m[7] = fy; m[11] = fz; m[15] = -(fx * cx + fy * cy + fz * cz);
  m[16] = cx; m[17] = cy; m[18] = cz; m[19] = F[TIME];
  m[20] = rx; m[21] = 0; m[22] = rz; m[23] = TANH * W / H;
  m[24] = ux; m[25] = uy; m[26] = uz; m[27] = TANH;
  m[28] = fx; m[29] = fy; m[30] = fz; m[31] = NEAR; m[36] = .92;
  Q.writeBuffer(ubo, 0, UB);
  // Stable far-to-near insertion sort using fixed typed arrays, with no per-frame JS containers.
  for (let i = 0; i < atmosphereOrder.length; i++) {
    const o = i * 12, dx = world.atmospheres[o] - cx, dy = world.atmospheres[o + 1] - cy, dz = world.atmospheres[o + 2] - cz;
    atmosphereDistance[i] = dx * dx + dy * dy + dz * dz;
    let j = i;
    while (j && atmosphereDistance[atmosphereOrder[j - 1]] < atmosphereDistance[i]) { atmosphereOrder[j] = atmosphereOrder[j - 1]; j--; }
    atmosphereOrder[j] = i;
  }
  for (let i = 0; i < atmosphereOrder.length; i++) for (let k = 0; k < 12; k++) atmosphereData[i * 12 + k] = world.atmospheres[atmosphereOrder[i] * 12 + k];
  Q.writeBuffer(atmospheres, 0, atmosphereData);
  const e = device.createCommandEncoder(); let slot = null;
  if (hasTS) for (let i = 0; i < qRead.length; i++) if (!qRead[i].busy) { slot = qRead[i]; break; }
  passScene.timestampWrites = slot ? tsBegin : undefined; passPost.timestampWrites = slot ? tsEnd : undefined;
  let r = e.beginRenderPass(passScene); r.setBindGroup(0, bg);
  r.setPipeline(pSky); r.draw(3);
  r.setPipeline(pOrbit); r.setVertexBuffer(0, orbitLines); r.draw(nOrbitVertices);
  r.setPipeline(pPlanet); drawMesh(r, sphere, planets, nPlanets); drawMesh(r, rock, asteroids, nAsteroids);
  r.setPipeline(pHole); r.draw(6);
  r.setPipeline(pRing); drawMesh(r, ring, ringInstance, 1);
  r.setPipeline(pAirFront); drawMesh(r, sphere, atmospheres, atmosphereOrder.length); r.end();
  for (let i = 0; i < bloomPass.length; i++) {
    r = e.beginRenderPass(bloomPass[i]); r.setPipeline(i === 0 ? pDown0 : i < NB ? pDown : pUp); r.setBindGroup(0, bloomBG[i]); r.draw(3); r.end();
  }
  passPost.colorAttachments[0].view = ctx.getCurrentTexture().createView();
  r = e.beginRenderPass(passPost); r.setPipeline(pPost); r.setBindGroup(0, bgPost); r.draw(3); r.end();
  if (slot) { e.resolveQuerySet(qs, 0, 2, qResolve, 0); e.copyBufferToBuffer(qResolve, 0, slot.b, 0, 16); }
  submitList[0] = e.finish(); Q.submit(submitList);
  if (slot) { slot.busy = true; slot.b.mapAsync(GPUMapMode.READ).then(slot.done).catch(() => { slot.busy = false; }); }
}

// Swept motion is substepped; spheres prevent passing through planets and the central star.
function moveCamera(dx, dy, dz) {
  const steps = max(1, Math.ceil(hypot(dx, dy, dz) / 4));
  for (let step = 0; step < steps; step++) {
    F[CX] += dx / steps; F[CY] += dy / steps; F[CZ] += dz / steps;
    for (let i = 0; i < BODIES.length + 2; i++) {
      const p = i === BODIES.length ? STAR : i > BODIES.length ? BLACK_HOLE.p : BODIES[i].p;
      const radius = (i === BODIES.length ? STAR[3] : i > BODIES.length ? BLACK_HOLE.r * 1.22 : BODIES[i].r) + 3;
      let x = F[CX] - p[0], y = F[CY] - p[1], z = F[CZ] - p[2], d = hypot(x, y, z);
      if (d < radius) {
        if (d < .0001) { x = 0; y = 1; z = 0; d = 1; }
        x /= d; y /= d; z /= d;
        F[CX] = p[0] + x * radius; F[CY] = p[1] + y * radius; F[CZ] = p[2] + z * radius;
        const into = min(0, F[VX] * x + F[VY] * y + F[VZ] * z);
        F[VX] -= into * x; F[VY] -= into * y; F[VZ] -= into * z;
      }
    }
  }
}

let hud = false, kf = 0, kb = 0, kl = 0, kr = 0, ku = 0, kd = 0, ks = 0, mdx = 0, mdy = 0, lkx = 0, lky = 0, l2x = 0, l2y = 0;
let hTot = 0, hPer = 1e9, tId = -1, tN = 0, tx0 = 0, ty0 = 0, tx = 0, ty = 0, hN = 0, hMax = 0;
function frame(now) {
  if (dead) return;
  requestAnimationFrame(frame);
  const dtr = now - F[LAST], dt = min(dtr / 1000, .1); F[LAST] = now;
  const anchor = trackingBody >= 0 ? BODIES[trackingBody].p : null;
  const ax0 = anchor ? anchor[0] : 0, ay0 = anchor ? anchor[1] : 0, az0 = anchor ? anchor[2] : 0;
  if (!simulationPaused) F[TIME] += dt;
  updateOrbits(F[TIME]);
  if (anchor) { F[CX] += anchor[0] - ax0; F[CY] += anchor[1] - ay0; F[CZ] += anchor[2] - az0; }
  if (dtr < 1000 && (dynT += dtr) > 0 && (dynN++, dynT > 1500)) {
    const avg = dynT / dynN, gpu = dynGN ? dynG / dynGN : 0; let scale = 1;
    if (gpu > 14) scale = max(.65, 11.7 / gpu);
    else if (!gpu && avg > 19) { if (++dynBad >= 2) { scale = .8; dynBad = 0; } }
    else { dynBad = 0; if (gpu && gpu < 8.5 || !gpu && avg < 13) scale = 1.12; }
    const next = clamp(pix * scale, PIXMIN, min(PIXMAX, DW * DH));
    if (abs(next - pix) > pix * .04) { pix = next; keep('astral', [LV, pix | 0]); resize(); }
    dynT = dynN = dynG = dynGN = 0;
  }
  if (!menu) {
    if (kf || kb || kl || kr || ku || kd || tId >= 0) trackingBody = -1;
    if (tId >= 0) {
      const tr = 4 / min(innerWidth, innerHeight);
      lkx += clamp((tx - tx0) * tr, -1, 1) * 1.5 * dt;
      lky += clamp((ty - ty0) * tr, -1, 1) * dt;
    }
    const smooth = 1 - exp(-dt * 30); lkx += mdx * .0022; lky += mdy * .0022; mdx = mdy = 0;
    const ax = lkx * smooth, ay = lky * smooth; lkx -= ax; lky -= ay; l2x += ax; l2y += ay;
    const dyaw = l2x * smooth, dpitch = l2y * smooth; l2x -= dyaw; l2y -= dpitch;
    F[YAW] += dyaw; F[PIT] = clamp(F[PIT] - dpitch, -1.55, 1.55);
    const speed = ks || tN > 1 ? 240 : 65, k = 1 - exp(-dt * 3.2), forward = tId >= 0 ? .7 : kf - kb, right = kr - kl, up = ku - kd;
    const norm = max(1, hypot(forward, right, up)), cp = cos(F[PIT]), sy = sin(F[YAW]), cy = cos(F[YAW]);
    F[VX] += (((sy * cp * forward + cy * right) / norm) * speed - F[VX]) * k;
    F[VY] += (((sin(F[PIT]) * forward + up) / norm) * speed - F[VY]) * k;
    F[VZ] += (((-cy * cp * forward + sy * right) / norm) * speed - F[VZ]) * k;
    moveCamera(F[VX] * dt, F[VY] * dt, F[VZ] * dt);
  }
  else moveCamera(0, 0, 0);
  render();
  hN++; hMax = max(hMax, dtr); F[HUDT] += dt;
  if (F[HUDT] > .5) {
    if (hud) info.textContent = `${(hN / F[HUDT]).toFixed(0)} fps | GPU ${F[GPU].toFixed(2)} ms | worst ${hMax.toFixed(1)} ms | ${W} x ${H}`;
    hN = hMax = F[HUDT] = 0;
  }
}

// ---------------------------------------------------------------- input
const key = (e, v) => {
  switch (e.code) {
    case 'KeyW': kf = v; break; case 'KeyS': kb = v; break; case 'KeyA': kl = v; break; case 'KeyD': kr = v; break;
    case 'KeyE': ku = v; break; case 'KeyQ': kd = v; break; case 'ShiftLeft': case 'ShiftRight': ks = v; break;
    default: if (v && !e.repeat) {
      if (e.code === 'KeyH') { hud = !hud; hTot = 0; hPer = 1e9; info.textContent = ''; }
      else if (e.code === 'KeyM') mute();
      else if (e.code === 'Escape') ui(true);
      else if (e.code >= 'Digit1' && e.code <= 'Digit7') destination(e.code.charCodeAt(5) - 49);
    }
  }
};
// behind the menu only the stats and mute keys work
addEventListener('keydown', (e) => { if (menu && e.code !== 'KeyH' && e.code !== 'KeyM') return; sound(); key(e, 1); });
addEventListener('keyup', (e) => key(e, 0));
const release = () => { kf = kb = kl = kr = ku = kd = ks = 0; tId = -1; tN = 0; };
const capture = () => { sound(); canvas.requestPointerLock()?.catch(() => 0); };
canvas.addEventListener('click', () => { if (!menu && !mob) capture(); });
addEventListener('mousemove', (e) => { if (document.pointerLockElement === canvas) { mdx += e.movementX; mdy += e.movementY; } });
addEventListener('blur', release);
const touch = (e) => {
  e.preventDefault(); sound(); tN = e.touches.length;
  let f = null, first = false; for (let i = 0; i < tN; i++) if (e.touches[i].identifier === tId) f = e.touches[i];
  if (!f) { tId = -1; if (tN) { f = e.touches[0]; tId = f.identifier; first = true; } }
  if (f) {
    // the touch axes turn with the page when it lies on its side
    const x = rot.matches ? f.clientY : f.clientX, y = rot.matches ? -f.clientX : f.clientY, s = 1100 / min(innerWidth, innerHeight);
    if (first) { tx0 = x; ty0 = y; } else { mdx += (x - tx) * s; mdy += (y - ty) * s; } // the view follows the finger at once
    tx = x; ty = y;
  }
};
for (const n of ['touchstart', 'touchmove', 'touchend', 'touchcancel']) canvas.addEventListener(n, touch, { passive: false });

// ---------------------------------------------------------------- menu
// The scene keeps rendering (blurred by CSS) behind the menu. Esc, losing the mouse or the corner button open it.
let menu = true;
const bLaunch = $('d');
const ui = (m) => {
  if (dead) return;
  menu = m; body.className = m ? 'm' : document.pointerLockElement ? 'g p' : 'g';
  // focus the launch button so Enter works (delayed: it can't take focus while still hidden)
  if (m) { release(); setTimeout(() => menu && bLaunch.focus(), 100); } else document.activeElement.blur();
};
const go = () => {
  sound(); ui(false); bLaunch.textContent = 'Resume';
  // phones: go fullscreen and ask for landscape; where that is refused the CSS rotation still applies
  if (mob) document.documentElement.requestFullscreen?.()?.then(() => screen.orientation.lock('landscape')).catch(() => 0);
  if (!mob) capture();
};
bLaunch.onclick = go; $('o').onclick = () => { document.exitPointerLock?.(); ui(true); };
// detail buttons: the current level is lit, the others reload the page with theirs
$('q').querySelectorAll('button').forEach((b, i) => { b.setAttribute('aria-pressed', i === 2 - LV); if (i === 2 - LV) b.className = 'on'; else b.onclick = () => { keep('astral', 2 - i); location.reload(); }; });
document.addEventListener('pointerlockchange', () => ui(!document.pointerLockElement));

$('nav').querySelectorAll('button').forEach((b, i) => { b.onclick = () => destination(i); });
destination(0);
await say('Opening the observatory...', 1);
render(); await Q.onSubmittedWorkDone();
if (!dead) {
  body.dataset.stage = 'ready';
  bLaunch.textContent = 'Resume'; ui(false);
  setTimeout(keep, 15000, 'astralLoad', '');
  requestAnimationFrame(t => { F[LAST] = t; requestAnimationFrame(frame); });
}
