import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { checkPullRequest, linksIssue, main } from '../scripts/pr-check.js';

const ok = {
  branch: 'BTWL-118',
  title: '[BTWL-118] Reject requisitions with zero-quantity lines',
  body: '### What is the Jira issue?\nhttps://prizmato.atlassian.net/browse/BTWL-118\n',
};

describe('checkPullRequest', () => {
  it('accepts a PR that follows the rules', () => {
    assert.deepEqual(checkPullRequest(ok), []);
  });

  it('accepts a follow-up branch BTWL-<n>-2', () => {
    assert.deepEqual(checkPullRequest({ ...ok, branch: 'BTWL-118-2' }), []);
  });

  for (const branch of ['feature/BTWL-118', 'btwl-118', 'BTWL-118-fix', 'BTWL-0', 'main', '']) {
    it(`rejects branch "${branch}"`, () => {
      const problems = checkPullRequest({ ...ok, branch });
      assert.equal(problems.length, 1);
      assert.match(problems[0], /is not a Jira key/);
    });
  }

  it('rejects a title without the [KEY] prefix', () => {
    const problems = checkPullRequest({ ...ok, title: 'Reject zero-quantity lines' });
    assert.deepEqual(problems.length, 1);
    assert.match(problems[0], /title must start with/);
  });

  it('rejects a title with a different key than the branch', () => {
    const problems = checkPullRequest({ ...ok, title: '[BTWL-119] Something else' });
    assert.deepEqual(problems, ['title key BTWL-119 does not match branch key BTWL-118']);
  });

  it('rejects a body without the Jira link', () => {
    const problems = checkPullRequest({ ...ok, body: 'fixes the thing' });
    assert.deepEqual(problems, [
      'body must link the Jira issue: https://prizmato.atlassian.net/browse/BTWL-118',
    ]);
  });

  it('rejects the untouched template placeholder', () => {
    const body = 'https://prizmato.atlassian.net/browse/BTWL-<n>';
    assert.equal(checkPullRequest({ ...ok, body }).length, 1);
  });
});

describe('linksIssue', () => {
  it('does not treat a link to BTWL-42 as a link to BTWL-4', () => {
    assert.equal(linksIssue('https://prizmato.atlassian.net/browse/BTWL-42', 'BTWL-4'), false);
  });

  it('accepts the link followed by punctuation', () => {
    assert.equal(linksIssue('(https://prizmato.atlassian.net/browse/BTWL-4).', 'BTWL-4'), true);
  });
});

describe('main', () => {
  it('returns 0 and prints no error annotation for a good PR', () => {
    const out = captureLog(() =>
      assert.equal(main({ PR_BRANCH: ok.branch, PR_TITLE: ok.title, PR_BODY: ok.body }), 0),
    );
    assert.doesNotMatch(out, /::error/);
  });

  it('returns 1 and prints one annotation per problem', () => {
    const out = captureLog(() => assert.equal(main({}), 1));
    assert.equal(out.match(/::error title=pr-check::/g)?.length, 2);
  });
});

/** @param {() => void} fn */
function captureLog(fn) {
  const lines = /** @type {string[]} */ ([]);
  const orig = console.log;
  console.log = (/** @type {unknown[]} */ ...args) => void lines.push(args.join(' '));
  try {
    fn();
  } finally {
    console.log = orig;
  }
  return lines.join('\n');
}
