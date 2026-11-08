import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const fixture = path.join(root, 'fixtures', 'react-playwright');
const configFile = path.join(fixture, 'playwright-docker.config.mjs');

function run(command, args, cwd = fixture) {
  const result = spawnSync(command, args, { cwd, stdio: command === 'openssl' ? 'pipe' : 'inherit', encoding: 'utf8' });

  if (result.status !== 0) {
    throw new Error(`${command} failed with exit ${result.status ?? 'unknown'}: ${result.stderr ?? ''}`);
  }
}

if (existsSync(configFile)) {
  throw new Error(`Temporary CA fixture would overwrite ${configFile}`);
}

const temp = mkdtempSync(path.join(tmpdir(), 'pw-docker-ca-fixture-'));
const leaf = path.join(temp, 'leaf');

try {
  mkdirSync(leaf);
  run('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(temp, 'root.key'), '-out', path.join(temp, 'rootCA.pem'), '-days', '1', '-subj', '/CN=Playwright Docker Test CA', '-addext', 'basicConstraints=critical,CA:TRUE', '-addext', 'keyUsage=critical,keyCertSign,cRLSign']);
  run('openssl', ['req', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(leaf, 'leaf.key'), '-out', path.join(temp, 'leaf.csr'), '-subj', '/CN=localhost']);
  writeFileSync(path.join(temp, 'leaf.ext'), 'subjectAltName=DNS:localhost,IP:127.0.0.1\n');
  run('openssl', ['x509', '-req', '-in', path.join(temp, 'leaf.csr'), '-CA', path.join(temp, 'rootCA.pem'), '-CAkey', path.join(temp, 'root.key'), '-CAcreateserial', '-out', path.join(leaf, 'leaf.crt'), '-days', '1', '-extfile', path.join(temp, 'leaf.ext')]);
  writeFileSync(configFile, `export default ${JSON.stringify({ caCert: path.join(temp, 'rootCA.pem'), mounts: [{ source: leaf, target: '/cert', readOnly: true }] })};\n`);
  run(process.execPath, [path.join(root, 'src', 'cli.mjs'), 'exec', '--', 'node', '/work/ca-probe.mjs']);
} finally {
  rmSync(configFile, { force: true });
  rmSync(temp, { recursive: true, force: true });
}
