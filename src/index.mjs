import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export const DEFAULT_MEMORY = '4g';
export const DEFAULT_SHM_SIZE = '1g';

export function defineConfig(config) {
  return config;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

export function packageManager(root) {
  const manifest = readJson(path.join(root, 'package.json'));
  const declared = /^([^@]+)@/.exec(manifest.packageManager ?? '')?.[1];
  const lockfiles = [
    ['npm', 'package-lock.json'],
    ['npm', 'npm-shrinkwrap.json'],
    ['pnpm', 'pnpm-lock.yaml'],
    ['yarn', 'yarn.lock'],
  ].filter(([, file]) => existsSync(path.join(root, file)));
  const managers = [...new Set(lockfiles.map(([name]) => name))];

  if (managers.length !== 1 || (declared && declared !== managers[0])) {
    throw new Error('Expected one lockfile matching packageManager (npm, pnpm, or yarn)');
  }

  return { name: managers[0], lockfile: lockfiles[0][1] };
}

export function playwrightVersion(root) {
  const manifest = readJson(path.join(root, 'package.json'));
  const dependencies = { ...manifest.dependencies, ...manifest.devDependencies };
  const direct = ['playwright', '@playwright/test'].filter((name) => name in dependencies);

  if (!direct.length) {
    throw new Error('Add playwright or @playwright/test as a direct dependency');
  }

  const requireFromRoot = createRequire(path.join(root, 'package.json'));
  const versions = direct.map((name) => {
    try {
      return requireFromRoot(`${name}/package.json`).version;
    } catch {
      throw new Error(`Install ${name} in the host project before running pw-docker`);
    }
  });

  if (new Set(versions).size !== 1) {
    throw new Error(`Direct Playwright packages disagree: ${versions.join(', ')}`);
  }

  for (const launcher of ['@web/test-runner-playwright', '@vitest/browser-playwright']) {
    if (!(launcher in dependencies)) {
      continue;
    }

    const launcherRequire = createRequire(requireFromRoot.resolve(launcher));
    const launcherVersion = launcherRequire('playwright/package.json').version;

    if (launcherVersion !== versions[0]) {
      throw new Error(`${launcher} resolves Playwright ${launcherVersion}, but the project resolves ${versions[0]}; pin one version with package-manager resolutions or overrides`);
    }
  }

  return versions[0];
}

export function workspaceDirectories(root, manager) {
  const manifest = readJson(path.join(root, 'package.json'));
  const workspaces = Array.isArray(manifest.workspaces)
    ? manifest.workspaces
    : (manifest.workspaces?.packages ?? []);

  if (manager === 'pnpm' && existsSync(path.join(root, 'pnpm-workspace.yaml'))) {
    const source = readFileSync(path.join(root, 'pnpm-workspace.yaml'), 'utf8');

    workspaces.push(...[...source.matchAll(/^\s*-\s*['"]?([^'"\n]+?)['"]?\s*$/gm)].map((match) => match[1]));
  }

  const directories = new Set(['.']);

  for (const glob of workspaces) {
    if (glob.startsWith('!')) {
      continue;
    }

    const candidates = glob.endsWith('/*')
      ? (() => {
          const parent = path.join(root, glob.slice(0, -2));

          return existsSync(parent)
            ? readdirSync(parent, { withFileTypes: true })
                .filter((entry) => entry.isDirectory())
                .map((entry) => `${glob.slice(0, -1)}${entry.name}`)
            : [];
        })()
      : [glob];

    for (const candidate of candidates) {
      if (existsSync(path.join(root, candidate, 'package.json'))) {
        directories.add(candidate);
      }
    }
  }

  return [...directories].sort();
}

export function cacheKey(root, manager, image, directories) {
  const hash = createHash('sha256');

  hash.update(`${manager.name}\n${image}\n`);
  hash.update(readFileSync(path.join(root, manager.lockfile)));

  for (const directory of directories) {
    hash.update(readFileSync(path.join(root, directory, 'package.json')));
  }

  for (const file of ['.yarnrc.yml', '.npmrc', 'pnpm-workspace.yaml']) {
    if (existsSync(path.join(root, file))) {
      hash.update(readFileSync(path.join(root, file)));
    }
  }

  return hash.digest('hex');
}

export function loadConfig(root) {
  const file = path.join(root, 'playwright-docker.config.mjs');

  return existsSync(file) ? import(pathToFileURL(file).href).then((module) => module.default ?? {}) : Promise.resolve({});
}

function volumePrefix(root) {
  return `pw-docker-${createHash('sha256').update(path.resolve(root)).digest('hex').slice(0, 12)}`;
}

export function forwardedEnv(hostEnv, names = []) {
  const forwarded = {};

  for (const name of new Set(['CI', ...names])) {
    if (hostEnv[name] !== undefined) {
      forwarded[name] = hostEnv[name];
    }
  }

  return forwarded;
}

export function dockerPlan({ root, manager, version, command, args = [], config = {}, env = process.env, platform = process.platform, home = homedir(), uid, gid, tty = false, freshInstall = false }) {
  const installMode = config.installMode ?? 'isolated';
  const image = config.image ?? `mcr.microsoft.com/playwright:v${version}-noble`;
  const memory = config.memory ?? DEFAULT_MEMORY;
  const prefix = volumePrefix(root);
  const run = ['run', '--rm', '--init', '--memory', memory, '--memory-swap', memory, '--shm-size', config.shmSize ?? DEFAULT_SHM_SIZE];
  const volumes = [];
  const workdir = installMode === 'host-pnp' ? root : '/work';

  if (tty) {
    run.push('-it');
  }

  if (config.network) {
    run.push('--network', config.network);
  }

  if (platform === 'linux' && uid !== undefined && gid !== undefined) {
    run.push('--user', `${uid}:${gid}`);
  }

  if (installMode === 'host-pnp') {
    if (platform !== 'linux' || manager.name !== 'yarn') {
      throw new Error('host-pnp requires Yarn on a Linux or WSL host');
    }

    if (!existsSync(path.join(root, '.pnp.cjs'))) {
      throw new Error('host-pnp requires an installed Yarn PnP project (.pnp.cjs)');
    }

    run.push('-v', `${root}:${root}`, '-v', `${path.join(home, '.yarn', 'berry')}:${path.join(home, '.yarn', 'berry')}:ro`);
    run.push('-v', `${path.join(home, '.cache', 'node', 'corepack')}:${path.join(home, '.cache', 'node', 'corepack')}`);
  } else if (installMode === 'isolated') {
    const linker = manager.name === 'yarn' && existsSync(path.join(root, '.yarnrc.yml'))
      ? readFileSync(path.join(root, '.yarnrc.yml'), 'utf8')
      : '';

    if (manager.name === 'yarn' && !/^nodeLinker:\s*node-modules\s*$/m.test(linker)) {
      throw new Error('Yarn PnP requires explicit host-pnp mode on Linux');
    }

    run.push('-v', `${root}:/work`);
    volumes.push(`${prefix}-cache`);
    run.push('-v', `${prefix}-cache:/cache`);

    for (const directory of workspaceDirectories(root, manager.name)) {
      const slug = directory === '.' ? 'root' : directory.replace(/[^a-zA-Z0-9]+/g, '-');
      const volume = `${prefix}-nm-${slug}`;
      const target = directory === '.' ? '/work/node_modules' : `/work/${directory}/node_modules`;

      volumes.push(volume);
      run.push('-v', `${volume}:${target}`);
    }
  } else {
    throw new Error(`Unknown install mode: ${installMode}`);
  }

  for (const mount of config.mounts ?? []) {
    const source = path.resolve(root, mount.source);

    if (!existsSync(source)) {
      throw new Error(`Mount source does not exist: ${source}`);
    }

    run.push('-v', `${source}:${mount.target}${mount.readOnly ? ':ro' : ''}`);
  }

  for (const [index, fontDir] of (config.fontDirs ?? []).entries()) {
    const source = path.resolve(root, fontDir);

    if (!existsSync(source)) {
      throw new Error(`Font directory does not exist: ${source}`);
    }

    run.push('-v', `${source}:/usr/share/fonts/truetype/pw-docker-${index}:ro`);
  }

  const containerEnv = {
    ...forwardedEnv(env, config.passEnv),
    PW_DOCKER_INSIDE: '1',
    PW_DOCKER_VERSION: version,
    TZ: config.timezone ?? 'UTC',
    LANG: config.locale ?? 'C.UTF-8',
    LC_ALL: config.locale ?? 'C.UTF-8',
    HOME: platform === 'linux' ? '/tmp/pw-docker-home' : '/root',
    COREPACK_HOME: installMode === 'host-pnp' ? path.join(home, '.cache', 'node', 'corepack') : '/cache/corepack',
    YARN_GLOBAL_FOLDER: installMode === 'host-pnp' ? path.join(home, '.yarn', 'berry') : '/cache/yarn',
    npm_config_cache: installMode === 'host-pnp' ? path.join(home, '.npm') : '/cache/npm',
  };

  if (installMode === 'isolated') {
    containerEnv.PW_DOCKER_CACHE_KEY = cacheKey(root, manager, image, workspaceDirectories(root, manager.name));
    containerEnv.PW_DOCKER_FRESH = freshInstall ? '1' : '0';
  }

  for (const [name, value] of Object.entries(containerEnv)) {
    run.push('-e', `${name}=${value}`);
  }

  run.push('-w', workdir, image, 'bash', '-c', CONTAINER_SCRIPT, 'pw-docker', manager.name, installMode, command, ...args);

  return { args: run, image, volumes, containerEnv };
}

export const CONTAINER_SCRIPT = `set -eu
manager="$1"; mode="$2"; action="$3"; shift 3
mkdir -p "$HOME/bin" "$COREPACK_HOME"
if [ "$manager" != npm ]; then
  corepack enable --install-directory "$HOME/bin" >/dev/null
  export PATH="$HOME/bin:$PATH"
fi
if [ "$mode" = isolated ]; then
  case "$manager" in
    npm) install='npm ci' ;;
    pnpm) install='pnpm install --frozen-lockfile' ;;
    yarn) install='yarn install --immutable' ;;
  esac
  if [ "$PW_DOCKER_FRESH" = 1 ] || [ ! -f /cache/install-stamp ] || [ "$(cat /cache/install-stamp)" != "$PW_DOCKER_CACHE_KEY" ]; then
    $install
    printf '%s' "$PW_DOCKER_CACHE_KEY" > /cache/install-stamp
  fi
fi
if [ "$manager" = yarn ]; then
  found="$(yarn node -p 'try { require("playwright/package.json").version } catch { require("@playwright/test/package.json").version }')"
else
  found="$(node -p 'try { require("playwright/package.json").version } catch { require("@playwright/test/package.json").version }')"
fi
if [ "$found" != "$PW_DOCKER_VERSION" ]; then
  echo "Playwright version mismatch: image expects $PW_DOCKER_VERSION, installed $found" >&2
  exit 1
fi
if [ "$action" = run ]; then
  exec "$manager" run "$@"
fi
exec "$@"`;
