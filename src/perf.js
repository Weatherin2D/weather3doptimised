// Adaptive performance for low-end GPUs and high-resolution domains.
// Quality modes trade a little solver fidelity / UI freshness for smoother frames.

export const QUALITY_MODES = [
  { id: 'auto', name: 'Auto', hint: 'Pick Smooth / Balanced / Fidelity from the graphics card and grid size' },
  { id: 'smooth', name: 'Smooth', hint: 'Prioritise fluid display; fewer CG iterations, lighter diagnostics' },
  { id: 'balanced', name: 'Balanced', hint: 'Good default for most machines' },
  { id: 'fidelity', name: 'Fidelity', hint: 'Full solver and frequent diagnostics (best cards)' },
];

const LS_KEY = 'w3d-quality';

export function loadQualityMode() {
  try {
    const m = localStorage.getItem(LS_KEY);
    if (QUALITY_MODES.some((q) => q.id === m)) return m;
  } catch { /* no storage */ }
  return 'auto';
}

export function saveQualityMode(id) {
  try { localStorage.setItem(LS_KEY, id); } catch { /* no storage */ }
}

/** Classify the WebGPU adapter: low (iGPU / weak), mid, high (desktop discrete). */
export function detectGpuTier(adapter, infoIn) {
  const info = infoIn || adapter.info || {};
  const blob = `${info.description || ''} ${info.vendor || ''} ${info.architecture || ''} ${info.device || ''}`.toLowerCase();
  const mem = adapter.limits?.maxBufferSize || 0;
  let tier = 'mid';
  let reason = 'unknown adapter';

  const isIntel = /intel/.test(blob);
  const isApple = /apple|metal/.test(blob);
  const isAmd = /amd|radeon|advanced micro/.test(blob);
  const isNvidia = /nvidia|geforce|quadro|rtx|gtx/.test(blob);
  const isQualcomm = /qualcomm|adreno/.test(blob);
  const isSwift = /swiftshader|llvmpipe|microsoft basic|cpu/.test(blob);
  const isIntegrated = /uhd|iris|radeon graphics(?!\s+pro)|vega\s*[0-9]|integrated|adreno|mali|apple m[1-3](?!\s*pro|\s*max|\s*ultra)/.test(blob)
    || (isIntel && !/arc/.test(blob));

  if (isSwift) { tier = 'low'; reason = 'software renderer'; }
  else if (isQualcomm || /mali|powervr/.test(blob)) { tier = 'low'; reason = 'mobile GPU'; }
  else if (isIntegrated && !isApple) { tier = 'low'; reason = 'integrated GPU'; }
  else if (isApple && /m1(?!\s*pro|\s*max|\s*ultra)|m2(?!\s*pro|\s*max|\s*ultra)/.test(blob)) { tier = 'mid'; reason = 'Apple Silicon'; }
  else if (isApple) { tier = 'high'; reason = 'Apple Silicon Pro/Max'; }
  else if (isNvidia && /(rtx\s*(20|16)|gtx\s*(10|9|16)|mx\s*\d)/.test(blob)) { tier = 'mid'; reason = 'entry / older NVIDIA'; }
  else if (isNvidia && /(rtx\s*(30|40|50)|quadro|a[0-9]{3,4})/.test(blob)) { tier = 'high'; reason = 'NVIDIA discrete'; }
  else if (isNvidia) { tier = 'mid'; reason = 'NVIDIA'; }
  else if (isAmd && /(rx\s*6|rx\s*7|rx\s*5[6-9]|radeon pro)/.test(blob)) { tier = 'high'; reason = 'AMD discrete'; }
  else if (isAmd && isIntegrated) { tier = 'low'; reason = 'AMD iGPU'; }
  else if (isAmd) { tier = 'mid'; reason = 'AMD'; }
  else if (isIntel && /arc/.test(blob)) { tier = 'mid'; reason = 'Intel Arc'; }
  else if (mem > 0 && mem < 512 * 1024 * 1024) { tier = 'low'; reason = 'small GPU buffers'; }
  else if (mem > 2 * 1024 * 1024 * 1024) { tier = 'high'; reason = 'large GPU buffers'; }

  const label = (info.description || info.vendor || 'WebGPU adapter').trim() || 'WebGPU adapter';
  return { tier, label, reason, info };
}

/** Prefer adapter.info; fall back to requestAdapterInfo() on older Chrome. */
export async function detectGpuTierAsync(adapter) {
  let info = adapter.info || null;
  if ((!info || !info.description) && typeof adapter.requestAdapterInfo === 'function') {
    try { info = await adapter.requestAdapterInfo(); } catch { /* blocked / unsupported */ }
  }
  return detectGpuTier(adapter, info || undefined);
}

/** Resolve auto → concrete mode from GPU tier and grid cell count (3D cells). */
export function resolveQuality(mode, tier, cells = 0) {
  if (mode && mode !== 'auto') return mode;
  if (tier === 'low') return cells > 2.5e6 ? 'smooth' : 'balanced';
  if (tier === 'high') return cells > 4e6 ? 'balanced' : 'fidelity';
  return cells > 3e6 ? 'smooth' : 'balanced';
}

/** Conjugate-gradient iterations for terrain pressure solve (URL ?cg= wins). */
export function cgItersFor(quality, cells, urlCg) {
  if (urlCg > 0) return Math.min(20, Math.max(1, urlCg | 0));
  if (quality === 'fidelity') return cells > 5e6 ? 3 : 4;
  if (quality === 'balanced') return cells > 3e6 ? 2 : (cells > 1.5e6 ? 3 : 4);
  return cells > 2e6 ? 2 : 3;
}

export function frameBudgetMs(quality, v3on, frameMsEma = 0) {
  let ms = quality === 'smooth' ? 14 : quality === 'balanced' ? 20 : 28;
  if (v3on) ms = Math.max(8, ms - (quality === 'smooth' ? 6 : 4));
  if (frameMsEma > 40) ms = Math.min(ms, quality === 'fidelity' ? 16 : 10);
  else if (frameMsEma > 28) ms = Math.min(ms, ms * 0.75);
  return ms;
}

export function diagIntervalMs(quality, nxy) {
  const scale = Math.max(1, Math.sqrt(nxy / 20000));
  const base = quality === 'smooth' ? 900 : quality === 'balanced' ? 550 : 400;
  return Math.min(2000, Math.round(base * scale));
}

export function canvasScale(quality, v3on) {
  if (v3on) return quality === 'smooth' ? 0.4 : quality === 'balanced' ? 0.5 : 0.6;
  return quality === 'smooth' ? 0.75 : quality === 'balanced' ? 0.9 : 1;
}

export function volStride(quality) {
  return quality === 'smooth' ? 2 : 1;
}

export function maxStepsFor(quality) {
  return quality === 'smooth' ? 48 : quality === 'balanced' ? 80 : 128;
}

export function costFactor(tier) {
  return tier === 'low' ? 5.5 : tier === 'mid' ? 2.2 : 1;
}

export function recommendNz(tier, nx, ny, quality) {
  const cells2 = nx * ny;
  const q = quality === 'auto' ? (tier === 'low' ? 'smooth' : 'balanced') : quality;
  if (q === 'fidelity') return 0;
  if (tier === 'low' && cells2 >= 160 * 160) return 36;
  if (tier === 'low' && cells2 >= 100 * 100) return 40;
  if ((tier === 'mid' || q === 'smooth') && cells2 >= 200 * 200) return 40;
  if (cells2 >= 256 * 256 && q !== 'fidelity') return 40;
  return 0;
}

export function recommendRes(tier, quality) {
  if (quality === 'fidelity' || (quality === 'auto' && tier === 'high')) return 256;
  if (tier === 'low' || quality === 'smooth') return 128;
  return 200;
}
