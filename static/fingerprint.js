/* global postDataAndCarryOn */

// High-entropy UA Client Hints (Chromium-family). One getHighEntropyValues() call
// is shared across probes. Values stringify to `"undefined"` when UA-CH is missing.
const uaClientHintDefs = [
  {
    hint: 'architecture',
    description: 'UA-CH high-entropy architecture (e.g. "arm", "x86"). Differs across arm64 vs Intel CI SKUs.'
  },
  {
    hint: 'bitness',
    description: 'UA-CH high-entropy bitness (e.g. "64"). Usually uniform on modern desktop CI.'
  },
  {
    hint: 'platformVersion',
    description: 'UA-CH high-entropy OS version string. Can differ across macos-15 vs macos-26 runners.'
  },
  {
    hint: 'model',
    description: 'UA-CH high-entropy device model. Often empty on desktop; useful on mobile.'
  },
  {
    hint: 'uaFullVersion',
    description: 'UA-CH high-entropy full browser version (deprecated in favor of fullVersionList).'
  },
  {
    hint: 'fullVersionList',
    description: 'UA-CH high-entropy brand/version list. Browser identity, not machine SKU.'
  },
  {
    hint: 'wow64',
    description: 'UA-CH high-entropy WoW64 flag (32-bit process on 64-bit Windows).'
  },
  {
    hint: 'formFactors',
    description: 'UA-CH high-entropy form factors (e.g. Desktop, Mobile, Tablet, XR).'
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

let webGlContext;
const getWebGlContext = () => {
  if (webGlContext !== undefined) {
    return webGlContext;
  }
  try {
    const canvas = document.createElement('canvas');
    webGlContext = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
  } catch (e) {
    webGlContext = null;
  }
  return webGlContext;
};

// Fingerprinting probes. Each entry exposes a named value that can help
// distinguish browsers/devices. `probe` may be sync or async.
// Every probe returns a string (`"undefined"` when the API is missing).
const fingerprintTests = [
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
  // Math probes: inputs chosen (FingerprintJS / Tor #13018) so libm / FPU
  // differences across arm vs x86 show up. Decimal String() round-trips finite
  // floats, so ULP diffs remain visible.
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
    name: 'WebGL vendor/renderer',
    description: 'Unmasked WebGL vendor and renderer (via WEBGL_debug_renderer_info when available). Strong GPU / SKU signal across arm vs Intel CI runners.',
    probe: () => {
      const gl = getWebGlContext();
      if (!gl) {
        return String(undefined);
      }
      const debug = gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debug
        ? gl.getParameter(debug.UNMASKED_VENDOR_WEBGL)
        : gl.getParameter(gl.VENDOR);
      const renderer = debug
        ? gl.getParameter(debug.UNMASKED_RENDERER_WEBGL)
        : gl.getParameter(gl.RENDERER);
      return `${String(vendor)} | ${String(renderer)}`;
    }
  },
  {
    name: 'WebGL extensions',
    description: 'Supported WebGL extensions, sorted and joined with commas. Extension sets often differ by GPU / driver / OS.',
    probe: () => {
      const gl = getWebGlContext();
      if (!gl) {
        return String(undefined);
      }
      const extensions = gl.getSupportedExtensions() || [];
      return extensions.toSorted().join(',');
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
  for (const test of fingerprintTests) {
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
  await postDataAndCarryOn(results, 'fingerprinting');
};

runTests();
