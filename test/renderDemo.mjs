import assert from 'node:assert/strict';
import { renderDemo } from '../demos/renderDemo.js';

describe('renderDemo layout', () => {
  let documentBefore;
  let nodes;

  beforeEach(() => {
    documentBefore = globalThis.document;
    nodes = [];
    globalThis.document = {
      createElement: tag => ({ tag }),
      body: { appendChild: node => nodes.push(node) },
    };
  });

  afterEach(() => {
    globalThis.document = documentBefore;
  });

  it('orders group headings and counted breaks around awaited steps', async () => {
    const first = [{ id: 1 }, { id: 2 }];
    const second = [{ id: 3 }];
    const plots = await renderDemo([
      {
        name: '<em>Group one</em>',
        breakBefore: 2,
        breakAfter: 2,
        steps: [
          {
            breakBefore: 1,
            breakAfter: 2,
            render: async () => {
              await Promise.resolve();
              nodes.push({ tag: 'plot', id: 1 });
              return first;
            },
          },
          {
            breakBefore: 2,
            breakAfter: 1,
            render: () => {
              nodes.push({ tag: 'plot', id: 2 });
              return second;
            },
          },
        ],
      },
      { name: 'Empty group', breakBefore: 1, steps: [], breakAfter: 1 },
    ]);

    assert.deepStrictEqual(nodes, [
      { tag: 'br' }, { tag: 'br' },
      { tag: 'h2', textContent: '<em>Group one</em>' },
      { tag: 'br' }, { tag: 'plot', id: 1 },
      { tag: 'br' }, { tag: 'br' },
      { tag: 'br' }, { tag: 'br' }, { tag: 'plot', id: 2 },
      { tag: 'br' }, { tag: 'br' }, { tag: 'br' },
      { tag: 'br' }, { tag: 'h2', textContent: 'Empty group' }, { tag: 'br' },
    ]);
    assert.strictEqual(plots[0], first);
    assert.strictEqual(plots[1], second);
  });

  it('adds no layout for absent, null, or zero break counts and empty names', async () => {
    const plots = await renderDemo([
      { steps: [{ render: () => 'first' }] },
      { name: '', breakBefore: 0, breakAfter: null, steps: [
        { breakBefore: null, breakAfter: 0, render: () => 'second' },
      ] },
    ]);

    assert.deepStrictEqual(nodes, []);
    assert.deepStrictEqual(plots, ['first', 'second']);
    assert.deepStrictEqual(await renderDemo([]), []);
  });

  it('stops rendering and propagates step failures', async () => {
    const error = new Error('render failed');
    await assert.rejects(renderDemo([{ breakAfter: 1, steps: [
      { breakAfter: 1, render: async () => { throw error; } },
      { render: () => assert.fail('must not render the next step') },
    ] }]), err => err === error);
    assert.deepStrictEqual(nodes, []);
  });
});
