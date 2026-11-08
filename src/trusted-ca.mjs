import { spawnSync } from 'node:child_process';
import { createHash, X509Certificate } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

export const CA_CERT_PATH = '/usr/local/share/ca-certificates/pw-docker-local.crt';
export const FIREFOX_POLICY_PATH = '/usr/local/share/pw-docker/firefox-policies.json';

const DOCKERFILE = `ARG BASE_IMAGE=mcr.microsoft.com/playwright:v1.58.2-noble
FROM \${BASE_IMAGE}
COPY rootCA.crt ${CA_CERT_PATH}
RUN update-ca-certificates \\
 && apt-get update \\
 && apt-get install -y --no-install-recommends libnss3-tools \\
 && rm -rf /var/lib/apt/lists/* \\
 && mkdir -p /usr/local/share/pw-docker \\
 && printf '%s' '{"policies":{"Certificates":{"Install":["${CA_CERT_PATH}"]}}}' > ${FIREFOX_POLICY_PATH}
`;

export function trustedImage(root, caCert, baseImage) {
  const source = path.resolve(root, caCert);
  const certificate = readFileSync(source);
  const pem = certificate.toString('utf8');

  if ((pem.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length !== 1 || /PRIVATE KEY/.test(pem)) {
    throw new Error('caCert must contain one public PEM CA certificate and no private key');
  }

  let parsed;

  try {
    parsed = new X509Certificate(certificate);
  } catch {
    throw new Error(`caCert is not a valid PEM certificate: ${source}`);
  }

  if (!parsed.ca) {
    throw new Error('caCert must be a CA certificate, not a server certificate');
  }

  const hash = createHash('sha256')
    .update(baseImage)
    .update(DOCKERFILE)
    .update(certificate)
    .digest('hex')
    .slice(0, 20);

  return { image: `pw-docker-ca:${hash}`, baseImage, source };
}

export function buildTrustedImage(trusted) {
  if (spawnSync('docker', ['image', 'inspect', trusted.image], { stdio: 'ignore' }).status === 0) {
    return;
  }

  const context = mkdtempSync(path.join(tmpdir(), 'pw-docker-ca-'));

  try {
    writeFileSync(path.join(context, 'Dockerfile'), DOCKERFILE);
    copyFileSync(trusted.source, path.join(context, 'rootCA.crt'));

    const result = spawnSync('docker', ['build', '--tag', trusted.image, '--build-arg', `BASE_IMAGE=${trusted.baseImage}`, context], { stdio: 'inherit' });

    if (result.status !== 0) {
      throw new Error(`Could not build trusted CA image ${trusted.image}`);
    }
  } finally {
    rmSync(context, { recursive: true, force: true });
  }
}
