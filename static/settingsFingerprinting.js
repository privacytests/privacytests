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
    description: 'navigator.languages as JSON. Under settings A/B the OS preferred list is es,fr vs es,de (Spanish primary so a stuck en-US shows the setter did not take effect). Stable Spanish-only means the second language is hidden; fr vs de in the list means the secondary preference leaks.',
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
  },
  {
    name: 'screen.width',
    description: 'screen.width in CSS pixels. Under settings A/B the display is set to 1920x1080 vs the next available mode smaller in both dimensions. Stable (e.g. rounded) values mean the exact OS resolution is not exposed.',
    probe: () => String(screen.width)
  },
  {
    name: 'screen.height',
    description: 'screen.height in CSS pixels. Paired with screen.width under 1920x1080 vs next-smaller available mode A/B settings.',
    probe: () => String(screen.height)
  },
  {
    name: 'systemFont',
    description: 'Whether a custom installed font (Monoton) appears to be applied. Under settings A/B the font is installed vs removed. Same metrics across both means the browser is not leaking custom font presence; differing means it is detectable.',
    probe: () => {
      // Same text with Monoton first; if Monoton applies, both widths match.
      // If it does not, monospace vs sans-serif fallbacks diverge.
      const div1 = document.createElement('div');
      div1.textContent = 'font fingerprinting';
      div1.setAttribute('style', 'font-family: Monoton, Rosemary, monospace');
      const div2 = document.createElement('div');
      div2.textContent = 'font fingerprinting';
      div2.setAttribute('style', 'font-family: Monoton, Rosemary, sans-serif');
      document.body.appendChild(div1);
      document.body.appendChild(div2);
      const width1 = div1.getBoundingClientRect().width;
      const width2 = div2.getBoundingClientRect().width;
      div1.remove();
      div2.remove();
      const sameWidth = Math.abs(width2 - width1) <= 0.01;
      return sameWidth ? 'detected' : 'not-detected';
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
