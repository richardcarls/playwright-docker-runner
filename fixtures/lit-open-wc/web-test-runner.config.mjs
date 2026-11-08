import { playwrightLauncher } from '@web/test-runner-playwright';

export default {
  nodeResolve: true,
  browsers: [playwrightLauncher({ product: 'chromium' })],
};
