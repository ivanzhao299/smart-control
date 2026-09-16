import { readFileSync } from 'node:fs';

const [file, minimumRaw, ...requiredPackages] = process.argv.slice(2);
const minimum = Number.parseInt(minimumRaw ?? '', 10);

if (!file || !Number.isSafeInteger(minimum) || minimum < 1 || requiredPackages.length === 0) {
  throw new Error('Usage: node validate-sbom.mjs <spdx-json> <minimum-packages> <required-package...>');
}

const document = JSON.parse(readFileSync(file, 'utf8'));
if (typeof document.spdxVersion !== 'string' || !document.spdxVersion.startsWith('SPDX-')) {
  throw new Error(`${file}: missing SPDX version`);
}
if (!Array.isArray(document.packages) || document.packages.length < minimum) {
  throw new Error(`${file}: expected at least ${minimum} packages, found ${document.packages?.length ?? 0}`);
}

const names = new Set(document.packages.map((entry) => entry?.name).filter(Boolean));
const missing = requiredPackages.filter((name) => !names.has(name));
if (missing.length > 0) {
  throw new Error(`${file}: missing required production packages: ${missing.join(', ')}`);
}

const versioned = document.packages.filter((entry) => typeof entry?.versionInfo === 'string' && entry.versionInfo.length > 0).length;
if (versioned < minimum) {
  throw new Error(`${file}: only ${versioned} packages have a version`);
}

const expectedSourceSha = process.env.EXPECTED_SOURCE_SHA;
if (expectedSourceSha) {
  if (!/^[a-f0-9]{40}$/i.test(expectedSourceSha)) {
    throw new Error('EXPECTED_SOURCE_SHA must contain a full 40-character commit');
  }
  if (!document.documentNamespace?.endsWith(`/${expectedSourceSha}`)) {
    throw new Error(`${file}: document namespace is not bound to ${expectedSourceSha}`);
  }
  if (!document.documentComment?.includes(`/commit/${expectedSourceSha}`)) {
    throw new Error(`${file}: document comment is not bound to ${expectedSourceSha}`);
  }
}

console.log(`${file}: ${document.spdxVersion}, ${document.packages.length} packages (${versioned} versioned)`);
