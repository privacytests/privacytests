// Settings fingerprinting: change OS settings A → B, probe in a fresh browser
// on three first-party domains each time, then score stability vs farbling.
// Screen size is tested separately (see screen-fingerprint-test.js).
const os = require('os');
const systemSettings = require('./system-settings');
const { sleepMs } = require('./utils');

const settingsRoots = [
  'https://test-pages.privacytests2.org',
  'https://test-pages.privacytests.org',
  'https://test-pages.privacytests3.org'
];

// Dock stays on the sides so it doesn't affect availHeight. Small on the left,
// larger on the right so availWidth / availLeft move clearly.
const dockTileSizeLeft = 16;
const dockTileSizeRight = 32;

// A/B: side dock + menu bar chrome, and misc OS settings.
// Display resolution stays fixed (see screen-fingerprint-test.js).
const settingsFingerprintConfigs = [
  {
    id: 'A',
    timezone: 'Europe/Paris',
    // AZERTY vs QWERTZ — distinguishable via Keyboard Map API.
    keyboardLayout: 'French',
    // Absent first, then install — avoids stale font-cache after deletion.
    testFontInstalled: false,
    // Side dock (autohide forced off) for Available screen width / left.
    dockOrientation: 'left',
    dockTileSize: dockTileSizeLeft,
    // Menu bar shown vs autohide (_HIHideMenuBar) for Available screen height / top.
    hideMenuBar: false,
    reducedMotion: false,
    reducedTransparency: false,
    increaseContrast: false
  },
  {
    id: 'B',
    timezone: 'Europe/Berlin',
    keyboardLayout: 'German',
    testFontInstalled: true,
    dockOrientation: 'right',
    dockTileSize: dockTileSizeRight,
    hideMenuBar: true,
    reducedMotion: true,
    reducedTransparency: true,
    increaseContrast: true
  }
];

const log = (...args) => {
  console.log(new Date().toISOString(), ...args);
};

const settingLabel = ({
  timezone, keyboardLayout, testFontInstalled,
  dockOrientation, dockTileSize: tileSize, hideMenuBar, reducedMotion,
  reducedTransparency, increaseContrast
}) =>
  `${timezone}; keyboardLayout=${keyboardLayout}; ` +
  `testFontInstalled=${testFontInstalled}; dock=${dockOrientation}; ` +
  `dockTileSize=${tileSize}; hideMenuBar=${hideMenuBar}; ` +
  `reducedMotion=${reducedMotion}; reducedTransparency=${reducedTransparency}; ` +
  `increaseContrast=${increaseContrast}`;

// Each probe only cares about one A/B dimension — tooltips should show that alone.
const relevantSettingForProbe = {
  'Time zone': ({ timezone }) => timezone,
  'Reduced motion preference': ({ reducedMotion }) => String(reducedMotion),
  'Reduced transparency preference': ({ reducedTransparency }) => String(reducedTransparency),
  'Display contrast preference': ({ increaseContrast }) => String(increaseContrast),
  'Keyboard layout': ({ keyboardLayout }) => keyboardLayout,
  'Available screen width': ({ dockOrientation, dockTileSize: tileSize }) =>
    `${dockOrientation}@${tileSize}`,
  'Available screen height': ({ hideMenuBar }) => String(hideMenuBar),
  'Available screen left': ({ dockOrientation }) => dockOrientation,
  'Available screen top': ({ hideMenuBar }) => String(hideMenuBar),
  'User-installed font (DOM)': ({ testFontInstalled }) => String(testFontInstalled),
  'User-installed font (canvas)': ({ testFontInstalled }) => String(testFontInstalled)
};

// Snapshot of host settings before A/B mutation (also used by test.js cleanup).
let originalSettings = null;

const saveOriginalSettings = () => {
  if (os.platform() !== 'darwin') {
    return;
  }
  originalSettings = {
    timezone: systemSettings.getTimezone(),
    keyboardLayout: systemSettings.getKeyboardLayout(),
    testFontInstalled: systemSettings.getTestFontInstalled(),
    dockOrientation: systemSettings.getDockOrientation(),
    dockAutohide: systemSettings.getDockAutohide(),
    dockTileSize: systemSettings.getDockTileSize(),
    dockMagnification: systemSettings.getDockMagnification(),
    hideMenuBar: systemSettings.getHideMenuBar(),
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
    if (originalSettings.keyboardLayout) {
      systemSettings.setKeyboardLayout(originalSettings.keyboardLayout);
    }
    systemSettings.setTestFontInstalled(originalSettings.testFontInstalled);
    systemSettings.setDockOrientation(originalSettings.dockOrientation);
    systemSettings.setDockAutohide(originalSettings.dockAutohide);
    // setDockTileSize forces magnification off; restore magnification after.
    systemSettings.setDockTileSize(originalSettings.dockTileSize);
    systemSettings.setDockMagnification(originalSettings.dockMagnification);
    systemSettings.setHideMenuBar(originalSettings.hideMenuBar);
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

// Join settings A/B for tooltips: A vs B uses "|". Domain-farbling within a
// setting is shown as [v1,v2,v3]. Runner aggregation then comma-joins as usual.
const joinSettingsVariants = (variants) =>
  variants.map(v => (Array.isArray(v) ? `[${v.join(',')}]` : String(v))).join('|');

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
      value: joinSettingsVariants(values),
      settings: joinSettingsVariants(settings),
      randomized: joinSettingsVariants(randomized),
      passed: allFarbled || stableAcrossSettings,
      ...(items.some(({ result }) => result.error)
        ? { error: items.map(({ result }) => result.error).filter(Boolean).join('; ') }
        : {})
    };
  }
  return merged;
};

const applyConfig = (applied) => {
  systemSettings.setTimezone(applied.timezone);
  systemSettings.setKeyboardLayout(applied.keyboardLayout);
  systemSettings.setTestFontInstalled(applied.testFontInstalled);
  systemSettings.setDockOrientation(applied.dockOrientation);
  systemSettings.setDockTileSize(applied.dockTileSize);
  systemSettings.setHideMenuBar(applied.hideMenuBar);
  systemSettings.setReducedMotion(applied.reducedMotion);
  systemSettings.setReducedTransparency(applied.reducedTransparency);
  systemSettings.setIncreaseContrast(applied.increaseContrast);
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
  try {
    const perSetting = [];
    for (const config of settingsFingerprintConfigs) {
      log('settings fingerprinting: applying', config);
      applyConfig(config);
      // Give the OS / browsers a moment to notice the new settings.
      await sleepMs(2000);
      await browserSession.browser.launch(true);
      const relaunchBetweenDomains =
        !!browserSession.browser._defaults?.relaunchBetweenFingerprintingDomains;
      try {
        const perDomain = [];
        for (let i = 0; i < settingsRoots.length; i++) {
          const root = settingsRoots[i];
          const url = `${root}/settingsFingerprinting.html`;
          log('settings fingerprint domain', {
            setting: settingLabel(config),
            url
          });
          perDomain.push(await runPageTest(browserSession, url));
          const lastDomain = i === settingsRoots.length - 1;
          // Same as device/screen FP: some browsers (LibreWolf) leave extra
          // windows after open -a that skew window-tied probes on later domains.
          if (!lastDomain && relaunchBetweenDomains) {
            await browserSession.browser.kill(true);
            await browserSession.browser.launch(false);
          }
        }
        perSetting.push({
          config,
          results: mergeDomainResults(perDomain)
        });
      } finally {
        await browserSession.browser.kill();
      }
    }
    return { settings_fingerprinting: mergeSettingsFingerprintResults(perSetting) };
  } finally {
    restoreOriginalSettings();
  }
};

module.exports = {
  runSettingsFingerprintTests,
  saveOriginalSettings,
  restoreOriginalSettings
};
