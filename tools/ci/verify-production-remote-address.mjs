import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', '..');
const expectedRemoteUrl = 'https://erp.cnjinhu.top:8443/control/';
const retiredPwaHost = 'park.cnjinhu.com';

const iosPrefs = await readFile(resolve(root, 'ios-app/SmartControl/Prefs.swift'), 'utf8');
const androidBuild = await readFile(resolve(root, 'android-app/app/build.gradle.kts'), 'utf8');
const androidPrefs = await readFile(
  resolve(root, 'android-app/app/src/main/kotlin/com/jinhu/smartcontrol/Prefs.kt'),
  'utf8',
);

function fail(message) {
  console.error(`PRODUCTION_REMOTE_ADDRESS_INVALID: ${message}`);
  process.exitCode = 1;
}

const iosDefault = iosPrefs.match(/static let defaultRemoteUrl\s*=\s*"([^"]+)"/)?.[1];
if (iosDefault !== expectedRemoteUrl) {
  fail(`iOS defaultRemoteUrl must be ${expectedRemoteUrl}; received ${iosDefault ?? 'missing'}`);
}

const androidDefault = androidBuild.match(
  /buildConfigField\("String",\s*"DEFAULT_REMOTE_URL",\s*"\\"([^"\\]+)\\""\)/,
)?.[1];
if (androidDefault !== expectedRemoteUrl) {
  fail(`Android DEFAULT_REMOTE_URL must be ${expectedRemoteUrl}; received ${androidDefault ?? 'missing'}`);
}

if (!iosPrefs.includes(retiredPwaHost) || !iosPrefs.includes('set(defaultRemoteUrl, forKey: keyRemoteUrl)')) {
  fail(`iOS must migrate saved ${retiredPwaHost} remote addresses to the production default`);
}

if (
  !androidPrefs.includes(retiredPwaHost) ||
  !androidPrefs.includes('setRemoteUrl(ctx, BuildConfig.DEFAULT_REMOTE_URL)')
) {
  fail(`Android must migrate saved ${retiredPwaHost} remote addresses to the production default`);
}

if (!process.exitCode) {
  console.log(`PRODUCTION_REMOTE_ADDRESS_OK ${expectedRemoteUrl}`);
}
