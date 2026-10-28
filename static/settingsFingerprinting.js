/* global postDataAndCarryOn */

// Probes that should ideally stay stable when OS settings change (or be
// farbled per first-party). The harness runs this page under settings A and B.
const settingsFingerprintTests = [
  {
    name: 'timeZone',
    description: 'IANA time zone from Intl.DateTimeFormat().resolvedOptions().timeZone. Should not change when the OS time zone changes (or should be farbled per site).',
    probe: () => String(Intl.DateTimeFormat().resolvedOptions().timeZone)
  },
  {
    name: 'navigator.languages',
    description: 'navigator.languages as JSON. Under settings A/B the OS preferred list is en,fr vs en,de. A stable value (e.g. only English) means the browser is censoring additional languages; a changing list means the second language is exposed.',
    probe: () => JSON.stringify(Array.from(navigator.languages || []))
  },
  {
    name: 'prefers-reduced-motion',
    description: 'matchMedia("(prefers-reduced-motion: reduce)") → "reduce" or "no-preference". Under settings A/B the OS Reduce Motion toggle is on vs off. Stable value means the preference is not exposed (or is spoofed); changing means it leaks.',
    probe: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'reduce'
      : 'no-preference'
  },
  {
    name: 'prefers-reduced-transparency',
    description: 'matchMedia("(prefers-reduced-transparency: reduce)") → "reduce" or "no-preference". Under settings A/B the OS Reduce Transparency toggle is on vs off.',
    probe: () => window.matchMedia('(prefers-reduced-transparency: reduce)').matches
      ? 'reduce'
      : 'no-preference'
  },
  {
    name: 'prefers-contrast',
    description: 'matchMedia("(prefers-contrast: more)") → "more" or "no-preference". Under settings A/B the OS Increase Contrast toggle is on vs off.',
    probe: () => window.matchMedia('(prefers-contrast: more)').matches
      ? 'more'
      : 'no-preference'
  },
  {
    name: 'keyboardLayoutMap',
    description: 'Subset of navigator.keyboard.getLayoutMap() for keys that differ across French (AZERTY) vs German (QWERTZ). Chromium-oriented; `"undefined"` when the Keyboard Map API is missing. Stable across layouts means the OS keyboard layout is not exposed.',
    probe: async () => {
      if (!navigator.keyboard?.getLayoutMap) {
        return String(undefined);
      }
      const map = await navigator.keyboard.getLayoutMap();
      // Sample codes that diverge between QWERTY / AZERTY / QWERTZ.
      const codes = [
        'KeyQ', 'KeyW', 'KeyE', 'KeyR', 'KeyT', 'KeyY', 'KeyZ',
        'KeyA', 'KeyM', 'Semicolon', 'BracketLeft', 'Slash'
      ];
      const sample = {};
      for (const code of codes) {
        sample[code] = map.get(code);
      }
      return JSON.stringify(sample);
    }
  }
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
  for (const test of settingsFingerprintTests) {
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
  await postDataAndCarryOn(results, 'settings_fingerprinting');
};

runTests();
