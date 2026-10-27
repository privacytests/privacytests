/* global postDataAndCarryOn */

// Fingerprinting probes. Each entry exposes a named value that can help
// distinguish browsers/devices. `probe` may be sync or async.
const fingerprintTests = [
  {
    name: 'navigator.hardwareConcurrency',
    description: 'Approximate number of logical CPU cores reported by the browser. Often differs between arm64 and Intel hosts and is commonly used in browser fingerprints.',
    probe: () => navigator.hardwareConcurrency
  },
  {
    name: 'navigator.deviceMemory',
    description: 'Approximate device RAM in GiB (Device Memory API), coarsened to a power of two. Chromium-only; undefined in browsers that do not implement the API.',
    probe: () => navigator.deviceMemory
  },
  {
    name: 'jsHeapSizeLimit',
    description: 'V8 JavaScript heap size limit in bytes (`performance.memory.jsHeapSizeLimit`). Chromium-only; correlates with available memory and is a known high-entropy fingerprinting signal.',
    probe: () => performance.memory?.jsHeapSizeLimit
  }
];

const runProbe = async ({ name, description, probe }) => {
  let value;
  let error;
  try {
    value = await probe();
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
