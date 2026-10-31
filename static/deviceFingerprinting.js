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
    name: 'Logical CPU cores',
    description: 'Approximate number of logical CPU cores leaked by the browser through the hardwareConcurrency API.',
    probe: () => String(navigator.hardwareConcurrency)
  },
  {
    name: 'Device memory',
    description: 'Approximate device RAM in GB leaked by the browser through the Device Memory API.',
    probe: () => String(navigator.deviceMemory)
  },
  {
    name: 'JavaScript heap size limit',
    description: 'V8 JavaScript heap size limit in bytes leaked by the browser through the performance.memory.jsHeapSizeLimit API.',
    probe: () => String(performance.memory?.jsHeapSizeLimit)
  },
  {
    name: 'Math: Infinity - Infinity',
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
  // sin/tan: FingerprintJS / Tor samples — useful on non-Chromium; Chromium bundles these.
  {
    name: 'Math.tan(-1e300)',
    description: 'Checks if your browser leaks your CPU architecture via a built-in math function.',
    probe: () => String(Math.tan(-1e300))
  },
  {
    name: 'Math.sin(-1e300)',
    description: 'Checks if your browser leaks your CPU architecture via a built-in math function.',
    probe: () => String(Math.sin(-1e300))
  },
  {
    name: 'Math.tanh(0.123)',
    description: 'Checks if your browser leaks your CPU architecture via a built-in math function.',
    probe: () => String(Math.tanh(0.123))
  },
  {
    // FingerprintJS OfflineAudioContext hash: triangle oscillator → dynamics compressor.
    name: 'AudioContext fingerprint',
    description: 'Your browser can be distinguished from others by the system\'s audio context fingerprint.',
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
    // Geometry-only Canvas2D sample (FingerprintJS renderGeometryImage): blend + winding,
    // no text/fonts. Returns a data URL so GPU/AA differences show up in the pixels.
    name: 'Canvas2D geometry',
    description: 'Tests if your browser leaks behavior of your GPU via the Canvas 2D drawing API.',
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
  ...uaClientHintProbes,
  {
    name: 'AudioContext base latency',
    description: 'AudioContext base latency in seconds leaked by the browser through the baseLatency API.',
    // Measured in runTests. new AudioContext() can block the page thread on a
    // modal microphone prompt, which is not a usable fingerprint.
    probe: null
  }
];

const BASE_LATENCY_NAME = 'AudioContext base latency';
// Long enough for a normal constructor, short enough that a modal prompt
// does not hold the fingerprint page open.
const AUDIO_CONTEXT_CONSTRUCTOR_TIMEOUT_MS = 2000;

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

const recordResult = (results, resultsDiv, name, result) => {
  results[name] = result;
  if (!resultsDiv) {
    return;
  }
  const div = document.createElement('div');
  div.innerText = result.error
    ? `ERROR: ${name} [${result.error}]`
    : `${name}: ${JSON.stringify(result.value)}`;
  resultsDiv.appendChild(div);
};

// new AudioContext() runs on the page thread. A microphone dialog blocks that
// thread, so the timeout has to live in a worker, which posts the pass itself.
const startBaseLatencyWatchdog = (results, description) => {
  const sessionId = new URLSearchParams(window.location.search).get('sessionId');
  const isLocal = window.location.host.endsWith('.example');
  const postURL = isLocal ? 'https://results.pto2.example/post' : 'https://results.privacytests.org/post';
  const payload = {
    sessionId,
    url: window.location.href,
    category: 'device_fingerprinting',
    data: {
      ...results,
      [BASE_LATENCY_NAME]: {
        description,
        value: 'prompt',
        prompted: true
      }
    }
  };
  const source = `
    let posted = false;
    let timer;
    self.onmessage = (event) => {
      if (event.data === 'start') {
        timer = setTimeout(() => {
          posted = true;
          fetch(${JSON.stringify(postURL)}, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(${JSON.stringify(payload)})
          }).then(() => self.postMessage('posted'), () => self.postMessage('posted'));
        }, ${AUDIO_CONTEXT_CONSTRUCTOR_TIMEOUT_MS});
      } else if (event.data === 'cancel') {
        clearTimeout(timer);
        self.postMessage(posted ? 'posted' : 'cancelled');
      }
    };
  `;
  const worker = new Worker(URL.createObjectURL(new Blob([source], { type: 'text/javascript' })));
  worker.postMessage('start');
  return {
    cancel () {
      return new Promise((resolve) => {
        const giveUp = setTimeout(() => {
          worker.terminate();
          resolve(false);
        }, 1000);
        const onMessage = (event) => {
          clearTimeout(giveUp);
          worker.removeEventListener('message', onMessage);
          worker.terminate();
          resolve(event.data === 'posted');
        };
        worker.addEventListener('message', onMessage);
        worker.postMessage('cancel');
      });
    }
  };
};

const runBaseLatencyProbe = async (results, description, resultsDiv) => {
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) {
    recordResult(results, resultsDiv, BASE_LATENCY_NAME, {
      description,
      value: String(undefined)
    });
    return false;
  }
  let watchdog;
  try {
    watchdog = startBaseLatencyWatchdog(results, description);
  } catch (e) {
    watchdog = { cancel: async () => false };
  }
  let latency;
  try {
    const ctx = new Ctx();
    latency = String(ctx.baseLatency);
    ctx.close?.();
  } catch (e) {
    if (await watchdog.cancel()) {
      return true;
    }
    recordResult(results, resultsDiv, BASE_LATENCY_NAME, {
      description,
      value: undefined,
      error: e.toString()
    });
    return false;
  }
  if (await watchdog.cancel()) {
    return true;
  }
  recordResult(results, resultsDiv, BASE_LATENCY_NAME, {
    description,
    value: latency
  });
  return false;
};

const runTests = async () => {
  const results = {};
  const resultsDiv = document.getElementById('test_results');
  for (const test of deviceFingerprintTests) {
    if (test.name === BASE_LATENCY_NAME) {
      const postedByWatchdog = await runBaseLatencyProbe(results, test.description, resultsDiv);
      if (postedByWatchdog) {
        return;
      }
      continue;
    }
    const result = await runProbe(test);
    recordResult(results, resultsDiv, test.name, {
      description: result.description,
      value: result.value,
      ...(result.error ? { error: result.error } : {})
    });
  }
  document.body.setAttribute('data-test-results', JSON.stringify(results));
  await postDataAndCarryOn(results, 'device_fingerprinting');
};

runTests();
