// Custom World Builder: shared geography maps for the domain and the synoptic model.
// Maps (h, sea, sst, soil, veg, lake) live on the visible domain grid; peWorldSampler
// tiles them around the PE channel so lows/highs see the same coastline and SST.

import { VEG } from './climate.js';

// Lightweight SST climatology (same shape as pe.sstClim) – avoid importing pe.js here.
function sstClim(lat, doy) {
  const LAT = [0, 10, 20, 30, 40, 50, 60, 70, 80, 90];
  const MEAN = [27, 27, 25.5, 22, 17, 12.5, 9, 5, -1.8, -1.8];
  const AMP = [0.5, 0.8, 1.5, 2.5, 4, 3.5, 2.5, 2, 0, 0];
  const a = Math.min(89.9, Math.abs(lat)) / 10, i = Math.floor(a), f = a - i;
  const mean = MEAN[i] + f * (MEAN[i + 1] - MEAN[i]), amp = AMP[i] + f * (AMP[i + 1] - AMP[i]);
  const sh = lat < 0 ? 182.5 : 0;
  return Math.max(-1.8, mean - amp * Math.cos(2 * Math.PI * (doy - 60 - sh) / 365));
}

export const WORLD_PRESETS = {
  flat: 'Flat land',
  island: 'Island',
  inland_sea: 'Inland sea',
  archipelago: 'Archipelago',
  desert_basin: 'Desert basin',
  mountain_coast: 'Mountain coast',
};

// Climate / atmosphere-manipulation baselines applied with each preset (manip tab + PE climate).
export const SYN_BASELINES = {
  flat: { lat: 50, lon: 20, cont: 1.0, hum: 0.7, T: 0, R: 1, V: 1 },
  island: { lat: 25, lon: -40, cont: 0.55, hum: 0.85, T: 0, R: 1, V: 1 },
  inland_sea: { lat: 45, lon: 35, cont: 1.15, hum: 0.65, T: 0, R: 1, V: 1 },
  archipelago: { lat: 12, lon: 120, cont: 0.5, hum: 0.9, T: 0, R: 1, V: 1 },
  desert_basin: { lat: 28, lon: 15, cont: 1.55, hum: 0.12, T: 0, R: 1.1, V: 1 },
  mountain_coast: { lat: 48, lon: -125, cont: 0.75, hum: 0.8, T: 0, R: 1, V: 1.1 },
};

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perlinLayer(period, rand) {
  const g = [];
  for (let n = 0; n < period * period; n++) {
    const a = rand() * 2 * Math.PI;
    g.push([Math.cos(a), Math.sin(a)]);
  }
  const grad = (ix, iy) => g[((iy % period + period) % period) * period + ((ix % period + period) % period)];
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy;
    const dot = (cx, cy) => { const q = grad(ix + cx, iy + cy); return q[0] * (fx - cx) + q[1] * (fy - cy); };
    const u = fade(fx), v = fade(fy);
    const a = dot(0, 0) + u * (dot(1, 0) - dot(0, 0));
    const b = dot(0, 1) + u * (dot(1, 1) - dot(0, 1));
    return a + v * (b - a);
  };
}

function hash2(i, j, seed) {
  let h = Math.imul(i + 1, 374761393) ^ Math.imul(j + 1, 668265263) ^ seed;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Allocate empty shared world maps for an NX×NY domain. */
export function createWorld(nx, ny, seed = 1) {
  const n = nx * ny;
  return {
    nx, ny, seed: seed >>> 0, preset: 'flat',
    hemi: 'N',   // 'N' | 'S' — climate latitude sign for seasons / SST clim / vegetation
    h: new Float32Array(n),
    sea: new Uint8Array(n),
    lake: new Uint8Array(n),
    sst: new Float32Array(n),   // °C; NaN = use climatology
    soil: new Float32Array(n).fill(0.55),
    veg: new Int8Array(n).fill(-1),   // −1 = auto from climate
  };
}

export function clearWorld(w) {
  w.h.fill(0); w.sea.fill(0); w.lake.fill(0); w.sst.fill(NaN); w.soil.fill(0.55); w.veg.fill(-1);
}

function at(w, i, j) { return j * w.nx + i; }
function wrapI(w, i) { return ((i % w.nx) + w.nx) % w.nx; }
function wrapJ(w, j) { return ((j % w.ny) + w.ny) % w.ny; }
const d01 = (a) => { const x = a - 0.5; return x - Math.round(x); };

/** Soft brush over a world layer. amount: for h/sst/soil additive; for sea/lake/veg absolute (or −1 to clear veg). */
export function paintWorld(w, layer, x, y, r, amount, { wrap = true, hard = false } = {}) {
  const R = Math.ceil((hard ? 1 : 2) * r);
  const r2 = r * r, r2out = hard ? r2 : r2 * 4, invR2 = 1 / (r2 || 1);
  for (let dj = -R; dj <= R; dj++) {
    for (let di = -R; di <= R; di++) {
      let ii = Math.floor(x) + di, jj = Math.floor(y) + dj;
      if (!wrap && (ii < 0 || jj < 0 || ii >= w.nx || jj >= w.ny)) continue;
      ii = wrapI(w, ii); jj = wrapJ(w, jj);
      const dx = Math.floor(x) + di + 0.5 - x, dy = Math.floor(y) + dj + 0.5 - y;
      const d2 = dx * dx + dy * dy;
      if (d2 > r2out) continue;
      const wgt = hard ? 1 : Math.exp(-d2 * invR2);
      if (!hard && wgt < 0.02) continue;
      const c = at(w, ii, jj);
      if (layer === 'h') {
        w.h[c] = Math.min(8000, Math.max(0, w.h[c] + amount * wgt));
      } else if (layer === 'sea') {
        if (hard || wgt > 0.35) { w.sea[c] = amount > 0 ? 1 : 0; if (amount > 0) { w.lake[c] = 0; w.h[c] = 0; } }
      } else if (layer === 'lake') {
        if (hard || wgt > 0.35) {
          w.lake[c] = amount > 0 ? 1 : 0;
          if (amount > 0) { w.sea[c] = 0; w.h[c] = Math.min(w.h[c], 5); }
        }
      } else if (layer === 'sst') {
        const cur = Number.isFinite(w.sst[c]) ? w.sst[c] : 15;
        w.sst[c] = Math.min(35, Math.max(-2, cur + amount * wgt));
      } else if (layer === 'soil') {
        w.soil[c] = Math.min(1, Math.max(0, w.soil[c] + amount * wgt));
      } else if (layer === 'veg') {
        if (hard || wgt > 0.35) w.veg[c] = amount;
      }
    }
  }
}

function noiseField(w, seed, oct = [[3, 1], [6, 0.5], [12, 0.25]]) {
  const rand = rng(seed);
  const layers = oct.map(([p]) => perlinLayer(p, rand));
  const out = new Float32Array(w.nx * w.ny);
  let lo = Infinity, hi = -Infinity;
  for (let j = 0; j < w.ny; j++) {
    for (let i = 0; i < w.nx; i++) {
      const x = (i + 0.5) / w.nx, y = (j + 0.5) / w.ny;
      let v = 0;
      for (let o = 0; o < oct.length; o++) v += oct[o][1] * layers[o](x * oct[o][0], y * oct[o][0]);
      out[at(w, i, j)] = v;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
  }
  const span = hi - lo || 1;
  for (let c = 0; c < out.length; c++) out[c] = (out[c] - lo) / span;
  return out;
}

/** Apply a named preset into world maps (overwrites). */
export function applyPreset(w, kind, seed = w.seed) {
  clearWorld(w);
  w.preset = WORLD_PRESETS[kind] ? kind : 'flat';
  w.seed = seed >>> 0;
  const n = w.nx * w.ny;
  const base = SYN_BASELINES[w.preset] || SYN_BASELINES.flat;
  const sst0 = sstClim(base.lat, 180);

  if (w.preset === 'flat') {
    for (let c = 0; c < n; c++) { w.h[c] = 80; w.soil[c] = 0.55; w.veg[c] = VEG.GRASS; }
    return w;
  }

  if (w.preset === 'island') {
    const elev = noiseField(w, seed, [[4, 1], [8, 0.45], [16, 0.2]]);
    for (let j = 0; j < w.ny; j++) {
      for (let i = 0; i < w.nx; i++) {
        const c = at(w, i, j);
        const x = (i + 0.5) / w.nx, y = (j + 0.5) / w.ny;
        const rr = Math.hypot(d01(x) * 1.15, d01(y)) / 0.32;
        const mask = Math.max(0, 1 - rr * rr);
        if (mask < 0.08) {
          w.sea[c] = 1; w.h[c] = 0; w.sst[c] = sst0 + 1.5; w.soil[c] = 0;
        } else {
          w.h[c] = (120 + 1400 * mask * mask + 500 * elev[c] * mask) * (0.55 + 0.45 * mask);
          w.soil[c] = 0.35 + 0.45 * mask;
          w.veg[c] = mask > 0.75 ? VEG.DECID : mask > 0.4 ? VEG.GRASS : VEG.SCLERO;
          if (w.h[c] > 900) w.veg[c] = VEG.TAIGA;
        }
      }
    }
    return w;
  }

  if (w.preset === 'inland_sea') {
    const elev = noiseField(w, seed ^ 91, [[3, 1], [7, 0.4]]);
    for (let j = 0; j < w.ny; j++) {
      for (let i = 0; i < w.nx; i++) {
        const c = at(w, i, j);
        const x = (i + 0.5) / w.nx, y = (j + 0.5) / w.ny;
        const rr = Math.hypot(d01(x) / 0.28, d01(y) / 0.18);
        if (rr < 1) {
          w.sea[c] = 1; w.h[c] = 0; w.sst[c] = sst0 - 3; w.soil[c] = 0;
        } else {
          w.h[c] = 60 + 350 * elev[c] + 200 * Math.min(1, (rr - 1) * 2);
          w.soil[c] = 0.5 + 0.2 * elev[c];
          w.veg[c] = elev[c] > 0.65 ? VEG.DECID : VEG.GRASS;
        }
      }
    }
    return w;
  }

  if (w.preset === 'archipelago') {
    const elev = noiseField(w, seed ^ 17, [[5, 1], [10, 0.5], [20, 0.25]]);
    for (let j = 0; j < w.ny; j++) {
      for (let i = 0; i < w.nx; i++) {
        const c = at(w, i, j);
        const v = elev[c];
        // several island seeds
        let isl = 0;
        for (let k = 0; k < 7; k++) {
          const cx = hash2(k, 1, seed), cy = hash2(k, 2, seed);
          const rad = 0.08 + 0.07 * hash2(k, 3, seed);
          const dx = d01((i + 0.5) / w.nx - cx), dy = d01((j + 0.5) / w.ny - cy);
          isl = Math.max(isl, Math.max(0, 1 - Math.hypot(dx, dy) / rad));
        }
        const land = Math.max(isl, Math.max(0, (v - 0.62) / 0.38));
        if (land < 0.12) {
          w.sea[c] = 1; w.h[c] = 0; w.sst[c] = sst0 + 2; w.soil[c] = 0;
        } else {
          w.h[c] = 40 + 900 * land * land + 200 * v;
          w.soil[c] = 0.45 + 0.35 * land;
          w.veg[c] = land > 0.7 ? VEG.RAINFOREST : land > 0.35 ? VEG.SAVANNA : VEG.SCLERO;
        }
      }
    }
    return w;
  }

  if (w.preset === 'desert_basin') {
    const elev = noiseField(w, seed ^ 55, [[3, 1], [6, 0.45], [12, 0.2]]);
    for (let j = 0; j < w.ny; j++) {
      for (let i = 0; i < w.nx; i++) {
        const c = at(w, i, j);
        const x = (i + 0.5) / w.nx, y = (j + 0.5) / w.ny;
        const rr = Math.hypot(d01(x) / 0.22, d01(y) / 0.22);
        const rim = Math.exp(-((rr - 0.85) ** 2) / 0.04);
        if (rr < 0.35) {
          w.lake[c] = 1; w.h[c] = 0; w.soil[c] = 0; w.sst[c] = Math.max(sst0, 18);
        } else {
          w.h[c] = 80 + 2200 * rim + 400 * elev[c] * (rr > 0.5 ? 1 : 0.3);
          w.soil[c] = 0.05 + 0.08 * elev[c];
          w.veg[c] = rr < 0.55 ? VEG.DESERT : elev[c] > 0.7 && rim > 0.2 ? VEG.STEPPE : VEG.DESERT;
        }
      }
    }
    return w;
  }

  // mountain_coast: sea on the west, coastal plain, then meridional ridge
  {
    const elev = noiseField(w, seed ^ 123, [[4, 1], [8, 0.4]]);
    for (let j = 0; j < w.ny; j++) {
      for (let i = 0; i < w.nx; i++) {
        const c = at(w, i, j);
        const x = (i + 0.5) / w.nx, y = (j + 0.5) / w.ny;
        const coast = 0.28 + 0.03 * Math.sin(2 * Math.PI * 3 * y);
        if (x < coast) {
          w.sea[c] = 1; w.h[c] = 0; w.sst[c] = sst0 - 1; w.soil[c] = 0;
        } else {
          const ridge = Math.exp(-(((x - 0.62) / 0.09) ** 2));
          w.h[c] = 40 + 2200 * ridge + 250 * elev[c] * (x - coast);
          w.soil[c] = 0.4 + 0.35 * (1 - ridge);
          w.veg[c] = ridge > 0.55 ? (w.h[c] > 1400 ? VEG.TUNDRA : VEG.TAIGA) : (x < coast + 0.12 ? VEG.DECID : VEG.GRASS);
        }
      }
    }
  }
  return w;
}

/** Compact fingerprint of world maps (for climKey / PE rebuild). */
export function worldFingerprint(w) {
  if (!w) return '0';
  let h = (w.seed >>> 0) ^ Math.imul(w.nx, 73856093) ^ Math.imul(w.ny, 19349663);
  const n = w.nx * w.ny, step = Math.max(1, (n / 96) | 0);
  for (let c = 0; c < n; c += step) {
    h = Math.imul(h ^ (Math.round(w.h[c]) | 0), 0x5bd1e995) >>> 0;
    h ^= (w.sea[c] & 1) | ((w.lake[c] & 1) << 1) | ((w.veg[c] & 0xff) << 2);
    h = Math.imul(h ^ Math.round(100 * w.soil[c]), 2246822519) >>> 0;
    if (Number.isFinite(w.sst[c])) h ^= Math.round(10 * w.sst[c]) * 2654435761;
  }
  h ^= (w.preset || '').split('').reduce((a, ch) => a + ch.charCodeAt(0), 0);
  return (h >>> 0).toString(36);
}

/** Pack world maps for getState / links (lossy but small). */
export function packWorld(w) {
  if (!w) return null;
  const n = w.nx * w.ny;
  const sst = new Array(n);
  for (let c = 0; c < n; c++) sst[c] = Number.isFinite(w.sst[c]) ? Math.round(w.sst[c] * 10) / 10 : null;
  return {
    nx: w.nx, ny: w.ny, seed: w.seed, preset: w.preset,
    hemi: w.hemi === 'S' ? 'S' : 'N',
    h: Array.from(w.h, (x) => Math.round(x)),
    sea: Array.from(w.sea),
    lake: Array.from(w.lake),
    sst,
    soil: Array.from(w.soil, (x) => Math.round(100 * x)),
    veg: Array.from(w.veg),
  };
}

/** Restore maps from packWorld output (resizes if nx/ny differ by resampling nearest). */
export function unpackWorld(pack, nx, ny) {
  if (!pack) return null;
  const w = createWorld(nx, ny, pack.seed || 1);
  w.preset = pack.preset || 'flat';
  w.hemi = pack.hemi === 'S' ? 'S' : 'N';
  const same = pack.nx === nx && pack.ny === ny;
  const sample = (arr, fill, i, j) => {
    if (same) return arr[j * pack.nx + i];
    const ii = Math.min(pack.nx - 1, Math.floor((i + 0.5) / nx * pack.nx));
    const jj = Math.min(pack.ny - 1, Math.floor((j + 0.5) / ny * pack.ny));
    return arr[jj * pack.nx + ii] ?? fill;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      const c = j * nx + i;
      w.h[c] = +sample(pack.h, 0, i, j) || 0;
      w.sea[c] = sample(pack.sea, 0, i, j) ? 1 : 0;
      w.lake[c] = sample(pack.lake, 0, i, j) ? 1 : 0;
      const s = sample(pack.sst, null, i, j);
      w.sst[c] = s === null || s === undefined ? NaN : +s;
      w.soil[c] = Math.min(1, Math.max(0, (sample(pack.soil, 55, i, j) || 0) / 100));
      const vg = sample(pack.veg, -1, i, j);
      w.veg[c] = vg === undefined || vg === null ? -1 : vg | 0;
    }
  }
  return w;
}

/**
 * Sampler for the PE channel: maps (lat, lon) into the custom world tile that covers the domain.
 * Domain spans lat0±dLat/2, lon0±dLon/2; outside, the tile wraps (periodic planet).
 */
export function peWorldSampler(w, { lat0, lon0, dx, dy, nx, ny }) {
  const dLat = (ny * dy) / 111320;
  const dLon0 = (nx * dx) / (111320 * Math.max(0.2, Math.cos(lat0 * Math.PI / 180)));
  const toUV = (lat, lon) => {
    let dlo = lon - lon0;
    dlo -= 360 * Math.round(dlo / 360);
    const u = dlo / dLon0 + 0.5;
    // Domain j increases north; world maps match sim.hv (j = 0 at south).
    const v = (lat - (lat0 - dLat / 2)) / dLat;
    return [u - Math.floor(u), v - Math.floor(v)];
  };
  const bilinear = (arr, u, v, isInt = false) => {
    const x = u * w.nx - 0.5, y = v * w.ny - 0.5;
    let i0 = Math.floor(x), j0 = Math.floor(y);
    const fx = x - i0, fy = y - j0;
    i0 = wrapI(w, i0); j0 = wrapJ(w, j0);
    const i1 = wrapI(w, i0 + 1), j1 = wrapJ(w, j0 + 1);
    const a = arr[at(w, i0, j0)], b = arr[at(w, i1, j0)], c = arr[at(w, i0, j1)], d = arr[at(w, i1, j1)];
    if (isInt) {
      // nearest for masks / veg
      const ii = fx < 0.5 ? i0 : i1, jj = fy < 0.5 ? j0 : j1;
      return arr[at(w, ii, jj)];
    }
    const a0 = Number.isFinite(a) ? a : 0, b0 = Number.isFinite(b) ? b : a0;
    const c0 = Number.isFinite(c) ? c : a0, d0 = Number.isFinite(d) ? d : a0;
    return (1 - fx) * (1 - fy) * a0 + fx * (1 - fy) * b0 + (1 - fx) * fy * c0 + fx * fy * d0;
  };
  const sampleSst = (u, v, lat, doy) => {
    const x = u * w.nx - 0.5, y = v * w.ny - 0.5;
    let i0 = Math.floor(x), j0 = Math.floor(y);
    const fx = x - i0, fy = y - j0;
    i0 = wrapI(w, i0); j0 = wrapJ(w, j0);
    const i1 = wrapI(w, i0 + 1), j1 = wrapJ(w, j0 + 1);
    const vals = [w.sst[at(w, i0, j0)], w.sst[at(w, i1, j0)], w.sst[at(w, i0, j1)], w.sst[at(w, i1, j1)]];
    const wts = [(1 - fx) * (1 - fy), fx * (1 - fy), (1 - fx) * fy, fx * fy];
    let s = 0, tw = 0;
    for (let k = 0; k < 4; k++) if (Number.isFinite(vals[k])) { s += wts[k] * vals[k]; tw += wts[k]; }
    if (tw > 0.05) return s / tw;
    return sstClim(lat, doy);
  };

  return {
    lon: lon0,
    custom: true,
    elev(lat, lon) {
      const [u, v] = toUV(lat, lon);
      if (bilinear(w.sea, u, v, true) || bilinear(w.lake, u, v, true)) return -10;
      return Math.max(0, bilinear(w.h, u, v));
    },
    seaAt(lat, lon) {
      // lakes count as sea in the PE channel (enclosed water → high encl, SST from map)
      const [u, v] = toUV(lat, lon);
      return (bilinear(w.sea, u, v, true) || bilinear(w.lake, u, v, true)) ? 1 : 0;
    },
    lakeAt(lat, lon) {
      const [u, v] = toUV(lat, lon);
      return bilinear(w.lake, u, v, true) ? 1 : 0;
    },
    sstAt(lat, lon, doy) {
      const [u, v] = toUV(lat, lon);
      if (!bilinear(w.sea, u, v, true) && !bilinear(w.lake, u, v, true)) return sstClim(lat, doy);
      return sampleSst(u, v, lat, doy);
    },
    soilAt(lat, lon) {
      const [u, v] = toUV(lat, lon);
      if (bilinear(w.sea, u, v, true) || bilinear(w.lake, u, v, true)) return 0;
      return Math.min(1, Math.max(0, bilinear(w.soil, u, v)));
    },
  };
}
