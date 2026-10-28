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

const settingsFingerprintConfigs = [
  { id: 'A', timezone: 'Europe/Paris' },
  { id: 'B', timezone: 'Europe/Berlin' }
];

const log = (...args) => {
  console.log(new Date().toISOString(), ...args);
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
      .map(({ setting, results }) => ({ setting, result: results[name] }))
      .filter(({ result }) => result);
    if (items.length === 0) {
      continue;
    }
    const values = items.map(({ result }) => result.value);
    const randomized = items.map(({ result }) => Boolean(result.randomized));
    const allFarbled = randomized.every(Boolean);
    const stableAcrossSettings = values.every(
      v => JSON.stringify(v) === JSON.stringify(values[0]));
    merged[name] = {
      description: items[0].result.description,
      value: values,
      settings: items.map(({ setting }) => setting),
      randomized,
      passed: allFarbled || stableAcrossSettings,
      ...(items.some(({ result }) => result.error)
        ? { error: items.map(({ result }) => result.error).filter(Boolean).join('; ') }
        : {})
    };
  }
  return merged;
};

// Apply each OS settings config, launch a fresh browser, run the three-domain
// settings fingerprint page, then restore the prior timezone.
// `runPageTest` is injected from test.js (websocket/session helper).
const runSettingsFingerprintTests = async (browserSession, { runPageTest }) => {
  if (os.platform() !== 'darwin') {
    log('settings fingerprinting: skipping (macOS only)');
    return {};
  }
  const originalTimezone = systemSettings.getTimezone();
  log('settings fingerprinting: saved timezone', { originalTimezone });
  try {
    const perSetting = [];
    for (const config of settingsFingerprintConfigs) {
      log('settings fingerprinting: applying', config);
      systemSettings.setTimezone(config.timezone);
      // Give the OS / browsers a moment to notice the new zone.
      await sleepMs(2000);
      await browserSession.browser.launch(true);
      try {
        const perDomain = [];
        for (const root of settingsRoots) {
          const url = `${root}/settingsFingerprinting.html`;
          log('settings fingerprint domain', { setting: config.timezone, url });
          perDomain.push(await runPageTest(browserSession, url));
        }
        perSetting.push({
          setting: config.timezone,
          results: mergeDomainResults(perDomain)
        });
      } finally {
        await browserSession.browser.kill();
      }
    }
    return { settings_fingerprinting: mergeSettingsFingerprintResults(perSetting) };
  } finally {
    try {
      log('settings fingerprinting: restoring timezone', { originalTimezone });
      systemSettings.setTimezone(originalTimezone);
    } catch (e) {
      log('settings fingerprinting: failed to restore timezone', e);
    }
  }
};

module.exports = { runSettingsFingerprintTests };
