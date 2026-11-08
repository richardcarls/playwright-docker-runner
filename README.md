# Playwright Docker Runner

Run a project's browser tests inside the official Playwright Docker image matching its installed
`playwright` or `@playwright/test` version. The runner accepts any package script, including
Playwright Test, Vitest Browser Mode, and Web Test Runner. Docker is required; it never falls back
to a host browser silently.

## Install

```sh
npm install --save-dev @rcarls/playwright-docker-runner playwright
```

The project must declare `playwright` or `@playwright/test` directly and have one npm, pnpm, or
Yarn lockfile. Run the CLI through the project's package manager, so Yarn PnP can resolve its
dependencies.

```sh
pw-docker run test:browser
pw-docker run test:browser -- my-test-file
pw-docker exec -- node scripts/browser-benchmark.mjs
pw-docker doctor
pw-docker --dry-run run test:browser
```

In `package.json`, keep the container entry separate from the script it runs:

```json
{
  "scripts": {
    "test:browser": "pw-docker run test:browser:host",
    "test:browser:host": "vitest run --browser"
  }
}
```

The default image is `mcr.microsoft.com/playwright:v<installed-version>-noble`. npm, pnpm, and
Yarn projects with `nodeLinker: node-modules` install dependencies into named Docker volumes.
The root checkout remains mounted so reports and screenshots land on the host. A cache key includes
the lockfile, workspace manifests, package-manager configuration, and image. Use `--fresh-install`
to rebuild an install after external corruption.

## Configuration

Create `playwright-docker.config.mjs` only when the defaults need adjustment:

```js
import { defineConfig } from '@rcarls/playwright-docker-runner';

export default defineConfig({
  memory: '6g',
  passEnv: ['TEST_API_URL'],
  fontDirs: ['test/fonts'],
  network: 'integration',
});
```

`CI` is the only host variable forwarded by default. The container sets `TZ=UTC`, `LANG=C.UTF-8`,
and `LC_ALL=C.UTF-8` unless `timezone` or `locale` overrides them. Other options are `shmSize`,
`image`, and `mounts: [{ source, target, readOnly }]`; mount sources are relative to the project
root unless absolute. The default memory cap is 4 GB with swap disabled, and shared memory is 1 GB.
The runner passes the container's exit status through, and explains exit 137 as a likely memory
limit hit. `doctor` reports configuration and Docker reachability without starting a container.

### Yarn Plug'n'Play

PnP's loader records paths to the host cache. On Linux or WSL, use `installMode: 'host-pnp'` to
mount the checkout and cache at those same paths without installing inside Docker. Mount each
portal or linked sibling the PnP loader needs:

```js
import { defineConfig } from '@rcarls/playwright-docker-runner';

export default defineConfig({
  installMode: 'host-pnp',
  mounts: [
    { source: '../recipe-ingredient', target: '/home/user/projects/recipe-ingredient' },
  ],
  passEnv: ['RC_LOCAL'],
});
```

The `target` must be the sibling's actual absolute host path in this mode. Run the host's immutable
Yarn install before tests. PnP mode requires a Linux host and a completed `.pnp.cjs` install.

## Compatibility and development

The image supplies Chromium, Firefox, and WebKit. A web server started by a test framework runs
inside the container; bind it to `0.0.0.0` when its browser needs to reach it. The official image
is for trusted test code. Project scripts and install hooks run with access to the mounted project.

Automated Docker fixtures cover npm with Playwright Test/React, pnpm with Vitest Browser Mode/Vue,
and Yarn with Web Test Runner/Open WC/Lit. The Linux PnP fixture covers Solid/Vitest. CI runs
Docker fixtures on Linux. macOS and Windows path adapters have non-Docker tests, so actual Docker
Desktop runs on those hosts remain provisional.

```sh
npm test
npm run pack:check
```

The package is prepared for a public npm release but is not published yet.
