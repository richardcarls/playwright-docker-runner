import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import {
  cacheKey,
  CONTAINER_SCRIPT,
  dockerPlan,
  forwardedEnv,
  packageManager,
  playwrightVersion,
  workspaceDirectories,
} from '../src/index.mjs';

function fixture({ manager = 'npm', linker = 'node-modules', workspaces = [] } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'pw-docker-test-'));
  const lockfile = { npm: 'package-lock.json', pnpm: 'pnpm-lock.yaml', yarn: 'yarn.lock' }[manager];

  writeFileSync(path.join(root, 'package.json'), JSON.stringify({ packageManager: `${manager}@1.0.0`, devDependencies: { playwright: '1.58.2' }, workspaces }));
  writeFileSync(path.join(root, lockfile), 'lock');
  mkdirSync(path.join(root, 'node_modules', 'playwright'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules', 'playwright', 'package.json'), '{"version":"1.58.2"}');

  if (manager === 'yarn') {
    writeFileSync(path.join(root, '.yarnrc.yml'), `nodeLinker: ${linker}\n`);
  }

  return root;
}

function plan(root, overrides = {}) {
  return dockerPlan({
    root,
    manager: packageManager(root),
    version: playwrightVersion(root),
    command: 'run',
    args: ['test:browser', '--run'],
    platform: 'linux',
    uid: 1000,
    gid: 1000,
    home: '/home/test',
    env: { CI: 'true', SECRET: 'not-forwarded' },
    ...overrides,
  });
}

test('selects the declared package manager and installed direct Playwright version', () => {
  for (const manager of ['npm', 'pnpm', 'yarn']) {
    const root = fixture({ manager });

    assert.equal(packageManager(root).name, manager);
    assert.equal(playwrightVersion(root), '1.58.2');
  }
});

test('rejects conflicting package manager and lockfile', () => {
  const root = fixture();

  writeFileSync(path.join(root, 'yarn.lock'), 'lock');
  assert.throws(() => packageManager(root), /one lockfile/);
});

test('isolates dependencies, caps memory, and forwards only selected environment', () => {
  const root = fixture({ manager: 'yarn', workspaces: ['packages/*'] });
  const child = path.join(root, 'packages', 'example');

  mkdirSync(child, { recursive: true });
  writeFileSync(path.join(child, 'package.json'), '{}');

  const result = plan(root, { config: { passEnv: ['SECRET'], fontDirs: [] } });
  const args = result.args;

  assert.deepEqual(workspaceDirectories(root, 'yarn'), ['.', 'packages/example']);
  assert.ok(args.includes(`${root}:/work`));
  assert.ok(args.some((arg) => arg.endsWith(':/work/packages/example/node_modules')));
  assert.equal(args[args.indexOf('--memory') + 1], '4g');
  assert.equal(args[args.indexOf('--memory-swap') + 1], '4g');
  assert.equal(result.containerEnv.SECRET, 'not-forwarded');
  assert.equal(result.containerEnv.CI, 'true');
  assert.deepEqual(args.slice(-4), ['pw-docker', 'yarn', 'isolated', 'run', 'test:browser', '--run'].slice(-4));
});

test('does not forward arbitrary variables', () => {
  assert.deepEqual(forwardedEnv({ CI: 'true', TOKEN: 'secret' }), { CI: 'true' });
});

test('rejects PnP in isolated mode and other operating systems in host mode', () => {
  const root = fixture({ manager: 'yarn', linker: 'pnp' });

  assert.throws(() => plan(root), /host-pnp/);
  assert.throws(() => plan(root, { config: { installMode: 'host-pnp' }, platform: 'darwin' }), /Linux/);
});

test('macOS and Windows plans keep dependencies in volumes and avoid Linux user IDs', () => {
  const root = fixture({ manager: 'npm' });

  for (const platform of ['darwin', 'win32']) {
    const result = plan(root, { platform, home: '/host/home' });

    assert.ok(result.args.includes(`${root}:/work`));
    assert.ok(result.args.some((arg) => arg.endsWith(':/work/node_modules')));
    assert.equal(result.args.includes('--user'), false);
    assert.equal(result.containerEnv.HOME, '/root');
    assert.equal(result.containerEnv.PW_DOCKER_VERSION, '1.58.2');
  }
});

test('rejects a nested test launcher that resolves a different Playwright', () => {
  const root = fixture();
  const manifest = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));

  manifest.devDependencies['@web/test-runner-playwright'] = '0.11.1';
  writeFileSync(path.join(root, 'package.json'), JSON.stringify(manifest));
  mkdirSync(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'node_modules', 'playwright'), { recursive: true });
  writeFileSync(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'package.json'), '{"version":"0.11.1"}');
  writeFileSync(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'index.js'), '');
  writeFileSync(path.join(root, 'node_modules', '@web', 'test-runner-playwright', 'node_modules', 'playwright', 'package.json'), '{"version":"1.57.0"}');

  assert.throws(() => playwrightVersion(root), /resolves Playwright 1\.57\.0/);
});

test('host PnP mounts the checkout at its own path and extra siblings', () => {
  const root = fixture({ manager: 'yarn', linker: 'pnp' });
  const sibling = path.join(root, 'sibling');

  mkdirSync(sibling);
  writeFileSync(path.join(root, '.pnp.cjs'), '');

  const result = plan(root, { config: { installMode: 'host-pnp', mounts: [{ source: 'sibling', target: '/sibling' }] } });

  assert.ok(result.args.includes(`${root}:${root}`));
  assert.ok(result.args.includes(`${sibling}:/sibling`));
  assert.deepEqual(result.volumes, []);
});

test('install cache changes with the lockfile', () => {
  const root = fixture();
  const manager = packageManager(root);
  const before = cacheKey(root, manager, 'image', ['.']);

  writeFileSync(path.join(root, manager.lockfile), 'changed');
  assert.notEqual(cacheKey(root, manager, 'image', ['.']), before);
  assert.equal(readFileSync(path.join(root, manager.lockfile), 'utf8'), 'changed');
});

test('container validates the installed Playwright version and runs exact arguments', () => {
  assert.match(CONTAINER_SCRIPT, /Playwright version mismatch/);
  assert.match(CONTAINER_SCRIPT, /exec "\$manager" run "\$@"/);
  assert.match(CONTAINER_SCRIPT, /exec "\$@"/);
});
