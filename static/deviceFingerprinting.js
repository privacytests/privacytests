/* global postDataAndCarryOn */

// High-entropy UA Client Hints (Chromium-family). One getHighEntropyValues() call
// is shared across probes. Values stringify to `"undefined"` when UA-CH is missing.
const uaClientHintDefs = [
  {
    hint: 'architecture',
    description: 'UA-CH high-entropy architecture (e.g. "arm", "x86"). Differs across arm64 vs Intel CI SKUs.'
  },
  {
    hint: 'platformVersion',
    description: 'UA-CH high-entropy OS version string. Can differ across macos-15 vs macos-26 runners.'
  },
  {
    hint: 'model',
    description: 'UA-CH high-entropy device model. Often empty on desktop; useful on mobile.'
  }
];

const stringifyUaHint = (v) => {
  if (v == null) {
    return String(v);
  }
  if (typeof v === 'object') {
    return JSON.stringify(v);
  }
  return String(v);
};

let uaClientHintsPromise;
const loadUaClientHints = () => {
  if (!uaClientHintsPromise) {
    uaClientHintsPromise = navigator.userAgentData?.getHighEntropyValues
      ? navigator.userAgentData.getHighEntropyValues(uaClientHintDefs.map(d => d.hint))
      : Promise.resolve(null);
  }
  return uaClientHintsPromise;
};

const uaClientHintProbes = uaClientHintDefs.map(({ hint, description }) => ({
  name: `userAgentData.${hint}`,
  description,
  probe: async () => {
    const data = await loadUaClientHints();
    return stringifyUaHint(data?.[hint]);
  }
}));

// Device fingerprinting probes. Each entry exposes a named value that can help
// distinguish browsers/devices. `probe` may be sync or async.
// Every probe returns a string (`"undefined"` when the API is missing).
// WebGL probes omitted for now: CI macOS runners often cannot create a WebGL
// context (Firefox/Safari system GL; Intel Chrome blocklist), so results were
// mostly `"undefined"` and not realistic hardware signals.
const deviceFingerprintTests = [
  {
    name: 'navigator.hardwareConcurrency',
    description: 'Approximate number of logical CPU cores reported by the browser. Often differs between arm64 and Intel hosts and is commonly used in browser fingerprints.',
    probe: () => String(navigator.hardwareConcurrency)
  },
  {
    name: 'navigator.deviceMemory',
    description: 'Approximate device RAM in GiB (Device Memory API), coarsened to a power of two. Chromium-only; `"undefined"` in browsers that do not implement the API.',
    probe: () => String(navigator.deviceMemory)
  },
  {
    name: 'jsHeapSizeLimit',
    description: 'V8 JavaScript heap size limit in bytes (`performance.memory.jsHeapSizeLimit`). Chromium-only; `"undefined"` when unavailable. Correlates with available memory and is a known high-entropy fingerprinting signal.',
    probe: () => String(performance.memory?.jsHeapSizeLimit)
  },
  {
    name: 'architecture (NaN)',
    description: 'FingerprintJS-style architecture probe: byte 3 of a Float32 NaN payload after `Infinity - Infinity`. Differs between CPU architectures (e.g. arm64 vs x86). Kept as a raw byte (not String(NaN)) so the payload is visible.',
    probe: () => {
      const f = new Float32Array(1);
      const u8 = new Uint8Array(f.buffer);
      f[0] = Infinity;
      f[0] = f[0] - f[0];
      return String(u8[3]);
    }
  },
  // Math probes. Decimal String() round-trips finite floats (ULP diffs stay visible).
  // sin/cos/tan: FingerprintJS / Tor samples — useful on non-Chromium; Chromium bundles these.
  // tanh: since Chrome 148 uses host libm (OS fingerprint; may still match across mac SKUs).
  {
    name: 'Math.tan(-1e300)',
    description: 'Math.tan(-1e300) as a decimal string. Classic cross-architecture / libm fingerprint; often differs between arm64 and x86.',
    probe: () => String(Math.tan(-1e300))
  },
  {
    name: 'Math.sin(-1e300)',
    description: 'Math.sin(-1e300) as a decimal string. Same class of transcendental edge-case as tan; useful arm vs x86 signal.',
    probe: () => String(Math.sin(-1e300))
  },
  {
    name: 'Math.cos(10.000000000123)',
    description: 'Math.cos(10.000000000123) as a decimal string. FingerprintJS cosine sample; can differ with math library / architecture.',
    probe: () => String(Math.cos(10.000000000123))
  },
  {
    name: 'Math.tanh(0.8)',
    description: 'Math.tanh(0.8) as a decimal string. Since Chrome 148, tanh uses host libm and can differ across OS (mac / Linux / Windows); often identical across macOS SKUs.',
    probe: () => String(Math.tanh(0.8))
  },
  {
    // FingerprintJS OfflineAudioContext hash: triangle oscillator → dynamics compressor.
    name: 'AudioContext fingerprint',
    description: 'Sum of absolute samples from an OfflineAudioContext triangle+compressor render (FingerprintJS-style). Can differ across audio stacks / architectures.',
    probe: async () => {
      const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
      if (!OfflineCtx) {
        return String(undefined);
      }
      const context = new OfflineCtx(1, 5000, 44100);
      const oscillator = context.createOscillator();
      oscillator.type = 'triangle';
      oscillator.frequency.value = 10000;
      const compressor = context.createDynamicsCompressor();
      compressor.threshold.value = -50;
      compressor.knee.value = 40;
      compressor.ratio.value = 12;
      compressor.attack.value = 0;
      compressor.release.value = 0.25;
      oscillator.connect(compressor);
      compressor.connect(context.destination);
      oscillator.start(0);
      const buffer = await context.startRendering();
      const data = buffer.getChannelData(0).subarray(4500);
      let hash = 0;
      for (let i = 0; i < data.length; ++i) {
        hash += Math.abs(data[i]);
      }
      return String(hash);
    }
  },
  {
    name: 'AudioContext.baseLatency',
    description: 'AudioContext.baseLatency in seconds. May differ across audio backends / OS / architecture.',
    probe: () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) {
        return String(undefined);
      }
      const ctx = new Ctx();
      const latency = ctx.baseLatency;
      ctx.close?.();
      return String(latency);
    }
  },
  {
    // Geometry-only Canvas2D sample (FingerprintJS renderGeometryImage): blend + winding,
    // no text/fonts. Returns a data URL so GPU/AA differences show up in the pixels.
    name: 'Canvas2D geometry',
    description: 'Canvas 2D drawing fingerprint using multiply-blended arcs and evenodd winding (no text). Pixel output often differs across GPUs and OS compositors.',
    probe: () => {
      const canvas = document.createElement('canvas');
      canvas.width = 122;
      canvas.height = 110;
      const ctx = canvas.getContext('2d');
      if (!ctx || !canvas.toDataURL) {
        return String(undefined);
      }
      ctx.globalCompositeOperation = 'multiply';
      for (const [color, x, y] of [['#f2f', 40, 40], ['#2ff', 80, 40], ['#ff2', 60, 80]]) {
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.arc(x, y, 40, 0, Math.PI * 2, true);
        ctx.closePath();
        ctx.fill();
      }
      ctx.fillStyle = '#f9c';
      ctx.arc(60, 60, 60, 0, Math.PI * 2, true);
      ctx.arc(60, 60, 20, 0, Math.PI * 2, true);
      ctx.fill('evenodd');
      return canvas.toDataURL();
    }
  },
  ...uaClientHintProbes
];

const runProbe = async ({ name, description, probe }) => {
  let value;
  let error;
  try {
    value = String(await probe());
  } catch (e) {
    error = e.toString();
  }
  return {
    name,
    description,
    value,
    ...(error ? { error } : {})
  };
};

const runTests = async () => {
  const results = {};
  const resultsDiv = document.getElementById('test_results');
  for (const test of deviceFingerprintTests) {
    const result = await runProbe(test);
    results[test.name] = {
      description: result.description,
      value: result.value,
      ...(result.error ? { error: result.error } : {})
    };
    if (resultsDiv) {
      const div = document.createElement('div');
      div.innerText = result.error
        ? `ERROR: ${test.name} [${result.error}]`
        : `${test.name}: ${JSON.stringify(result.value)}`;
      resultsDiv.appendChild(div);
    }
  }
  document.body.setAttribute('data-test-results', JSON.stringify(results));
  await postDataAndCarryOn(results, 'device_fingerprinting');
};

runTests();
