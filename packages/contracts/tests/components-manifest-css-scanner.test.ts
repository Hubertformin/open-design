import { describe, expect, it } from 'vitest';

import { extractComponentsManifest } from '../src/design-systems/components-manifest.js';

function manifestFor(css: string, bodyHtml = '') {
  return extractComponentsManifest({
    brandId: 'scanner-fixture',
    fixtureHtml: `<style>${css}</style>${bodyHtml}`,
  });
}

function groupTokens(css: string, groupId: string, bodyHtml = ''): string[] {
  const group = manifestFor(css, bodyHtml).groups.find((candidate) => candidate.id === groupId);
  if (!group) throw new Error(`Unknown group ${groupId}`);
  return group.tokenReferences;
}

describe('css rule scanning', () => {
  it('attributes tokens to every rule in a consecutive run', () => {
    const css = `
      .btn { color: var(--accent); }
      .card { background: var(--surface); }
      .badge { border-color: var(--border); }
    `;
    const bodyHtml = '<button class="btn"></button><div class="card"></div><span class="badge"></span>';

    expect(groupTokens(css, 'buttons', bodyHtml)).toEqual(['--accent']);
    expect(groupTokens(css, 'cards', bodyHtml)).toEqual(['--surface']);
    expect(groupTokens(css, 'badges', bodyHtml)).toEqual(['--border']);
  });

  it('keeps token attribution when rules are separated by a block at-rule', () => {
    const css = `
      .btn { color: var(--accent); }
      @media (min-width: 40rem) {
        .btn { padding: var(--space-4); }
      }
      .card { background: var(--surface); }
    `;
    const bodyHtml = '<button class="btn"></button><div class="card"></div>';

    expect(groupTokens(css, 'buttons', bodyHtml)).toEqual(['--accent', '--space-4']);
    expect(groupTokens(css, 'cards', bodyHtml)).toEqual(['--surface']);
  });

  it('reads tokens from a rule that owns a nested block', () => {
    const css = `
      .card {
        background: var(--surface);
        &:hover { border-color: var(--accent); }
      }
    `;

    expect(groupTokens(css, 'cards', '<div class="card"></div>')).toEqual(['--accent', '--surface']);
  });

  it('resolves nested selectors instead of emitting declaration text as a selector', () => {
    const css = `
      .card {
        background: var(--surface);
        &:hover { border-color: var(--accent); }
        .title { color: var(--fg); }
      }
    `;

    expect(manifestFor(css).selectors).toEqual(['.card', '.card .title', '.card:hover']);
  });

  it('does not treat a declaration block as a selector when a rule nests', () => {
    const css = '.card { background: var(--surface); &:hover { color: var(--fg); } }';

    for (const selector of manifestFor(css).selectors) {
      expect(selector).not.toContain('var(');
      expect(selector).not.toContain(';');
    }
  });
});

describe('statement at-rules', () => {
  // A top-level statement at-rule terminates at `;` and owns no block. Scanning
  // must step over it without consuming the rule that follows.
  it.each([
    ['@charset "utf-8";'],
    ['@namespace svg url(http://www.w3.org/2000/svg);'],
    ['@layer base, components;'],
    ['@import url("theme.css");'],
    ['@IMPORT url("theme.css");'],
  ])('does not swallow the first rule after %s', (statement) => {
    const css = `${statement}\n.btn { color: var(--accent); }`;

    expect(groupTokens(css, 'buttons', '<button class="btn"></button>')).toEqual(['--accent']);
  });

  it('steps over a statement at-rule whose prelude contains braces in a string', () => {
    const css = '@import url("a{b}.css");\n.btn { color: var(--accent); }';

    expect(groupTokens(css, 'buttons', '<button class="btn"></button>')).toEqual(['--accent']);
  });
});

describe('lexical edge cases', () => {
  it('ignores braces inside string values', () => {
    const css = `
      .btn::before { content: "{"; color: var(--accent); }
      .card { background: var(--surface); }
    `;
    const bodyHtml = '<button class="btn"></button><div class="card"></div>';

    expect(groupTokens(css, 'buttons', bodyHtml)).toEqual(['--accent']);
    expect(groupTokens(css, 'cards', bodyHtml)).toEqual(['--surface']);
  });

  it('ignores braces inside an escaped selector', () => {
    const css = `
      .w-\\{full\\} { color: var(--accent); }
      .card { background: var(--surface); }
    `;

    expect(groupTokens(css, 'cards', '<div class="card"></div>')).toEqual(['--surface']);
  });

  it('keeps a comma inside a selector function out of the selector split', () => {
    const css = '.card:is(.a, .b) { background: var(--surface); }';

    expect(manifestFor(css).selectors).toEqual(['.card:is(.a, .b)']);
  });
});

describe('class matchers', () => {
  it('matches whole class-name segments rather than substrings', () => {
    const bodyHtml = `
      <div class="platform"></div>
      <div class="icon-octagon"></div>
      <div class="form-field"></div>
      <div class="cta-primary"></div>
    `;
    const manifest = manifestFor('.form-field { color: var(--fg); }', bodyHtml);
    const classesFor = (id: string) => manifest.groups.find((group) => group.id === id)?.classes ?? [];

    expect(classesFor('inputs')).toEqual(['form-field']);
    expect(classesFor('buttons')).toEqual(['cta-primary']);
  });
});
