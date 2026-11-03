/* global postDataAndCarryOn */

// Probes that should ideally stay stable when OS settings change (or be
// farbled per first-party). The harness runs this page under settings A/B
// (dock/menu + misc). Screen size is probed separately.
const settingsFingerprintTests = [
  {
    name: 'Time zone',
    description: 'Time zone subregion leaked by the browser.',
    probe: () => String(Intl.DateTimeFormat().resolvedOptions().timeZone)
  },
  {
    name: 'Preferred languages',
    description: 'Your system language list leaked by the browser through the navigator.languages API.',
    probe: () => JSON.stringify(Array.from(navigator.languages || []))
  },
  {
    name: 'Reduced motion preference',
    description: 'Your browser may leak your system reduced motion preference.',
    probe: () => window.matchMedia('(prefers-reduced-motion: reduce)').matches
      ? 'reduce'
      : 'no-preference'
  },
  {
    name: 'Reduced transparency preference',
    description: 'Your browser may leak your system reduced transparency preference.',
    probe: () => window.matchMedia('(prefers-reduced-transparency: reduce)').matches
      ? 'reduce'
      : 'no-preference'
  },
  {
    name: 'Display contrast preference',
    description: 'Your browser may leak your system display contrast preference.',
    probe: () => window.matchMedia('(prefers-contrast: more)').matches
      ? 'more'
      : 'no-preference'
  },
  {
    name: 'Keyboard layout',
    description: 'Checks if the browser is leaking the system keyboard layout.',
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
    name: 'Available screen width',
    description: 'Checks if the browser is leaking the available screen width of the user\'s system.',
    probe: () => String(window.screen.availWidth)
  },
  {
    name: 'Available screen height',
    description: 'Checks if the browser is leaking the available screen height of the user\'s system.',
    probe: () => String(window.screen.availHeight)
  },
  {
    name: 'Available screen left',
    description: 'Checks if the browser is leaking the available screen to the left of the browser window.',
    probe: () => String(window.screen.availLeft)
  },
  {
    name: 'Available screen top',
    description: 'Checks if the browser is leaking the available screen to the top of the browser window.',
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
