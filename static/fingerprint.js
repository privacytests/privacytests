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
    name: 'navigator.platform',
    description: 'navigator.platform string (e.g. "MacIntel"). Weak SKU signal — often still "MacIntel" on Apple Silicon — but useful alongside UA-CH architecture.',
    probe: () => String(navigator.platform)
  },
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
  {
    // FingerprintJS2 / MaxMind WebGL image: shaded triangle, no text.
    // (Current FingerprintJS dropped the image as unstable; we keep it for
    // cross-SKU leak checks where GPU differences are the point.)
    name: 'WebGL geometry',
    description: 'WebGL shaded triangle drawn with simple vertex/fragment shaders, returned as a data URL. Pixel output often differs across GPUs.',
    probe: () => {
      const canvas = document.createElement('canvas');
      canvas.width = 256;
      canvas.height = 256;
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) {
        return String(undefined);
      }
      const vsSource =
        'attribute vec2 attrVertex;' +
        'varying vec2 varyinTexCoordinate;' +
        'uniform vec2 uniformOffset;' +
        'void main(){' +
        'varyinTexCoordinate=attrVertex+uniformOffset;' +
        'gl_Position=vec4(attrVertex,0,1);' +
        '}';
      const fsSource =
        'precision mediump float;' +
        'varying vec2 varyinTexCoordinate;' +
        'void main(){gl_FragColor=vec4(varyinTexCoordinate,0,1);}';
      const compile = (type, source) => {
        const shader = gl.createShader(type);
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        return shader;
      };
      const program = gl.createProgram();
      gl.attachShader(program, compile(gl.VERTEX_SHADER, vsSource));
      gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fsSource));
      gl.linkProgram(program);
      gl.useProgram(program);
      const buffer = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
      // Same triangle as FingerprintJS2 (3 components per vertex, attr is vec2).
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-0.2, -0.9, 0, 0.4, -0.26, 0, 0, 0.732134444, 0]),
        gl.STATIC_DRAW
      );
      const attr = gl.getAttribLocation(program, 'attrVertex');
      gl.enableVertexAttribArray(attr);
      gl.vertexAttribPointer(attr, 3, gl.FLOAT, false, 0, 0);
      gl.uniform2f(gl.getUniformLocation(program, 'uniformOffset'), 1, 1);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 3);
      return canvas.toDataURL();
    }
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
