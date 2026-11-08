import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const fixtures = [
  ['react-playwright', 'npm', ['ci']],
  ['vue-vitest', 'corepack', ['pnpm', 'install', '--frozen-lockfile']],
  ['lit-open-wc', 'corepack', ['yarn', 'install', '--immutable']],
  ['solid-pnp', 'corepack', ['yarn', 'install', '--immutable']],
];

for (const [fixture, manager, installArgs] of fixtures) {
  const cwd = join(root, 'fixtures', fixture);
  const install = spawnSync(manager, installArgs, { cwd, stdio: 'inherit' });

  if (install.status !== 0) {
    process.exit(install.status ?? 1);
  }

  const runCommand = fixture === 'solid-pnp' ? 'corepack' : process.execPath;
  const runArgs = fixture === 'solid-pnp'
    ? ['yarn', 'node', join(root, 'src', 'cli.mjs'), 'run', 'test:browser']
    : [join(root, 'src', 'cli.mjs'), 'run', 'test:browser'];
  const run = spawnSync(runCommand, runArgs, {
    cwd,
    stdio: 'inherit',
  });

  if (run.status !== 0) {
    process.exit(run.status ?? 1);
  }
}
