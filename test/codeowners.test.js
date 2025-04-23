import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { parseOwners } from '../scripts/lib/codeowners.js';
import { ROOT } from './helpers.js';

describe('parseOwners', () => {
  it('collects individual owners from every rule, lower-cased', () => {
    const text = [
      '# Order-to-Cash',
      '*               @venkat-prizmato @krunal-prizmato',
      '/src/rounding/  @aaquib-prizmato   # rounding policy',
      '/contracts/     @Aaquib-Prizmato',
    ].join('\n');
    assert.deepEqual([...parseOwners(text)].sort(), [
      'aaquib-prizmato',
      'krunal-prizmato',
      'venkat-prizmato',
    ]);
  });

  it('skips team owners and emails', () => {
    const owners = parseOwners('* @prizmatoo/btwl-engineering cei@btwl.example @cei-prizmato');
    assert.deepEqual([...owners], ['cei-prizmato']);
  });

  it("reads this repo's CODEOWNERS", () => {
    const owners = parseOwners(readFileSync(join(ROOT, 'CODEOWNERS'), 'utf8'));
    assert.deepEqual([...owners], ['cei-prizmato', 'gehna-prizmato']);
  });
});
