// Downloads the latest stable x86_64 Vanadium APKs, for running in an emulator.
// Vanadium reads its content filters and feature flags from the config app,
// so the browser alone gives results that don't match real Vanadium.
//
// Usage (from scripts/):
//   node fetch-vanadium-apk --out-dir=/tmp/vanadium

const crypto = require('crypto');
const fs = require('fs');
const minimist = require('minimist');
const path = require('path');

const REPO_URL = 'https://apps.grapheneos.org';
const PACKAGE_NAMES = ['app.vanadium.browser', 'app.vanadium.config'];
const ABI = 'x86_64';
const METADATA_TIMEOUT_MS = 30 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

// The first line of the .sjson file is JSON. The rest is its signature.
const parseMetadata = (signedMetadata) => JSON.parse(signedMetadata.split('\n')[0]);

// The config app has no native code, so it lists no ABIs.
const supportsAbi = (variant) => variant.abis === undefined || variant.abis.includes(ABI);

const latestStableVariant = (metadata, packageName) => {
  const variants = Object.values(metadata.packages[packageName].variants)
    .filter((variant) => variant.channel === 'stable' && supportsAbi(variant))
    .sort((a, b) => b.versionCode - a.versionCode);
  if (variants.length === 0) {
    throw new Error(`No stable ${ABI} variant of ${packageName}`);
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

const fetchMetadata = async () => {
  const response = await fetchOk(`${REPO_URL}/metadata.1.0.sjson`, METADATA_TIMEOUT_MS);
  return parseMetadata(await response.text());
};

const downloadVerifiedApk = async (packageName, variant, outPath) => {
  const url = `${REPO_URL}/packages/${packageName}/${variant.versionCode}/base.apk`;
  const response = await fetchOk(url, DOWNLOAD_TIMEOUT_MS);
  const apk = Buffer.from(await response.arrayBuffer());
  const hash = crypto.createHash('sha256').update(apk).digest('hex');
  if (hash !== variant.apkHashes[0]) {
    throw new Error(`SHA-256 mismatch for ${url}: ${hash}`);
  }
  fs.writeFileSync(outPath, apk);
};

async function main () {
  const { 'out-dir': outDir } = minimist(process.argv.slice(2));
  if (!outDir) {
    throw new Error('--out-dir is required');
  }
  fs.mkdirSync(outDir, { recursive: true });
  const metadata = await fetchMetadata();
  await Promise.all(PACKAGE_NAMES.map(async (packageName) => {
    const variant = latestStableVariant(metadata, packageName);
    await downloadVerifiedApk(packageName, variant, path.join(outDir, `${packageName}.apk`));
    console.log(`Downloaded ${packageName} ${variant.versionName}`);
  }));
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
  });
}
