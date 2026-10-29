/* global postDataAndCarryOn */

// Probes that should ideally stay stable when OS settings change (or be
// farbled per first-party). The harness runs this page under settings A/B/C.
const settingsFingerprintTests = [
  {
    name: 'Time zone',
    description: 'Time zone leaked by the browser through the DateTimeFormat API.',
    probe: () => String(Intl.DateTimeFormat().resolvedOptions().timeZone)
  },
  {
    name: 'Preferred languages',
    description: 'Your system language list leaked by the browser through the navigator.languages API.',
    probe: () => JSON.stringify(Array.from(navigator.languages || []))
  },
  {
    name: 'Reduced motion preference',
    description: 'matchMedia("(prefers-reduced-motion: reduce)") → "reduce" or "no-preference". Under settings A/B the OS Reduce Motion toggle is on vs off. Stable value means the preference is not exposed (or is spoofed); changing means it leaks.',
    probe: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'reduce'
      : 'no-preference'
  },
  {
    name: 'Reduced transparency preference',
    description: 'matchMedia("(prefers-reduced-transparency: reduce)") → "reduce" or "no-preference". Under settings A/B the OS Reduce Transparency toggle is on vs off.',
    probe: () => window.matchMedia('(prefers-reduced-transparency: reduce)').matches
      ? 'reduce'
      : 'no-preference'
  },
  {
    name: 'Display contrast preference',
    description: 'matchMedia("(prefers-contrast: more)") → "more" or "no-preference". Under settings A/B the OS Increase Contrast toggle is on vs off.',
    probe: () => window.matchMedia('(prefers-contrast: more)').matches
      ? 'more'
      : 'no-preference'
  },
  {
    name: 'Keyboard layout',
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
    name: 'Screen width',
    description: 'Screen width leaked by the browser through the screen API.',
    probe: () => String(window.screen.width)
  },
  {
    name: 'Screen height',
    description: 'Screen height leaked by the browser through the screen API.',
    probe: () => String(window.screen.height)
  },
  {
    name: 'Available screen width',
    description: 'screen.availWidth. Under settings A/B/C Dock is bottom / left / right (autohide off, varying tilesize), so width should change when side chrome is exposed.',
    probe: () => String(window.screen.availWidth)
  },
  {
    name: 'Available screen height',
    description: 'screen.availHeight. Under settings A/B/C Dock is bottom / left / right and the menu bar is shown vs autohide, so height should change when bottom or top chrome is exposed.',
    probe: () => String(window.screen.availHeight)
  },
  {
    name: 'Available screen left',
    description: 'screen.availLeft. Under settings A/B/C Dock is bottom / left / right, so left should be > 0 only when Dock is on the left (if side chrome is exposed).',
    probe: () => String(window.screen.availLeft)
  },
  {
    name: 'Available screen top',
    description: 'screen.availTop. Under settings A/B/C the menu bar is shown vs autohide, so top should change when the menu-bar inset is exposed.',
    probe: () => String(window.screen.availTop)
  },
  {
    name: 'User-installed font (DOM)',
    description: 'Checks if a custom installed font can be detected via DOM layout.',
    probe: () => {
      // Same text with Monoton first; if Monoton applies, both widths match.
      // If it does not, monospace vs sans-serif fallbacks diverge.
      // Must be inline — a block div's getBoundingClientRect().width is the
      // parent width, so both sides would always "match".
      const measure = (fontFamily) => {
        const span = document.createElement('span');
        span.textContent = 'font fingerprinting';
        span.setAttribute(
          'style',
          `position:absolute;left:-9999px;top:0;font-size:72px;font-family:${fontFamily}`);
        document.body.appendChild(span);
        const width = span.getBoundingClientRect().width;
        span.remove();
        return width;
      };
      const width1 = measure('Monoton, Rosemary, monospace');
      const width2 = measure('Monoton, Rosemary, sans-serif');
      const sameWidth = Math.abs(width2 - width1) <= 0.01;
      return sameWidth ? 'detected' : 'not-detected';
    }
  },
  {
    name: 'User-installed font (canvas)',
    description: 'Checks if a custom installed font can be detected via canvas rendering.',
    probe: async () => {
      const text = 'font fingerprinting';
      const size = '48px';
      // Best-effort load; missing fonts reject without blocking the probe.
      if (document.fonts?.load) {
        await Promise.allSettled([
          document.fonts.load(`${size} Monoton`),
          document.fonts.load(`${size} Rosemary`)
        ]);
      }
      const render = (fontFamily) => {
        const canvas = document.createElement('canvas');
        canvas.width = 400;
        canvas.height = 80;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          return null;
        }
        ctx.textBaseline = 'top';
        ctx.font = `${size} ${fontFamily}`;
        ctx.fillStyle = '#000';
        ctx.fillText(text, 10, 10);
        return canvas.toDataURL();
      };
      const withMono = render('Monoton, Rosemary, monospace');
      const withSans = render('Monoton, Rosemary, sans-serif');
      if (!withMono || !withSans) {
        return String(undefined);
      }
      return withMono === withSans ? 'detected' : 'not-detected';
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
