/* eslint-disable */
'use strict';

/**
 * postinstall: vendor the XCUITest driver into a project-local APPIUM_HOME so the
 * bundled Appium server (spawned by AppiumRunner) is fully self-contained and end
 * users don't have to install Appium or its drivers globally.
 *
 * Idempotent and best-effort: it never fails `npm install`. If Appium isn't present
 * (e.g. on a non-iOS host that skipped optional deps) or the install can't run, it
 * just logs and exits 0 — AppiumRunner then falls back to a global `appium` on PATH.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.resolve(__dirname, '..');

// Single source of truth for the pinned XCUITest driver version: package.json
// ("config".xcuitestDriverVersion). Falls back to a sane default if absent.
let XCUITEST_VERSION = '10.14.6';
try {
    const pkg = require(path.join(projectRoot, 'package.json'));
    if (pkg.config && pkg.config.xcuitestDriverVersion) {
        XCUITEST_VERSION = pkg.config.xcuitestDriverVersion;
    }
} catch (e) {
    /* use default */
}

const appiumHome = process.env.APPIUM_HOME || path.join(projectRoot, '.appium-home');
const appiumBin = path.join(projectRoot, 'node_modules', '.bin', 'appium');

function log(msg) {
    console.log(`[setup-appium] ${msg}`);
}

if (!fs.existsSync(appiumBin)) {
    log(`appium binary not found at ${appiumBin}; skipping (AppiumRunner will use a global appium).`);
    process.exit(0);
}

const env = Object.assign({}, process.env, { APPIUM_HOME: appiumHome });

// What's installed now? Compare against the pinned version so that bumping
// config.xcuitestDriverVersion in package.json actually takes effect on the next
// `npm install` (not just a present/absent check).
let installedVersion = null;
try {
    const listed = spawnSync(appiumBin, ['driver', 'list', '--installed', '--json'], {
        env,
        encoding: 'utf8',
    });
    if (listed.stdout) {
        const parsed = JSON.parse(listed.stdout);
        if (parsed && parsed.xcuitest && parsed.xcuitest.version) {
            installedVersion = parsed.xcuitest.version;
        }
    }
} catch (e) {
    /* treat as not installed */
}

if (installedVersion === XCUITEST_VERSION) {
    log(`xcuitest@${XCUITEST_VERSION} already present in ${appiumHome}; nothing to do.`);
    process.exit(0);
}

if (installedVersion) {
    log(`found xcuitest@${installedVersion}, pinned is ${XCUITEST_VERSION}; reinstalling ...`);
    spawnSync(appiumBin, ['driver', 'uninstall', 'xcuitest'], { env, stdio: 'inherit' });
}

log(`installing xcuitest@${XCUITEST_VERSION} into ${appiumHome} ...`);
// `xcuitest` is one of Appium's known drivers, so install it by its short name (which
// maps to the `appium-xcuitest-driver` npm package). Do NOT pass `--source npm` here:
// that would make Appium look up a literal npm package named "xcuitest" (404).
const result = spawnSync(appiumBin, ['driver', 'install', `xcuitest@${XCUITEST_VERSION}`], {
    env,
    stdio: 'inherit',
});

if (result.status !== 0) {
    log('driver install did not complete cleanly; AppiumRunner will fall back to a global appium if available.');
}
// Never fail the install.
process.exit(0);
