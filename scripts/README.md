# PrivacyTests.org tests

This directory includes scripts to run browser privacy tests (fingerprinting resistance, partitioning between websites, etc.), save the results to a JSON file, and render those results in web pages.

## Set up

PrivacyTests can run tests on browser on Mac, iOS and Android. Depending on the platform, you will need to install a few things. (Linux and Windows are not currently supported.)

### On Mac

```
brew install mkcert
mkcert -install
```

You may need to set Settings > Privacy & Security > Full Disk Access > Terminal > (enabled)

### iOS

You will need to use a Mac to run iOS tests. On the command line, enter:

```
brew install ideviceinstaller
```

### Android

```
brew cask install android-platform-tools
```

#### Vanadium

Vanadium is the GrapheneOS browser. It does not need a phone: the `Vanadium emulator` workflow runs it in an Android emulator on GitHub-hosted runners, as part of the `Mobile tests` workflow.

The workflow downloads the latest stable x86_64 APKs from the GrapheneOS app repository, checks their SHA-256 hashes, installs them, and runs `node test --android --browser=vanadium`. To start it by hand, open Actions > Vanadium emulator > Run workflow.

The workflow installs two apps: the browser, and the Vanadium config app. Vanadium reads its content filters and feature flags from the config app, so results without it do not match real Vanadium.

The emulator runs stock Android 14, not GrapheneOS. Results show Vanadium without the GrapheneOS hardening and may differ from a real phone. The results page marks Vanadium as `emulator`, and clicking the label shows the Android and config app versions. Pass `--environment` and `--environment-details` to `node test` to label any other run this way.

To test on a real phone instead, install GrapheneOS, which includes Vanadium, and turn on USB debugging. Then run `node test --android --browser=vanadium` with Appium running.

### Finally

On all platforms:

`npm install`

You're ready to go!

## Usage

Run tests with command-line flags. `--browser` is required:

`node test --browser=firefox --out=../firefox.json`

Options:

* `--browser=firefox`: the browser to test (chrome, firefox, brave, opera, edge, vivaldi, etc.)
* `--android`: run on Android
* `--ios`: run on iOS
* `--incognito`: run tests in private browsing windows
* `--tor`: run in Tor windows (Brave)
* `--nightly`: use nightly browser builds where applicable
* `--aggregate`: combine results in the rendered output (enabled by default)
* `--environment=emulator`: a short label shown under the browser name on the results page
* `--environment-details="..."`: the full text shown when the label is clicked
* `--debug`: don't close the browser after the test is done
* `--app-dir=/path/to/apps`: directory containing browsers (default: `/Applications/`)
* `--filename=my-results`: filename prefix for results files
* `--out=./results.json`: full path for the results JSON file
* `--categories=misc,https`: limit test categories (`main`, `misc`, `https`, `session`, `trackingCookies`, `dns`, `deviceFingerprint`, `settingsFingerprint`)
* `--skip=dns`: skip test categories
* `--hurry`: skip the 60s feature-flag warmup on desktop
* `--kill`: quit all desktop browsers
* `--versions`: print installed browser versions

For example:

`node test --browser=firefox --filename=temp`

writes results to `temp*`

## Publishing the website

The live site is the sibling repo [privacytests-website](https://github.com/privacytests/privacytests-website). Clone it next to `privacytests.org` (or set `WEBSITE_DIR`). Then:

1. `node prepare <YYYYMMDD>` — copies rendered results into the website repo and `git add`s them
2. Commit and push in `privacytests-website` (and any related copy changes here, e.g. `assets/copy/news.md`)
3. `node bump` — bumps the local issue number

Running tests does not require the website checkout.

## Development

To hack on the code, and get fast feedback, use:

`npm run develop`

When you run browser tests, when they complete the /results.html page will be updated. If you save a change to render.js, the page will also be updated.

