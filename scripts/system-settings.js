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

// Accessibility → Reduce Motion. Browsers expose this as prefers-reduced-motion.
const getReducedMotion = () => {
  try {
    const out = run('defaults read com.apple.Accessibility ReduceMotionEnabled').trim();
    return out === '1' || out.toLowerCase() === 'true';
  } catch (e) {
    return false;
  }
};

const setReducedMotion = (enabled) => {
  const flag = enabled ? '1' : '0';
  const bool = enabled ? 'true' : 'false';
  // Both domains are consulted depending on macOS / app; set both.
  run(`defaults write com.apple.Accessibility ReduceMotionEnabled -int ${flag}`);
  run(`defaults write com.apple.universalaccess reduceMotion -bool ${bool}`);
  try {
    run('killall cfprefsd');
  } catch (e) {
    // Non-fatal; prefs usually still apply for newly launched apps.
  }
  const actual = getReducedMotion();
  if (actual !== Boolean(enabled)) {
    throw new Error(`Failed to set Reduce Motion to ${enabled} (now ${actual})`);
  }
  return actual;
};

module.exports = {
  getTimezone,
  setTimezone,
  getLanguages,
  setLanguages,
  getReducedMotion,
  setReducedMotion
};
