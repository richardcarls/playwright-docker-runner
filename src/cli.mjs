#!/usr/bin/env node
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { dockerPlan, loadConfig, packageManager, playwrightVersion } from './index.mjs';

function usage() {
  console.log(`pw-docker run <package-script> [args...]
pw-docker exec -- <command> [args...]
pw-docker doctor

Options: --root <directory>, --dry-run, --fresh-install`);
}

function parseArguments(argv) {
  let root = process.cwd();
  let dryRun = false;
  let freshInstall = false;
  const remaining = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === '--root') {
      if (!argv[index + 1]) {
        throw new Error('--root requires a directory');
      }

      root = path.resolve(argv[++index]);
    } else if (arg === '--dry-run') {
      dryRun = true;
    } else if (arg === '--fresh-install') {
      freshInstall = true;
    } else {
      remaining.push(arg);
    }
  }

  return { root, dryRun, freshInstall, remaining };
}

function docker(args, options = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...options });
}

function prepareVolumes(volumes, image, user) {
  const createdVolumes = [];

  for (const volume of volumes) {
    if (docker(['volume', 'inspect', volume]).status === 0) {
      continue;
    }

    const created = docker(['volume', 'create', volume]);

    if (created.status !== 0) {
      throw new Error(`Could not create Docker volume ${volume}: ${created.stderr?.trim()}`);
    }

    createdVolumes.push(volume);

    if (user) {
      const prepared = docker(['run', '--rm', '-v', `${volume}:/volume`, image, 'chown', '-R', user, '/volume']);

      if (prepared.status !== 0) {
        throw new Error(`Could not grant ${user} access to Docker volume ${volume}: ${prepared.stderr?.trim()}`);
      }
    }
  }

  return createdVolumes;
}

async function main() {
  const { root, dryRun, freshInstall, remaining } = parseArguments(process.argv.slice(2));
  const [command, ...args] = remaining;

  if (command === '--help' || command === '-h' || !command) {
    usage();

    return;
  }

  if (!['run', 'exec', 'doctor'].includes(command) || (command === 'run' && !args[0])) {
    usage();
    process.exitCode = 2;

    return;
  }

  if (command === 'exec' && args[0] === '--') {
    args.shift();
  }

  if (command === 'exec' && !args.length) {
    throw new Error('exec requires a command after --');
  }

  if (!existsSync(path.join(root, 'package.json'))) {
    throw new Error(`No package.json at ${root}`);
  }

  const manager = packageManager(root);
  const version = playwrightVersion(root);
  const config = await loadConfig(root);
  const home = homedir();

  const plan = dockerPlan({
    root,
    manager,
    version,
    command: command === 'doctor' ? 'run' : command,
    args,
    config,
    home,
    uid: process.getuid?.(),
    gid: process.getgid?.(),
    tty: Boolean(process.stdin.isTTY && process.stdout.isTTY),
    freshInstall,
  });

  if (command === 'doctor' || dryRun) {
    const daemon = docker(['version', '--format', '{{.Server.Version}}']);

    console.log(JSON.stringify({
      root,
      packageManager: manager.name,
      playwrightVersion: version,
      image: plan.image,
      installMode: config.installMode ?? 'isolated',
      dockerAvailable: daemon.status === 0,
      volumes: plan.volumes,
      forwardedEnv: Object.keys(plan.containerEnv).sort(),
      command: remaining,
    }, null, 2));

    if (command === 'doctor') {
      process.exitCode = daemon.status === 0 ? 0 : 1;

      return;
    }

    return;
  }

  const daemon = docker(['version', '--format', '{{.Server.Version}}']);

  if (daemon.status !== 0) {
    throw new Error('Docker daemon is unavailable; start Docker Desktop or the Docker service');
  }

  if (config.installMode === 'host-pnp') {
    mkdirSync(path.join(home, '.cache', 'node', 'corepack'), { recursive: true });
  }

  const createdVolumes = prepareVolumes(plan.volumes, plan.image, process.platform === 'linux' ? `${process.getuid()}:${process.getgid()}` : null);

  if (createdVolumes.some((volume) => volume.includes('-nm-'))) {
    const fresh = plan.args.indexOf('PW_DOCKER_FRESH=0');

    if (fresh >= 0) {
      plan.args[fresh] = 'PW_DOCKER_FRESH=1';
    }
  }

  const child = spawn('docker', plan.args, { stdio: 'inherit' });

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => child.kill(signal));
  }

  const status = await new Promise((resolve, reject) => {
    child.on('error', reject);
    child.on('exit', (code, signal) => resolve({ code, signal }));
  });

  if (status.code === 137) {
    console.error(`The container reached its ${config.memory ?? '4g'} memory limit; raise memory or reduce test concurrency.`);
  }

  process.exitCode = status.code ?? (status.signal ? 128 + (status.signal === 'SIGINT' ? 2 : 15) : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`pw-docker: ${error.message}`);
    process.exitCode = 1;
  });
}
