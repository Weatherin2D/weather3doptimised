/** Chromium/Dawn cancels in-flight GPU futures when the Instance is dropped or the device is under stress. */
export function isGpuDropped(e) {
  const msg = String(e?.message || e || '');
  return /Instance dropped/i.test(msg) || /external Instance reference/i.test(msg);
}

/** Retry a GPU async call a few times when Dawn reports a transient Instance drop. */
export async function gpuRetry(fn, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      if (!isGpuDropped(e) || i === attempts - 1) throw e;
      await new Promise((r) => setTimeout(r, 40 + 80 * i));
    }
  }
  throw last;
}

/** Safer getCompilationInfo — Chromium rejects with OperationError: Instance dropped… under load. */
export async function shaderCompilationInfo(mod) {
  return gpuRetry(() => mod.getCompilationInfo());
}
