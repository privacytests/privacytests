/* global postDataAndCarryOn */

// Probes for OS display-mode A/B. Dock/misc stay fixed; only screen size changes.
const screenFingerprintTests = [
  {
    name: 'Screen width',
    description: 'Screen width leaked by the browser through the screen API. Under screen A→B the display mode changes.',
    probe: () => String(window.screen.width)
  },
  {
    name: 'Screen height',
    description: 'Screen height leaked by the browser through the screen API. Under screen A→B the display mode changes.',
    probe: () => String(window.screen.height)
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
  for (const test of screenFingerprintTests) {
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
  await postDataAndCarryOn(results, 'screen_fingerprinting');
};

runTests();
