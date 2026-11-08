import { afterEach, expect, test } from 'vitest';
import { createApp, h, ref } from 'vue';

let app;

afterEach(() => {
  app?.unmount();
  globalThis.document.body.innerHTML = '';
});

test('Vue component responds in a real browser', async () => {
  const Counter = {
    setup() {
      const count = ref(0);

      return () => h('button', { onClick: () => count.value++ }, `Count ${count.value}`);
    },
  };

  const root = globalThis.document.createElement('div');

  globalThis.document.body.append(root);
  app = createApp(Counter);
  app.mount(root);
  root.querySelector('button').click();
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(root.textContent).toBe('Count 1');
});
