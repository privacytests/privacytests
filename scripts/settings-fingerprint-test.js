// Settings fingerprinting: change OS settings A → B, probe in a fresh browser
// on three first-party domains each time, then score stability vs farbling.
const os = require('os');
const systemSettings = require('./system-settings');
const { sleepMs } = require('./utils');

const settingsRoots = [
  'https://test-pages.privacytests2.org',
  'https://test-pages.privacytests.org',
  'https://test-pages.privacytests3.org'
];

const screenSizeA = { width: 1920, height: 1080 };

// A/B pairs: distinct time zones, second languages, and a11y display toggles
// so we can see whether browsers expose those setting changes.
const settingsFingerprintConfigs = [
  {
    id: 'A',
    timezone: 'Europe/Paris',
    languages: ['es', 'fr'],
    // AZERTY vs QWERTZ — distinguishable via Keyboard Map API.
    keyboardLayout: 'French',
    screenSize: screenSizeA,
    reducedMotion: true,
    reducedTransparency: true,
    increaseContrast: true
  },
  {
    id: 'B',
    timezone: 'Europe/Berlin',
    languages: ['es', 'de'],
    keyboardLayout: 'German',
    // Filled in at run time: next enumerated mode smaller than A in both dims.
    screenSize: null,
    reducedMotion: false,
    reducedTransparency: false,
    increaseContrast: false
  }
];

const log = (...args) => {
  console.log(new Date().toISOString(), ...args);
};

const settingLabel = ({
  timezone, languages, keyboardLayout, screenSize,
  reducedMotion, reducedTransparency, increaseContrast
}) =>
  `${timezone}; languages=${languages.join(',')}; keyboardLayout=${keyboardLayout}; ` +
  (screenSize ? `screen=${screenSize.width}x${screenSize.height}; ` : '') +
  `reducedMotion=${reducedMotion}; reducedTransparency=${reducedTransparency}; ` +
  `increaseContrast=${increaseContrast}`;

// Each probe only cares about one A/B dimension — tooltips should show that alone.
const relevantSettingForProbe = {
  timeZone: ({ timezone }) => timezone,
  'navigator.languages': ({ languages }) => languages.join(','),
  'prefers-reduced-motion': ({ reducedMotion }) => String(reducedMotion),
  'prefers-reduced-transparency': ({ reducedTransparency }) => String(reducedTransparency),
  'prefers-contrast': ({ increaseContrast }) => String(increaseContrast),
  keyboardLayoutMap: ({ keyboardLayout }) => keyboardLayout,
  'screen.width': ({ screenSize }) =>
    (screenSize ? `${screenSize.width}x${screenSize.height}` : null),
  'screen.height': ({ screenSize }) =>
    (screenSize ? `${screenSize.width}x${screenSize.height}` : null)
};

const screenSizeKey = ({ width, height }) => `${width}x${height}`;

// Resolve B's screen size from available modes; return false if A/B can't both run.
const prepareScreenSizes = () => {
  const available = systemSettings.listScreenSizes();
  const availableKeys = new Set(available.map(screenSizeKey));
  log('settings fingerprinting: available display sizes', [...availableKeys]);
  if (available.length < 2 || !availableKeys.has(screenSizeKey(screenSizeA))) {
    return false;
  }
  let screenSizeB;
  try {
    screenSizeB = systemSettings.getNextSmallerScreenSize(screenSizeA);
  } catch (e) {
    log('settings fingerprinting: no next-smaller mode than', screenSizeKey(screenSizeA), e.message || e);
    return false;
  }
  const configB = settingsFingerprintConfigs.find(({ id }) => id === 'B');
  configB.screenSize = screenSizeB;
  log('settings fingerprinting: screen A/B', screenSizeKey(screenSizeA), '→', screenSizeKey(screenSizeB));
  return true;
};

// Snapshot of host settings before A/B mutation (also used by test.js cleanup).
let originalSettings = null;
let varyScreenSize = false;

const saveOriginalSettings = () => {
  if (os.platform() !== 'darwin') {
    return;
  }
  originalSettings = {
    timezone: systemSettings.getTimezone(),
    languages: systemSettings.getLanguages(),
    keyboardLayout: systemSettings.getKeyboardLayout(),
    screenSize: systemSettings.getScreenSize(),
    reducedMotion: systemSettings.getReducedMotion(),
    reducedTransparency: systemSettings.getReducedTransparency(),
    increaseContrast: systemSettings.getIncreaseContrast()
  };
  log('settings fingerprinting: saved', originalSettings);
};

const restoreOriginalSettings = () => {
  if (!originalSettings) {
    return;
  }
  try {
    log('settings fingerprinting: restoring', originalSettings);
    systemSettings.setTimezone(originalSettings.timezone);
    if (originalSettings.languages.length > 0) {
      systemSettings.setLanguages(originalSettings.languages);
    }
    if (originalSettings.keyboardLayout) {
      systemSettings.setKeyboardLayout(originalSettings.keyboardLayout);
    }
    if (varyScreenSize && originalSettings.screenSize) {
      systemSettings.setScreenSize(originalSettings.screenSize);
    }
    systemSettings.setReducedMotion(originalSettings.reducedMotion);
    systemSettings.setReducedTransparency(originalSettings.reducedTransparency);
    systemSettings.setIncreaseContrast(originalSettings.increaseContrast);
  } catch (e) {
    log('settings fingerprinting: failed to restore settings', e);
  }
};

// Merge per-domain probe results. Differing values across first parties → farbled.
const mergeDomainResults = (perDomain) => {
  const names = new Set(perDomain.flatMap(results => Object.keys(results)));
  const merged = {};
  for (const name of names) {
    const items = perDomain.map(results => results[name]).filter(Boolean);
    if (items.length === 0) {
      continue;
    }
    const values = items.map(item => item.value);
    const randomized = new Set(values).size > 1;
    merged[name] = {
      description: items[0].description,
      value: randomized ? values : values[0],
      randomized,
      ...(items.some(item => item.error)
        ? { error: items.map(item => item.error).filter(Boolean).join('; ') }
        : {})
    };
  }
  return merged;
};

// Pass if every settings-run farbled across first parties, or if the (stable)
// value is identical across settings A/B.
const mergeSettingsFingerprintResults = (perSetting) => {
  const names = new Set(perSetting.flatMap(({ results }) => Object.keys(results)));
  const merged = {};
  for (const name of names) {
    const items = perSetting
      .map(({ config, results }) => ({ config, result: results[name] }))
      .filter(({ result }) => result);
    if (items.length === 0) {
      continue;
    }
    const values = items.map(({ result }) => result.value);
    const randomized = items.map(({ result }) => Boolean(result.randomized));
    const allFarbled = randomized.every(Boolean);
    const stableAcrossSettings = values.every(
      v => JSON.stringify(v) === JSON.stringify(values[0]));
    const relevant = relevantSettingForProbe[name];
    const settings = relevant
      ? items.map(({ config }) => relevant(config)).filter(v => v != null)
      : items.map(({ config }) => settingLabel(config));
    merged[name] = {
      description: items[0].result.description,
      value: values,
      settings,
      randomized,
      passed: allFarbled || stableAcrossSettings,
      ...(items.some(({ result }) => result.error)
        ? { error: items.map(({ result }) => result.error).filter(Boolean).join('; ') }
        : {})
    };
  }
  return merged;
};

// Firefox-specific prefs that mirror OS language / reduced-motion settings.
const applyFirefoxSettingsPrefs = async (browserSession, { languages, reducedMotion }) => {
  if (browserSession.browser._defaults?.basedOn !== 'firefox') {
    return;
  }
  await browserSession.browser.kill();
  await browserSession.browser.setPref('intl.accept_languages', languages.join(','));
  // 1 = reduce, 0 = no preference.
  await browserSession.browser.setPref('ui.prefersReducedMotion', reducedMotion ? 1 : 0);
  await browserSession.browser.launch(false);
};

// Apply each OS settings config, launch a fresh browser, run the three-domain
// settings fingerprint page, then restore prior OS settings.
// `runPageTest` is injected from test.js (websocket/session helper).
const runSettingsFingerprintTests = async (browserSession, { runPageTest }) => {
  if (os.platform() !== 'darwin') {
    log('settings fingerprinting: skipping (macOS only)');
    return {};
  }
  if (!originalSettings) {
    saveOriginalSettings();
  }
  varyScreenSize = prepareScreenSizes();
  if (!varyScreenSize) {
    log('settings fingerprinting: skipping screen size A/B (need 1920x1080 plus a smaller mode)');
  }
  try {
    const perSetting = [];
    for (const config of settingsFingerprintConfigs) {
      const applied = varyScreenSize ? config : { ...config, screenSize: null };
      log('settings fingerprinting: applying', applied);
      systemSettings.setTimezone(applied.timezone);
      systemSettings.setLanguages(applied.languages);
      systemSettings.setKeyboardLayout(applied.keyboardLayout);
      if (varyScreenSize) {
        systemSettings.setScreenSize(applied.screenSize);
      }
      systemSettings.setReducedMotion(applied.reducedMotion);
      systemSettings.setReducedTransparency(applied.reducedTransparency);
      systemSettings.setIncreaseContrast(applied.increaseContrast);
      // Give the OS / browsers a moment to notice the new settings.
      await sleepMs(2000);
      await browserSession.browser.launch(true);
      try {
        await applyFirefoxSettingsPrefs(browserSession, applied);
        const perDomain = [];
        for (const root of settingsRoots) {
          const url = `${root}/settingsFingerprinting.html`;
          log('settings fingerprint domain', {
            setting: settingLabel(applied),
            url
          });
          perDomain.push(await runPageTest(browserSession, url));
        }
        perSetting.push({
          config: applied,
          results: mergeDomainResults(perDomain)
        });
      } finally {
        await browserSession.browser.kill();
      }
    }
    const merged = mergeSettingsFingerprintResults(perSetting);
    // Don't score screen probes when we never varied the display — identical
    // A/B values would look like a false privacy pass.
    if (!varyScreenSize) {
      delete merged['screen.width'];
      delete merged['screen.height'];
    }
    return { settings_fingerprinting: merged };
  } finally {
    restoreOriginalSettings();
  }
};

module.exports = {
  runSettingsFingerprintTests,
  saveOriginalSettings,
  restoreOriginalSettings
};
