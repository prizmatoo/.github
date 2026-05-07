import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  daysSince,
  junitOutcome,
  main,
  parseArgs,
  readQuarantine,
  render,
} from '../scripts/quarantine-summary.js';

// btwl-order-service's test/quarantine.json as of 2026-05.
const ORDER_SERVICE = {
  tests: [
    {
      name: 'quote expires at end of day',
      file: 'test/quote/expiry.test.ts',
      issue: 'BTWL-402',
      since: '2026-03-18',
      skipInCiBetweenUtc: ['23:00', '00:30'],
      why: 'uses the real clock: fails when the quote and the check fall on two UTC days',
    },
  ],
};

/** Vitest's JUnit for one file, with the quarantined test in the given state. */
const vitestJunit = (/** @type {string} */ inner) => `<?xml version="1.0" encoding="UTF-8" ?>
<testsuites name="vitest tests" tests="2" failures="0" errors="0" time="0.41">
    <testsuite name="test/quote/expiry.test.ts" tests="2" failures="0" errors="0" skipped="0" time="0.01">
        <testcase classname="test/quote/expiry.test.ts" name="quote expiry &gt; quote is valid for 24 hours" time="0.002">
        </testcase>
        <testcase classname="test/quote/expiry.test.ts" name="quote expiry &gt; quote expires at end of day" time="0.001">
${inner}
        </testcase>
    </testsuite>
</testsuites>`;

/** @param {string} name @param {string} text */
function file(name, text) {
  const path = join(mkdtempSync(join(tmpdir(), 'quarantine-')), name);
  writeFileSync(path, text);
  return path;
}

describe('quarantine-summary.js', () => {
  it('reads the entries of a quarantine file', () => {
    const entries = readQuarantine(JSON.stringify(ORDER_SERVICE));
    assert.equal(entries.length, 1);
    assert.equal(entries[0]?.issue, 'BTWL-402');
  });

  it('refuses a file that is not a list of named tests', () => {
    assert.throws(() => readQuarantine('{"skip": []}'), /expected \{ "tests"/);
    assert.throws(
      () => readQuarantine('{"tests": [{"issue": "BTWL-1"}]}'),
      /tests\[0\] has no name/,
    );
  });

  it('finds the test in a Vitest report by the last part of its name', () => {
    const name = 'quote expires at end of day';
    assert.equal(junitOutcome(vitestJunit(''), name), 'passed');
    assert.equal(junitOutcome(vitestJunit('<skipped/>'), name), 'skipped');
    assert.equal(junitOutcome(vitestJunit('<failure message="x"/>'), name), 'failed');
    assert.equal(junitOutcome(vitestJunit(''), 'end of day'), undefined);
  });

  it('finds a pytest test by its function name, self-closing testcase included', () => {
    const xml = `<testsuites><testsuite name="pytest"><testcase classname="tests.test_counts" name="test_count_closes_bin" time="0.1"/></testsuite></testsuites>`;
    assert.equal(junitOutcome(xml, 'test_count_closes_bin'), 'passed');
  });

  it('counts the days in quarantine', () => {
    assert.equal(daysSince('2026-03-18', '2026-05-04'), 47);
  });

  it('lists each test with its Jira link, age, CI window and what this build did', () => {
    const md = render(readQuarantine(JSON.stringify(ORDER_SERVICE)), {
      junit: vitestJunit('<skipped/>'),
      today: '2026-05-04',
      source: 'test/quarantine.json',
    });
    assert.match(md, /^### Quarantined tests$/m);
    assert.match(md, /1 test in `test\/quarantine\.json`/);
    assert.match(
      md,
      /\| quote expires at end of day \| `test\/quote\/expiry\.test\.ts` \| \[BTWL-402\]\(https:\/\/prizmato\.atlassian\.net\/browse\/BTWL-402\) \| 2026-03-18 \(47 days\) \| 23:00–00:30 \| skipped \|/,
    );
  });

  it('says so when a test has no Jira key, no window or is missing from the report', () => {
    const md = render([{ name: 'flaky | thing' }], {
      junit: '<testsuites/>',
      today: '2026-05-04',
      source: 't.json',
    });
    assert.match(
      md,
      /flaky \\\| thing \|  \| \*\*no Jira key\*\* \|  \| always \| not in the report \|/,
    );
    const noReport = render([{ name: 'x', issue: 'BTWL-9' }], {
      today: '2026-05-04',
      source: 't.json',
    });
    assert.match(noReport, /\| no JUnit report \|$/m);
  });

  it('says None for a repo with nothing in quarantine', () => {
    assert.match(
      render([], { today: '2026-05-04', source: 'test/quarantine.json' }),
      /None \(`test\/quarantine\.json`\)\./,
    );
  });

  it('parses its arguments', () => {
    assert.deepEqual(parseArgs(['q.json', '--junit', 'r.xml', '--today', '2026-05-04']), {
      file: 'q.json',
      junit: 'r.xml',
      today: '2026-05-04',
    });
  });

  it('appends to the job summary and never fails, even on a broken file', () => {
    const summary = file('summary.md', '');
    const q = file('quarantine.json', JSON.stringify(ORDER_SERVICE));
    const junit = file('junit.xml', vitestJunit(''));
    const env = { GITHUB_STEP_SUMMARY: summary };
    main([q, '--junit', junit, '--today', '2026-05-04'], env);
    assert.match(readFileSync(summary, 'utf8'), /\| passed \|$/m);

    const broken = file('quarantine.json', '{ not json');
    const md = main([broken, '--today', '2026-05-04'], env);
    assert.match(md, /None/);
  });

  it('treats a missing file as nothing in quarantine', () => {
    const summary = file('summary.md', '');
    const md = main(['does/not/exist.json', '--today', '2026-05-04'], {
      GITHUB_STEP_SUMMARY: summary,
    });
    assert.match(md, /None \(`does\/not\/exist\.json`\)/);
  });
});
