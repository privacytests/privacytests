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
    name: 'screen.availWidth',
    description: 'screen.availWidth in CSS pixels. Under settings A/B the Dock is at bottom vs left (autohide off). Left Dock should shrink availWidth; stable values mean OS chrome insets are not exposed.',
    probe: () => String(screen.availWidth)
  },
  {
    name: 'screen.availHeight',
    description: 'screen.availHeight in CSS pixels. Bottom Dock should shrink availHeight vs left Dock. Paired with screen.availWidth under Dock position A/B.',
    probe: () => String(screen.availHeight)
  },
  {
    name: 'screen.availLeft',
    description: 'screen.availLeft in CSS pixels. Typically 0 with a bottom Dock and > 0 with a left Dock. Stable 0 across A/B can mean the inset is spoofed or unavailable.',
    probe: () => String(screen.availLeft)
  },
  {
    name: 'screen.availTop',
    description: 'screen.availTop in CSS pixels. Under settings A/B the menu bar is shown vs autohide (_HIHideMenuBar). Shown should yield availTop > 0; autohide typically yields 0. Stable values mean the top OS inset is not exposed.',
    probe: () => String(screen.availTop)
  },
  {
    name: 'systemFont',
    description: 'Whether a custom installed font (Monoton) appears to be applied via DOM layout. Under settings A/B the font is installed vs removed. Same metrics across both means the browser is not leaking custom font presence; differing means it is detectable.',
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
    name: 'canvasTextFont',
    description: 'Canvas 2D fillText with Monoton vs monospace/sans-serif fallbacks. Same install/remove A/B as systemFont. Identical bitmaps mean Monoton was applied (detected); divergent bitmaps mean fallbacks (not-detected).',
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
