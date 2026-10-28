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

module.exports = {
  getTimezone,
  setTimezone
};
