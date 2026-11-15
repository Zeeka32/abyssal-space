// Procedural WebGPU shaders. No fetched textures or external assets.
const W_NOISE = /*wgsl*/`
fn ss(a: f32, b: f32, x: f32) -> f32 { let t = clamp((x - a) / (b - a), 0., 1.); return t * t * (3. - 2. * t); }
fn h31(p: vec3f) -> f32 { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
fn h33(p: vec3f) -> vec3f { var q = fract(p * vec3f(.1031, .1030, .0973)); q += dot(q, q.yxz + 33.33); return fract((q.xxy + q.yxx) * q.zyx); }
fn vn(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); let u = f * f * (3. - 2. * f);
  return mix(mix(mix(h31(i), h31(i + vec3f(1., 0., 0.)), u.x), mix(h31(i + vec3f(0., 1., 0.)), h31(i + vec3f(1., 1., 0.)), u.x), u.y),
             mix(mix(h31(i + vec3f(0., 0., 1.)), h31(i + vec3f(1., 0., 1.)), u.x), mix(h31(i + vec3f(0., 1., 1.)), h31(i + vec3f(1., 1., 1.)), u.x), u.y), u.z);
}
fn fbm(p: vec3f, n: i32) -> f32 {
  var a = .5; var s = 0.; var q = p;
  for (var i = 0; i < n; i++) { s += a * vn(q); q = q * 2.03 + vec3f(17.1, 31.7, 5.3); a *= .5; }
  return s / (1. - 2. * a);
}
fn wor(p: vec3f) -> f32 {
  let i = floor(p); let f = fract(p); var d = 9.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let r = o + h33(i + o) - f; d = min(d, dot(r, r));
  } } }
  return sqrt(d);
}
`;

const W_FS = /*wgsl*/`
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f { return vec4f(f32(i32(i & 1u) * 4 - 1), f32(i32(i >> 1u) * 4 - 1), 0., 1.); }
`;

const W_BLIT = W_FS + /*wgsl*/`
@group(0) @binding(0) var t: texture_2d<f32>;
@group(0) @binding(1) var s: sampler;
fn uvOf(fc: vec4f, k: f32) -> vec2f { return fc.xy * k / vec2f(textureDimensions(t)); }
@fragment fn fsMip(@builtin(position) fc: vec4f) -> @location(0) vec4f { return textureSampleLevel(t, s, uvOf(fc, 2.), 0.); }
fn kar(c: vec3f) -> vec4f { let w = 1. / (1. + max(c.r, max(c.g, c.b))); return vec4f(c * w, w); }
@fragment fn fsDown0(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  let a = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.).rgb, vec3f(24.)));
  let b = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.).rgb, vec3f(24.)));
  let c = kar(min(textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.).rgb, vec3f(24.)));
  let d = kar(min(textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.).rgb, vec3f(24.)));
  let m = a + b + c + d;
  return vec4f(m.rgb / m.a, 1.);
}
@fragment fn fsDown(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, 2.); let e = 1. / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
@fragment fn fsUp(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = uvOf(fc, .5); let e = .75 / vec2f(textureDimensions(t));
  return (textureSampleLevel(t, s, uv + e * vec2f(-1., -1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., -1.), 0.)
        + textureSampleLevel(t, s, uv + e * vec2f(-1., 1.), 0.) + textureSampleLevel(t, s, uv + e * vec2f(1., 1.), 0.)) * .25;
}
`;

const S_G = /*wgsl*/`
struct G { vp: mat4x4f, cam: vec4f, right: vec4f, up: vec4f, fwd: vec4f, res: vec4f, mis: vec4f, ring: vec4f };
@group(0) @binding(0) var<uniform> g: G;
const SUN = vec3f(${STAR[0]}., ${STAR[1]}., ${STAR[2]}.);
const LOW = ${LV > 1};
fn sat(x: f32) -> f32 { return clamp(x, 0., 1.); }
fn qrot(q: vec4f, v: vec3f) -> vec3f { return v + 2. * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
fn turn(p: vec3f, a: f32) -> vec3f { let c = cos(a); let s = sin(a); return vec3f(c * p.x + s * p.z, p.y, -s * p.x + c * p.z); }
`;

// Stars are fixed in celestial directions. Pixel-footprint filtering stabilizes subpixel points.
const S_COSMOS = W_NOISE + S_G + /*wgsl*/`
fn galaxy(d: vec3f, axis: vec3f, angle: f32, size: f32, seed: f32, tint: vec3f) -> vec3f {
  let facing = dot(d, axis);
  if (facing < .7) { return vec3f(0.); }
  let right = normalize(cross(vec3f(0., 1., 0.), axis)); let up = cross(axis, right);
  let uv = vec2f(dot(d, right), dot(d, up)) / (facing * size);
  let q = vec2f(cos(angle) * uv.x - sin(angle) * uv.y, sin(angle) * uv.x + cos(angle) * uv.y);
  let p = vec2f(q.x, q.y / .37); let r = length(p);
  if (r > 2.) { return vec3f(0.); }
  let theta = atan2(p.y, p.x);
  let spiral = .5 + .5 * cos(theta * 2. - log(max(r, .025)) * 5.5 + seed);
  let grain = fbm(vec3f(p * 18., seed), ${LV > 1 ? 2 : 3});
  let arms = pow(spiral, 3.) * exp(-r * 2.8) * ss(.05, .25, r);
  let disk = exp(-r * 4.) * (.2 + grain * .4);
  let core = exp(-dot(p, p) * 115.);
  let dust = 1. - ss(.4, .7, grain) * (.35 + .4 * spiral);
  return ((tint * (arms * 1.8 + disk) * dust) + vec3f(1.5, 1.0, .62) * core) * (1. - ss(1.6, 2., r));
}
fn stars(d: vec3f, scale: f32, cutoff: f32) -> vec3f {
  let p = d * scale; let cell = floor(p); let h = h33(cell);
  let delta = fract(p) - (.15 + h * .7);
  let dist = length(delta); let aa = max(scale * g.up.w * 2. / g.res.y, .018);
  let radius = .018 + h.x * .035;
  let point = (1. - smoothstep(radius, radius + aa, dist)) * min(1., radius / aa);
  let color = mix(vec3f(.48, .68, 1.), vec3f(1., .76, .48), h.y);
  return color * point * step(cutoff, h.z) * (2. + 7. * h.y * h.y);
}
fn cosmos(d: vec3f) -> vec3f {
  let warp = vec3f(vn(d * 3. + 9.), vn(d * 3. + 22.), vn(d * 3. + 47.));
  let n = fbm(d * 4. + warp * 2., ${LV > 1 ? 3 : 5});
  let band = exp(-pow((d.y + d.x * .31 - .08 + (n - .5) * .6) * 4.2, 2.));
  let cloud = ss(.28, .78, n) * band;
  let dust = ss(.42, .62, fbm(d * 16. + warp, 3));
  var c = vec3f(.0015, .002, .006);
  c += mix(vec3f(.055, .018, .12), vec3f(.015, .075, .14), ss(.32, .72, n + d.x * .15)) * cloud * 1.8;
  c += vec3f(.09, .035, .07) * pow(cloud, 3.) * 2.;
  c *= 1. - dust * band * .75;
  c += (stars(d, 115., .965) + stars(d, 247., .985) + stars(d, 491., .997)) * .65;
  // Fixed celestial directions: these distant galaxies never join the solar orbit update.
  c += galaxy(d, normalize(vec3f(-.55, -.15, -1.)), .55, .16, 7., vec3f(.30, .42, .72));
  c += galaxy(d, normalize(vec3f(.65, .32, -.8)), -.7, .11, 19., vec3f(.63, .30, .37));
  c += galaxy(d, normalize(vec3f(-.3, -.1, .95)), .2, .20, 31., vec3f(.36, .46, .65));
  let sd = normalize(SUN - g.cam.xyz); let sun = max(dot(d, sd), 0.);
  c += vec3f(1., .56, .2) * (pow(sun, 260.) * .32 + pow(sun, 35.) * .012);
  return c;
}
`;

const W_SKY = S_COSMOS + W_FS + /*wgsl*/`
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / g.res.xy * 2. - 1.;
  let d = normalize(g.fwd.xyz + g.right.xyz * uv.x * g.right.w - g.up.xyz * uv.y * g.up.w);
  return vec4f(cosmos(d), 1.);
}
`;

const W_ORBIT = S_G + /*wgsl*/`
@vertex fn vs(@location(0) p: vec3f) -> @builtin(position) vec4f { return g.vp * vec4f(p, 1.); }
@fragment fn fs() -> @location(0) vec4f { return vec4f(.065, .085, .12, 1.); }
`;

// Stylized analytic horizon, Doppler-brightened accretion disk and background lens.
// The disk and horizon write their actual depth, so foreground worlds occlude them.
const W_HOLE = W_NOISE + S_G + /*wgsl*/`
const HOLE = vec3f(${BLACK_HOLE.p.map(v => v + '.').join(',')});
const HR = ${BLACK_HOLE.r}.;
@vertex fn vs(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  let corners = array<vec2f, 6>(vec2f(-1., -1.), vec2f(1., -1.), vec2f(-1., 1.), vec2f(-1., 1.), vec2f(1., -1.), vec2f(1., 1.));
  let q = corners[vi]; let dist = distance(HOLE, g.cam.xyz);
  if (dist < HR * 6.5) { return vec4f(q, 0., 1.); }
  let extent = HR * 6. * dist / sqrt(dist * dist - HR * HR * 36.);
  let p = HOLE + (g.right.xyz * q.x + g.up.xyz * q.y) * extent;
  return g.vp * vec4f(p, 1.);
}
struct HO { @location(0) color: vec4f, @builtin(frag_depth) depth: f32 };
@fragment fn fs(@builtin(position) fc: vec4f) -> HO {
  let uv = fc.xy / g.res.xy * 2. - 1.;
  let rd = normalize(g.fwd.xyz + g.right.xyz * uv.x * g.right.w - g.up.xyz * uv.y * g.up.w);
  let ro = g.cam.xyz - HOLE; let along = -dot(ro, rd);
  let impact = length(ro + rd * along) / HR;
  if (along <= 0. || impact > 6.) { discard; }
  var color = vec3f(0.); var opacity = 0.;
  let radius = HR * 1.22;
  let discriminant = radius * radius - pow(impact * HR, 2.);
  var hit = along;
  var horizon = 1e20;
  if (discriminant >= 0.) {
    horizon = along - sqrt(discriminant);
    if (horizon > 0.) { opacity = 1.; hit = horizon; }
  }
  let photon = exp(-pow((impact - 1.25) * 40., 2.));
  color += vec3f(2.9, 1.1, .23) * photon;
  let normal = normalize(vec3f(.12, .86, .48));
  let denom = dot(rd, normal);
  if (abs(denom) > .0001) {
    let t = -dot(ro, normal) / denom;
    let p = (ro + rd * t) / HR; let rad = length(p);
    if (t > 0. && t < horizon && rad > 1.55 && rad < 5.) {
      let angle = atan2(p.z, p.x);
      let turbulence = fbm(p * 3. + vec3f(g.cam.w * .08, 0., 0.), 3);
      let phase = rad * 85. + turbulence * 8. - g.cam.w * 2.;
      let footprint = 85. * along / (HR * g.res.y);
      let bands = .65 + .35 * sin(phase) * exp(-footprint * footprint * .2);
      let spiral = .6 + .4 * sin(angle * 6. - rad * 7. + g.cam.w * .7);
      let heat = pow(1.55 / rad, 1.9);
      let edge = ss(1.55, 1.85, rad) * (1. - ss(4.0, 5., rad));
      let doppler = 1. + .55 * sin(angle - .8);
      let disk = mix(vec3f(3.8, .45, .045), vec3f(9., 5.2, 2.), heat);
      let diskAlpha = edge * (.75 + turbulence * .25);
      color = color * (1. - diskAlpha) + disk * heat * bands * (.65 + spiral * .35) * doppler * diskAlpha;
      opacity = diskAlpha + opacity * (1. - diskAlpha);
      hit = t;
    }
  }
  // A faint lensed secondary image bends over the horizon; it fades into the sky.
  let halo = exp(-pow((impact - 1.48) * 11., 2.));
  color += vec3f(.8, .28, .06) * halo;
  if (opacity < .001 && photon < .001 && halo < .001) { discard; }
  var o: HO; o.color = vec4f(color, opacity);
  o.depth = g.fwd.w / max(dot(rd * hit, g.fwd.xyz), g.fwd.w);
  return o;
}
`;

const S_MESH = W_NOISE + S_G + /*wgsl*/`
struct VI { @location(0) p: vec3f, @location(1) n: vec4f, @location(2) a: vec4f, @location(3) b: vec4f, @location(4) c: vec4f };
struct VO { @builtin(position) cp: vec4f, @location(0) wp: vec3f, @location(1) n: vec3f, @location(2) op: vec3f,
  @location(3) @interpolate(flat) info: vec4f, @location(4) @interpolate(flat) q: vec4f, @location(5) @interpolate(flat) center: vec4f };
@vertex fn vs(i: VI) -> VO {
  var o: VO; let a = g.cam.w * i.c.z; let p = turn(i.p, a);
  var center = i.a.xyz;
  if (i.c.x > 4.5 && i.c.x < 5.5) {
    center = select(SUN + turn(center - SUN, g.cam.w * max(i.c.w, 0.)), g.ring.xyz + center, i.c.w < 0.);
  }
  o.wp = center + qrot(i.b, p * i.a.w);
  o.cp = g.vp * vec4f(o.wp, 1.); o.n = qrot(i.b, turn(i.n.xyz, a));
  o.op = i.p; o.info = i.c; o.q = i.b; o.center = vec4f(center, i.a.w);
  return o;
}
`;

const W_PLANET = S_MESH + /*wgsl*/`
fn crater(p: vec3f) -> f32 {
  let q = p * 13.; let cell = floor(q); let f = fract(q); var nearest = 10.;
  for (var x = -1; x <= 1; x++) { for (var y = -1; y <= 1; y++) { for (var z = -1; z <= 1; z++) {
    let o = vec3f(f32(x), f32(y), f32(z)); let h = h33(cell + o);
    nearest = min(nearest, length(o + h - f) / (.55 + h.x * .5));
  } } }
  return ss(.1, .48, nearest) * .45 + exp(-pow((nearest - .55) * 14., 2.)) * .38;
}
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let kind = i.info.x; let seed = i.info.y; let p = normalize(i.op);
  let n = normalize(i.n); let l = normalize(SUN - i.wp); let v = normalize(g.cam.xyz - i.wp);
  let daylight = max(dot(n, l), 0.); let detail = fbm(p * 18. + seed, ${LV > 1 ? 3 : 5});
  let broad = fbm(p * 3.5 + seed, ${LV > 1 ? 3 : 5});
  var alb = vec3f(.3); var emission = vec3f(0.); var gloss = .0;
  if (kind < .5) {
    let terrain = fbm(p * 4.3 + seed + (broad - .5) * 1.8, ${LV > 1 ? 4 : 6});
    let land = ss(.49, .515, terrain); let coast = ss(.51, .55, terrain);
    alb = mix(vec3f(.007, .045, .12), vec3f(.015, .20, .29), ss(.42, .52, terrain));
    let soil = mix(vec3f(.40, .30, .12), vec3f(.055, .17, .07), coast);
    alb = mix(alb, soil * (.6 + detail * .8), land);
    let polar = ss(.76, .93, abs(p.y) + (detail - .5) * .18);
    alb = mix(alb, vec3f(.75, .86, .91), polar);
    let cloud = ss(.56, .72, fbm(turn(p, g.cam.w * .003) * 8. + seed + broad * .7, 4));
    alb = mix(alb, vec3f(.86, .91, .96), cloud * .88);
    gloss = (1. - land) * (1. - cloud) * .65;
    let cities = step(.91, h31(floor(p * 330.))) * ss(.52, .57, terrain) * (1. - ss(.0, .15, daylight));
    emission += vec3f(1., .51, .12) * cities * .22;
  } else if (kind < 1.5) {
    let bands = p.y * 39. + (broad - .5) * 6. + sin(p.x * 10. + broad * 9.) * .6;
    let stripe = .5 + .5 * sin(bands);
    alb = mix(vec3f(.30, .14, .065), vec3f(.87, .65, .35), stripe);
    alb = mix(alb, vec3f(.92, .84, .63), ss(.5, .75, .5 + .5 * sin(bands * .37 + 2.)) * .55);
    alb *= .7 + detail * .65;
    let spot = exp(-pow((p.y + .22) * 20., 2.) - pow((p.x - .58) * 8., 2.) - pow((p.z - .76) * 7., 2.));
    alb = mix(alb, vec3f(.58, .19, .08), spot * .75);
  } else if (kind < 2.5) {
    let cr = crater(p + seed); let cr2 = crater(p * 2.7 + seed * 2.);
    alb = mix(vec3f(.13, .14, .17), vec3f(.50, .47, .42), broad);
    alb *= (.45 + cr * 1.1) * (.7 + cr2 * .45) * (.7 + detail * .6);
  } else if (kind < 3.5) {
    let cracks = abs(fbm(p * 7. + seed + broad, 4) - .5);
    let lava = 1. - ss(.018, .054, cracks);
    alb = vec3f(.065, .038, .034) * (.5 + detail);
    emission = mix(vec3f(3.8, .16, .006), vec3f(7., 1.4, .06), lava * lava) * lava;
    emission *= .8 + .2 * sin(g.cam.w * .6 + broad * 20.);
  } else if (kind < 4.5) {
    let cracks = ss(.012, .075, abs(fbm(p * 9. + seed, 4) - .5));
    alb = mix(vec3f(.035, .18, .27), vec3f(.66, .83, .87), cracks) * (.65 + detail * .65);
    alb = mix(alb, vec3f(.84, .89, .92), ss(.5, .8, abs(p.y) + broad * .3)); gloss = .25;
  } else if (kind < 5.5) {
    alb = mix(vec3f(.12, .095, .08), vec3f(.37, .32, .26), detail) * (.7 + broad * .5);
  } else {
    let gran = fbm(p * 38. + seed + g.cam.w * .04, 3);
    return vec4f(vec3f(7., 3.1, .72) * (.65 + gran * .6), 1.);
  }
  var shadow = 1.;
  if (kind > .5 && kind < 1.5 && i.center.w < 500.) {
    let lp = qrot(vec4f(-i.q.xyz, i.q.w), l);
    let local = qrot(vec4f(-i.q.xyz, i.q.w), n);
    if (abs(lp.y) > .0001) {
      let t = -local.y / lp.y; let rad = length((local + lp * t).xz);
      if (t > 0. && rad > 1.34 && rad < 2.16) { shadow = .28 + .12 * sin(rad * 190.); }
    }
  }
  var c = alb * (vec3f(.018, .025, .045) + vec3f(1.9, 1.65, 1.35) * daylight * shadow);
  c += emission;
  c += vec3f(1.5, 1.65, 1.8) * pow(max(dot(n, normalize(l + v)), 0.), 95.) * gloss * daylight;
  let rim = pow(1. - max(dot(n, v), 0.), 3.) * ss(-.18, .3, dot(n, l));
  var aircol = vec3f(.12, .36, .85);
  if (kind > .5 && kind < 1.5) { aircol = vec3f(.7, .39, .12); }
  if (kind > 2.5 && kind < 3.5) { aircol = vec3f(.7, .10, .025); }
  c += aircol * rim * min(i.info.w * 12., .65);
  return vec4f(c, 1.);
}
`;

const W_ATMOSPHERE = S_MESH + /*wgsl*/`
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let v = normalize(g.cam.xyz - i.wp); let n = normalize(i.n); let l = normalize(SUN - i.wp);
  let nv = abs(dot(n, v));
  let rim = pow(1. - nv, 3.5) * ss(0., .18, nv);
  let light = ss(-.28, .6, dot(n, l));
  var color = vec3f(.10, .34, .85);
  if (i.info.x > .5 && i.info.x < 1.5) { color = vec3f(.65, .37, .13); }
  if (i.info.x > 2.5 && i.info.x < 3.5) { color = vec3f(.8, .10, .015); }
  if (i.info.x > 3.5) { color = vec3f(.15, .65, .9); }
  let alpha = min(.65, rim * .68) * light;
  return vec4f(color * alpha * 1.7, alpha);
}
`;

const W_RING = S_MESH + /*wgsl*/`
@fragment fn fs(i: VO) -> @location(0) vec4f {
  let r = length(i.op.xz); let edge = ss(1.34, 1.37, r) * (1. - ss(2.12, 2.16, r));
  let phase = r * 870. + sin(r * 121.) * 2.;
  let fine = .5 + .5 * sin(phase) * exp(-pow(fwidth(phase), 2.) * .25);
  let broad = .5 + .5 * sin(r * 95. + sin(r * 31.) * 3.);
  let gap = 1. - ss(.018, .008, abs(r - 1.82));
  let alpha = (.24 + broad * .30 + fine * .16) * edge * gap;
  let l = normalize(SUN - i.wp); let toCenter = i.wp - i.center.xyz;
  let t = dot(toCenter, l); let d = length(toCenter - l * t) / i.center.w;
  let shadow = select(1., ss(.97, 1.05, d) * .9 + .1, t < 0.);
  let color = mix(vec3f(.24, .16, .10), vec3f(.82, .69, .46), broad * .6 + fine * .4);
  return vec4f(color * (.45 + shadow * 1.4) * alpha, alpha);
}
`;

const W_POST = S_G + W_FS + /*wgsl*/`
@group(0) @binding(1) var s: sampler;
@group(0) @binding(2) var scene: texture_2d<f32>;
@group(0) @binding(3) var bloom: texture_2d<f32>;
@group(0) @binding(4) var depth: texture_depth${AA > 1 ? '_multisampled' : ''}_2d;
const HP = vec3f(${BLACK_HOLE.p.map(v => v + '.').join(',')});
const RS = ${BLACK_HOLE.r}.;
@fragment fn fs(@builtin(position) fc: vec4f) -> @location(0) vec4f {
  let uv = fc.xy / g.res.xy;
  var sourceUV = uv;
  let nd = uv * 2. - 1.;
  let rd = normalize(g.fwd.xyz + g.right.xyz * nd.x * g.right.w - g.up.xyz * nd.y * g.up.w);
  let relative = HP - g.cam.xyz; let along = dot(relative, rd);
  let impact = length(relative - rd * along) / RS;
  let dp = textureLoad(depth, vec2i(fc.xy), 0);
  let distance = g.fwd.w / max(dp * dot(rd, g.fwd.xyz), 1e-9);
  // Lens the already-rendered background, preserving the star, worlds and foreground occlusion.
  if (along > 0. && impact > 1.22 && impact < 6. && distance > along + RS * 6.) {
    let center = g.vp * vec4f(HP, 1.);
    let centerUV = vec2f(center.x / center.w * .5 + .5, .5 - center.y / center.w * .5);
    sourceUV += (uv - centerUV) * (.42 / max(impact * impact, .2)) * (1. - smoothstep(4.5, 6., impact));
  }
  var c = textureSampleLevel(scene, s, sourceUV, 0.).rgb + textureSampleLevel(bloom, s, sourceUV, 0.).rgb * .14;
  c *= g.mis.x * (1. - dot(uv - .5, uv - .5) * .30);
  c = clamp((c * (2.51 * c + .03)) / (c * (2.43 * c + .59) + .14), vec3f(0.), vec3f(1.));
  c = pow(c, vec3f(1. / 2.2));
  let dither = fract(52.9829189 * fract(dot(fc.xy, vec2f(.06711056, .00583715)))) - .5;
  return vec4f(c + dither / 255., 1.);
}
`;
