// Screen fingerprinting: change display mode A → B, probe in a fresh browser
// on three first-party domains each time, then score stability vs farbling.
const os = require('os');
const systemSettings = require('./system-settings');
const { sleepMs } = require('./utils');

const screenRoots = [
  'https://test-pages.privacytests2.org',
  'https://test-pages.privacytests.org',
  'https://test-pages.privacytests3.org'
];

const screenSizeA = { width: 1024, height: 768 };

const log = (...args) => {
  console.log(new Date().toISOString(), ...args);
};

const screenSizeKey = ({ width, height }) => `${width}x${height}`;

let originalScreenSize = null;

const saveOriginalScreenSize = () => {
  if (os.platform() !== 'darwin') {
    return;
  }
  originalScreenSize = systemSettings.getScreenSize();
  log('screen fingerprinting: saved', originalScreenSize);
};

const restoreOriginalScreenSize = () => {
  if (!originalScreenSize) {
    return;
  }
  try {
    log('screen fingerprinting: restoring', originalScreenSize);
    systemSettings.setScreenSize(originalScreenSize);
  } catch (e) {
    log('screen fingerprinting: failed to restore screen size', e);
  }
};

// Resolve B from available modes; return null if A/B can't both run.
const prepareScreenSizes = () => {
  const available = systemSettings.listScreenSizes();
  const availableKeys = new Set(available.map(screenSizeKey));
  log('screen fingerprinting: available display sizes', [...availableKeys]);
  if (available.length < 2 || !availableKeys.has(screenSizeKey(screenSizeA))) {
    return null;
  }
  let screenSizeB;
  try {
    screenSizeB = systemSettings.getNextSmallerScreenSize(screenSizeA);
  } catch (e) {
    log('screen fingerprinting: no next-smaller mode than', screenSizeKey(screenSizeA), e.message || e);
    return null;
  }
  log('screen fingerprinting: screen A/B', screenSizeKey(screenSizeA), '→', screenSizeKey(screenSizeB));
  return [
    { id: 'A', screenSize: screenSizeA },
    { id: 'B', screenSize: screenSizeB }
  ];
};

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

// Join screen A/B for tooltips ("|" between sizes; farbling as [v1,v2,v3]).
const joinScreenVariants = (variants) =>
  variants.map(v => (Array.isArray(v) ? `[${v.join(',')}]` : String(v))).join('|');

// Pass if every settings-run farbled across first parties, or if the (stable)
// value is identical across screen A/B.
const mergeScreenFingerprintResults = (perSetting) => {
  const names = new Set(perSetting.flatMap(({ results }) => Object.keys(results)));
  const merged = {};
  for (const name of names) {
    const items = perSetting
      .map(({ config, results }) => ({ config, result: results[name] }))
      .filter(({ result }) => result);
    if (items.length < 2) {
      continue;
    }
    const values = items.map(({ result }) => result.value);
    const randomized = items.map(({ result }) => Boolean(result.randomized));
    const allFarbled = randomized.every(Boolean);
    const stableAcrossSettings = values.every(
      v => JSON.stringify(v) === JSON.stringify(values[0]));
    const settings = items.map(({ config }) =>
      `${config.screenSize.width}x${config.screenSize.height}`);
    merged[name] = {
      description: items[0].result.description,
      value: joinScreenVariants(values),
      settings: joinScreenVariants(settings),
      randomized: joinScreenVariants(randomized),
      passed: allFarbled || stableAcrossSettings,
      ...(items.some(({ result }) => result.error)
        ? { error: items.map(({ result }) => result.error).filter(Boolean).join('; ') }
        : {})
    };
  }
  return merged;
};

// Apply each display size, launch a fresh browser, run the three-domain
// screen fingerprint page, then restore prior display size.
// `runPageTest` is injected from test.js.
const runScreenFingerprintTests = async (browserSession, { runPageTest }) => {
  if (os.platform() !== 'darwin') {
    log('screen fingerprinting: skipping (macOS only)');
    return {};
  }
  if (!originalScreenSize) {
    saveOriginalScreenSize();
  }
  const configs = prepareScreenSizes();
  if (!configs) {
    log('screen fingerprinting: skipping (need 1024x768 plus a smaller mode)');
    return {};
  }
  try {
    const perSetting = [];
    for (const config of configs) {
      log('screen fingerprinting: applying', config);
      systemSettings.setScreenSize(config.screenSize);
      await sleepMs(2000);
      await browserSession.browser.launch(true);
      try {
        const perDomain = [];
        for (const root of screenRoots) {
          const url = `${root}/screenFingerprinting.html`;
          log('screen fingerprint domain', {
            screen: screenSizeKey(config.screenSize),
            url
          });
          perDomain.push(await runPageTest(browserSession, url));
        }
        perSetting.push({
          config,
          results: mergeDomainResults(perDomain)
        });
      } finally {
        await browserSession.browser.kill();
      }
    }
    return { screen_fingerprinting: mergeScreenFingerprintResults(perSetting) };
  } finally {
    restoreOriginalScreenSize();
  }
};

module.exports = {
  runScreenFingerprintTests,
  saveOriginalScreenSize,
  restoreOriginalScreenSize
};
