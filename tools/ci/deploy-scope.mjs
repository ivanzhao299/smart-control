#!/usr/bin/env node

import { appendFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export function classifyDeployFiles(files) {
  const result = {
    docsOnly: true,
    frontendPublic: false,
    frontendCode: false,
    backendCode: false,
    highRisk: false,
    files,
  };

  const highRisk = /(^|\/)(package\.json|pnpm-lock\.yaml|\.env(?:\.|$)|ecosystem\.config)|(^|\/)migrations?\/|^deploy\/|^scripts\/(deploy|backup|update|boot|ensure|run-migrations|assert-release)|^\.github\/workflows\/deploy-/;
  for (const file of files) {
    if (highRisk.test(file)) {
      result.highRisk = true;
      result.docsOnly = false;
    } else if (/^frontend\/public\//.test(file)) {
      result.frontendPublic = true;
      result.docsOnly = false;
    } else if (/^frontend\/tests\//.test(file) || /^backend\/test\//.test(file) || /^backend\/src\/.+\.spec\.ts$/.test(file)) {
      // Tests do not change production runtime.
    } else if (/^frontend\/(src\/|index\.html$|vite\.config|tsconfig)/.test(file)) {
      result.frontendCode = true;
      result.docsOnly = false;
    } else if (/^backend\/src\//.test(file)) {
      result.backendCode = true;
      result.docsOnly = false;
    } else if (/^docs\//.test(file) || /(^|\/)(README|CHANGELOG|HANDOVER|MEMORY)\.md$/.test(file)) {
      // Documentation does not change production runtime.
    } else {
      // Unknown paths fail closed into a full release.
      result.highRisk = true;
      result.docsOnly = false;
    }
  }

  const staticOnly = result.frontendPublic && !result.frontendCode && !result.backendCode && !result.highRisk;
  const frontendOnly = result.frontendCode && !result.backendCode && !result.highRisk;
  const backendOnly = result.backendCode && !result.frontendCode && !result.highRisk;
  const scope = staticOnly ? 'static' : frontendOnly ? 'frontend' : backendOnly ? 'backend' : 'full';
  return {
    ...result,
    scope,
    validateStatic: staticOnly,
    validateFrontend: result.frontendCode || result.highRisk,
    validateBackend: result.backendCode || result.highRisk,
  };
}

function changedFiles(base, head) {
  return execFileSync('git', ['diff', '--name-only', base, head], { encoding: 'utf8' })
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function arg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const head = arg('--head') || 'HEAD';
  let base = arg('--base');
  if (!base || /^0+$/.test(base)) {
    base = execFileSync('git', ['rev-parse', `${head}^`], { encoding: 'utf8' }).trim();
  }
  const result = classifyDeployFiles(changedFiles(base, head));
  const output = arg('--github-output');
  if (output) {
    appendFileSync(output, [
      `scope=${result.scope}`,
      `validate_static=${result.validateStatic}`,
      `validate_frontend=${result.validateFrontend}`,
      `validate_backend=${result.validateBackend}`,
      `files=${result.files.join(',')}`,
      '',
    ].join('\n'));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
