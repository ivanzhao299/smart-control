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
    releaseControl: false,
    highRisk: false,
    files,
  };

  const highRisk = /(^|\/)(package\.json|pnpm-lock\.yaml|\.env(?:\.|$)|ecosystem\.config)|(^|\/)migrations?\/|^deploy\/|^scripts\/(deploy|backup|update|boot|ensure|run-migrations|assert-release)/;
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
    } else if (file === '.gitignore' || /^\.github\//.test(file) || /^tools\/ci\//.test(file)) {
      // Release-control files can widen CI validation, but they do not run on
      // GK9000. Keeping this separate from runtime risk prevents an earlier
      // workflow-only merge from turning the next frontend release into a full
      // production rebuild and service restart.
      result.releaseControl = true;
      result.docsOnly = false;
    } else if (/^(android-app|ios-app)\//.test(file)) {
      // Native applications have independent build and distribution pipelines.
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
  const noRuntime = !result.frontendPublic && !result.frontendCode && !result.backendCode && !result.highRisk;
  const scope = noRuntime ? 'none' : staticOnly ? 'static' : frontendOnly ? 'frontend' : backendOnly ? 'backend' : 'full';
  return {
    ...result,
    scope,
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
      `files=${result.files.join(',')}`,
      '',
    ].join('\n'));
  }
  process.stdout.write(`${JSON.stringify(result)}\n`);
}
