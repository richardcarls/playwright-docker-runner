import { defineConfig } from 'vitest/config';
import solid from 'vite-plugin-solid';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  plugins: [solid()],
  test: {
    browser: {
      enabled: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
      headless: true,
    },
  },
});
