import { expect, fixture, html } from '@open-wc/testing';
import { LitElement } from 'lit';

class TestCounter extends LitElement {
  static properties = { count: { type: Number } };

  constructor() {
    super();
    this.count = 0;
  }

  render() {
    return html`<button @click=${() => this.count++}>Count ${this.count}</button>`;
  }
}

globalThis.customElements.define('test-counter', TestCounter);

globalThis.describe('Lit counter', () => {
  globalThis.it('responds in the Open WC browser runner', async () => {
    const element = await fixture(html`<test-counter></test-counter>`);

    element.shadowRoot.querySelector('button').click();
    await element.updateComplete;
    expect(element.shadowRoot.querySelector('button').textContent).to.equal('Count 1');
  });
});
