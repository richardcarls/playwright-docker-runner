import { readFileSync } from 'node:fs';
import { createServer } from 'node:https';
import { chromium, firefox, webkit } from 'playwright';

const server = createServer({
  key: readFileSync('/cert/leaf.key'),
  cert: readFileSync('/cert/leaf.crt'),
}, (request, response) => {
  response.writeHead(200, { 'content-type': request.url === '/sw.js' ? 'text/javascript' : 'text/html' });
  response.end(request.url === '/sw.js' ? 'self.addEventListener("fetch", () => {});' : '<h1>trusted</h1>');
});

await new Promise((resolve) => server.listen(4443, '127.0.0.1', resolve));

try {
  for (const [name, browserType] of Object.entries({ chromium, firefox, webkit })) {
    const browser = await browserType.launch();

    try {
      const page = await browser.newPage();
      const response = await page.goto('https://localhost:4443');
      const worker = await page.evaluate(async () => {
        const registration = await globalThis.navigator.serviceWorker.register('/sw.js');

        return registration.scope;
      });

      if (response.status() !== 200 || worker !== 'https://localhost:4443/') {
        throw new Error(`${name}: unexpected HTTPS or service worker result`);
      }

      console.log(`${name}: verified HTTPS and service worker registration`);
    } finally {
      await browser.close();
    }
  }
} finally {
  server.close();
}
