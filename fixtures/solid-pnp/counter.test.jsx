import { afterEach, expect, test } from 'vitest';
import { render } from 'solid-js/web';
import { createSignal } from 'solid-js';

let dispose;

afterEach(() => {
  dispose?.();
  globalThis.document.body.innerHTML = '';
});

test('Solid component responds in a real browser', () => {
  function Counter() {
    const [count, setCount] = createSignal(0);

    return <button onClick={() => setCount(count() + 1)}>Count {count()}</button>;
  }

  const root = globalThis.document.createElement('div');

  globalThis.document.body.append(root);
  dispose = render(() => <Counter />, root);
  root.querySelector('button').click();
  expect(root.textContent).toBe('Count 1');
});
