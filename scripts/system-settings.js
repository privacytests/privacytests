// macOS system setting helpers for settings-fingerprinting A/B runs.
const { execSync } = require('child_process');
const path = require('path');

const run = (command) => execSync(command, { encoding: 'utf8' }).toString();

const keyboardLayoutScript = path.join(__dirname, 'setkeyboardlayout.swift');
const screenSizeScript = path.join(__dirname, 'screen-size', 'main.swift');

const runKeyboardLayoutTool = (argument) =>
  run(`swift ${JSON.stringify(keyboardLayoutScript)} ${JSON.stringify(argument)}`).trim();

const runScreenSizeTool = (...arguments_) => {
  const args = arguments_.map(a => JSON.stringify(String(a))).join(' ');
  return run(`swift ${JSON.stringify(screenSizeScript)} ${args}`).trim();
};

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

// `defaults write` already notifies cfprefsd. Killing cfprefsd right after a
// write races and can drop the change (seen on GitHub Actions runners).
const sleepMs = (ms) => {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    // Busy-wait; avoids SharedArrayBuffer / child_process for a short pause.
  }
};

const readAccessibilityBool = (accessibilityKey, universalAccessKey) =>
  readBoolDefault('com.apple.universalaccess', universalAccessKey) ||
  readBoolDefault('com.apple.Accessibility', accessibilityKey);

// Write a paired Accessibility + universalaccess bool; verify via either domain.
const setAccessibilityBool = ({
  name,
  accessibilityKey,
  universalAccessKey,
  enabled
}) => {
  const flag = enabled ? '1' : '0';
  const bool = enabled ? 'true' : 'false';
  run(`defaults write com.apple.Accessibility ${accessibilityKey} -int ${flag}`);
  run(`defaults write com.apple.universalaccess ${universalAccessKey} -bool ${bool}`);
  let actual;
  for (let attempt = 0; attempt < 5; attempt++) {
    if (attempt > 0) {
      sleepMs(200);
    }
    actual = readAccessibilityBool(accessibilityKey, universalAccessKey);
    if (actual === Boolean(enabled)) {
      return actual;
    }
  }
  throw new Error(`Failed to set ${name} to ${enabled} (now ${actual})`);
};

// Accessibility → Reduce Motion. Browsers: prefers-reduced-motion.
const getReducedMotion = () =>
  readAccessibilityBool('ReduceMotionEnabled', 'reduceMotion');

const setReducedMotion = (enabled) => setAccessibilityBool({
  name: 'Reduce Motion',
  accessibilityKey: 'ReduceMotionEnabled',
  universalAccessKey: 'reduceMotion',
  enabled
});

// Accessibility → Reduce Transparency. Browsers: prefers-reduced-transparency.
const getReducedTransparency = () =>
  readAccessibilityBool('EnhancedBackgroundContrastEnabled', 'reduceTransparency');

const setReducedTransparency = (enabled) => setAccessibilityBool({
  name: 'Reduce Transparency',
  accessibilityKey: 'EnhancedBackgroundContrastEnabled',
  universalAccessKey: 'reduceTransparency',
  enabled
});

// Accessibility → Increase Contrast. Browsers: prefers-contrast: more.
const getIncreaseContrast = () =>
  readAccessibilityBool('DarkenSystemColors', 'increaseContrast');

const setIncreaseContrast = (enabled) => setAccessibilityBool({
  name: 'Increase Contrast',
  accessibilityKey: 'DarkenSystemColors',
  universalAccessKey: 'increaseContrast',
  enabled
});

// Keyboard input source via Text Input Sources (setkeyboardlayout.swift).
// Pass a short name (French) or full ID (com.apple.keylayout.French).
const getKeyboardLayout = () => runKeyboardLayoutTool('current');

const setKeyboardLayout = (layout) => {
  const actual = runKeyboardLayoutTool(layout);
  const wanted = layout.includes('.') ? layout : `com.apple.keylayout.${layout}`;
  if (actual !== wanted) {
    throw new Error(`Failed to set keyboard layout to ${wanted} (now ${actual})`);
  }
  return actual;
};

// Main display resolution via scripts/screen-size (CoreGraphics).
// Returns { width, height }.
const parseScreenSize = (text) => {
  const match = String(text).trim().match(/(\d+)\s*x\s*(\d+)/i);
  if (!match) {
    throw new Error(`Could not parse screen size from: ${text}`);
  }
  return { width: parseInt(match[1], 10), height: parseInt(match[2], 10) };
};

const getScreenSize = () => parseScreenSize(runScreenSizeTool('current'));

// Largest available mode with width < W and height < H.
const getNextSmallerScreenSize = ({ width, height }) =>
  parseScreenSize(runScreenSizeTool('next-smaller', width, height));

// Unique modes from `screen-size` with no args ("1920 x 1080 *").
const listScreenSizes = () => {
  const out = runScreenSizeTool();
  const sizes = [];
  const seen = new Set();
  for (const line of out.split('\n')) {
    const match = line.match(/(\d+)\s*x\s*(\d+)/i);
    if (!match) {
      continue;
    }
    const key = `${match[1]}x${match[2]}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    sizes.push({ width: parseInt(match[1], 10), height: parseInt(match[2], 10) });
  }
  return sizes;
};

const setScreenSize = ({ width, height }) => {
  const actual = parseScreenSize(runScreenSizeTool(width, height));
  if (actual.width !== width || actual.height !== height) {
    throw new Error(
      `Failed to set screen size to ${width}x${height} (now ${actual.width}x${actual.height})`);
  }
  return actual;
};

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
  setIncreaseContrast,
  getKeyboardLayout,
  setKeyboardLayout,
  getScreenSize,
  getNextSmallerScreenSize,
  listScreenSizes,
  setScreenSize
};
