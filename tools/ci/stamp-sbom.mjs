import { readFileSync, writeFileSync } from 'node:fs';

const [file, component, sourceSha, repository] = process.argv.slice(2);
if (!file || !component || !/^[a-f0-9]{40}$/i.test(sourceSha ?? '') || !repository) {
  throw new Error('Usage: node stamp-sbom.mjs <spdx-json> <component> <40-char-source-sha> <owner/repository>');
}

const document = JSON.parse(readFileSync(file, 'utf8'));
document.name = `${repository.replace('/', '-')}-${component}-${sourceSha}`;
document.documentNamespace = `https://github.com/${repository}/sbom/${component}/${sourceSha}`;
document.documentComment = `Source: https://github.com/${repository}/commit/${sourceSha}`;
writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
