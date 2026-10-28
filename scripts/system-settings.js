// macOS system setting helpers for settings-fingerprinting A/B runs.
const { execSync } = require('child_process');

const run = (command) => execSync(command, { encoding: 'utf8' }).toString();

const getTimezone = () => {
  // "Time Zone: Europe/Paris" or similar.
  const out = run('sudo systemsetup -gettimezone');
  const match = out.match(/Time Zone:\s*(\S+)/i);
  if (!match) {
    throw new Error(`Could not parse timezone from: ${out.trim()}`);
  }
  return match[1];
};

const setTimezone = (timezone) => {
  // Network time can fight manual timezone changes on some images.
  try {
    run('sudo systemsetup -setusingnetworktime off');
  } catch (e) {
    // Non-fatal; settimezone may still work.
  }
  run(`sudo systemsetup -settimezone ${JSON.stringify(timezone)}`);
  const actual = getTimezone();
  if (actual !== timezone) {
    throw new Error(`Failed to set timezone to ${timezone} (now ${actual})`);
  }
  return actual;
};

// Parse `defaults read -g AppleLanguages` output: ( en, es ) / ( "en-US", "es" ).
const parseLanguagesOutput = (out) => {
  const inner = out.trim().replace(/^\(|\)$/g, '');
  if (!inner) {
    return [];
  }
  return inner.split(',')
    .map(s => s.trim().replace(/^"|"$/g, ''))
    .filter(Boolean);
};

const getLanguages = () => {
  try {
    return parseLanguagesOutput(run('defaults read -g AppleLanguages'));
  } catch (e) {
    return [];
  }
};

const setLanguages = (languages) => {
  if (!Array.isArray(languages) || languages.length === 0) {
    throw new Error('setLanguages requires a non-empty array');
  }
  const args = languages.map(l => JSON.stringify(l)).join(' ');
  run(`defaults write -g AppleLanguages -array ${args}`);
  const actual = getLanguages();
  // macOS may canonicalize tags (en → en-US); require each requested tag to
  // match an entry or be a prefix of one (en matches en-US).
  const ok = languages.every(wanted =>
    actual.some(got => got === wanted || got.startsWith(`${wanted}-`)));
  if (!ok) {
    throw new Error(
      `Failed to set AppleLanguages to ${JSON.stringify(languages)} (now ${JSON.stringify(actual)})`);
  }
  return actual;
};

const readBoolDefault = (domain, key) => {
  try {
    const out = run(`defaults read ${domain} ${key}`).trim();
    return out === '1' || out.toLowerCase() === 'true';
  } catch (e) {
    return false;
  }
};

const flushPrefs = () => {
  try {
    run('killall cfprefsd');
  } catch (e) {
    // Non-fatal; prefs usually still apply for newly launched apps.
  }
};

// Write a paired Accessibility + universalaccess bool and verify via Accessibility.
const setAccessibilityBool = ({
  name,
  accessibilityKey,
  universalAccessKey,
  enabled,
  readDomain = 'com.apple.Accessibility',
  readKey
}) => {
  const flag = enabled ? '1' : '0';
  const bool = enabled ? 'true' : 'false';
  run(`defaults write com.apple.Accessibility ${accessibilityKey} -int ${flag}`);
  run(`defaults write com.apple.universalaccess ${universalAccessKey} -bool ${bool}`);
  flushPrefs();
  const actual = readBoolDefault(readDomain, readKey || accessibilityKey);
  if (actual !== Boolean(enabled)) {
    throw new Error(`Failed to set ${name} to ${enabled} (now ${actual})`);
  }
  return actual;
};

// Accessibility → Reduce Motion. Browsers: prefers-reduced-motion.
const getReducedMotion = () =>
  readBoolDefault('com.apple.Accessibility', 'ReduceMotionEnabled');

const setReducedMotion = (enabled) => setAccessibilityBool({
  name: 'Reduce Motion',
  accessibilityKey: 'ReduceMotionEnabled',
  universalAccessKey: 'reduceMotion',
  enabled
});

// Accessibility → Reduce Transparency. Browsers: prefers-reduced-transparency.
const getReducedTransparency = () =>
  readBoolDefault('com.apple.Accessibility', 'EnhancedBackgroundContrastEnabled') ||
  readBoolDefault('com.apple.universalaccess', 'reduceTransparency');

const setReducedTransparency = (enabled) => setAccessibilityBool({
  name: 'Reduce Transparency',
  accessibilityKey: 'EnhancedBackgroundContrastEnabled',
  universalAccessKey: 'reduceTransparency',
  enabled,
  // Prefer universalaccess for verify; Accessibility key name is less obvious.
  readDomain: 'com.apple.universalaccess',
  readKey: 'reduceTransparency'
});

// Accessibility → Increase Contrast. Browsers: prefers-contrast: more.
const getIncreaseContrast = () =>
  readBoolDefault('com.apple.Accessibility', 'DarkenSystemColors') ||
  readBoolDefault('com.apple.universalaccess', 'increaseContrast');

const setIncreaseContrast = (enabled) => setAccessibilityBool({
  name: 'Increase Contrast',
  accessibilityKey: 'DarkenSystemColors',
  universalAccessKey: 'increaseContrast',
  enabled,
  readDomain: 'com.apple.universalaccess',
  readKey: 'increaseContrast'
});

module.exports = {
  getTimezone,
  setTimezone,
  getLanguages,
  setLanguages,
  getReducedMotion,
  setReducedMotion,
  getReducedTransparency,
  setReducedTransparency,
  getIncreaseContrast,
  setIncreaseContrast
};
