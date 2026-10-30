// Downloads the latest stable x86_64 Vanadium APK, for running in an emulator.
//
// Usage (from scripts/):
//   node fetch-vanadium-apk --out=/tmp/vanadium.apk

const crypto = require('crypto');
const fs = require('fs');
const minimist = require('minimist');

const REPO_URL = 'https://apps.grapheneos.org';
const PACKAGE_NAME = 'app.vanadium.browser';
const ABI = 'x86_64';
const METADATA_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

// The first line of the .sjson file is JSON. The rest is its signature.
const parseMetadata = (signedMetadata) => JSON.parse(signedMetadata.split('\n')[0]);

const latestStableVariant = (metadata) => {
  const variants = Object.values(metadata.packages[PACKAGE_NAME].variants)
    .filter((variant) => variant.channel === 'stable' && variant.abis.includes(ABI))
    .sort((a, b) => b.versionCode - a.versionCode);
  if (variants.length === 0) {
    throw new Error(`No stable ${ABI} variant of ${PACKAGE_NAME}`);
  }
  return variants[0];
};

const fetchOk = async (url, timeoutMs) => {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) {
    throw new Error(`Fetching ${url} failed (${response.status})`);
  }
  return response;
};

const fetchLatestVariant = async () => {
  const response = await fetchOk(`${REPO_URL}/metadata.1.0.sjson`, METADATA_TIMEOUT_MS);
  return latestStableVariant(parseMetadata(await response.text()));
};

const downloadVerifiedApk = async (variant, outPath) => {
  const url = `${REPO_URL}/packages/${PACKAGE_NAME}/${variant.versionCode}/base.apk`;
  const response = await fetchOk(url, DOWNLOAD_TIMEOUT_MS);
  const apk = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(apk).digest('hex');
  if (hash !== variant.apkHashes[0]) {
    throw new Error(`SHA-256 mismatch for ${url}: ${hash}`);
  }
  fs.writeFileSync(outPath, apk);
};

async function main () {
  const { out } = minimist(process.argv.slice(2));
  if (!out) {
    throw new Error('--out is required');
  }
  const variant = await fetchLatestVariant();
  await downloadVerifiedApk(variant, out);
  console.log(`Downloaded Vanadium ${variant.versionName} to ${out}`);
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
