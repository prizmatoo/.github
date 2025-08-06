import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { importReports, keyProblem, main, parseArgs, XRAY_URL } from '../scripts/xray-import.js';

const JUNIT =
  '<testsuites><testsuite name="s"><testcase classname="test/a.test.ts" name="x"/></testsuite></testsuites>';

/**
 * A fake fetch that records requests and answers like Xray Cloud.
 * @param {{ execution?: string, status?: number }} [answer]
 */
function fakeXray(answer = {}) {
  /** @type {{ url: string, headers: Record<string, string>, body: string }[]} */
  const calls = [];
  /** @type {import('../scripts/xray-import.js').Fetch} */
  const fetchFn = async (url, init) => {
    calls.push({ url, headers: init.headers, body: init.body });
    if (url.endsWith('/api/v2/authenticate')) {
      return { ok: true, status: 200, text: async () => '"token-1"' };
    }
    const status = answer.status ?? 200;
    const key = answer.execution ?? new URL(url).searchParams.get('testExecKey');
    return { ok: status < 300, status, text: async () => JSON.stringify({ id: '10421', key }) };
  };
  return { calls, fetchFn };
}

/** @param {Record<string, string>} files */
const reader = (files) => (/** @type {string} */ f) => files[f];

const opts = { clientId: 'id', clientSecret: 'secret' };

describe('xray-import.js', () => {
  it('reads --execution and the report files', () => {
    assert.deepEqual(
      parseArgs(['--execution', 'BTWLQA-71', 'reports/junit.xml', 'reports/b.xml']),
      {
        execution: 'BTWLQA-71',
        files: ['reports/junit.xml', 'reports/b.xml'],
      },
    );
  });

  it('accepts only a Jira issue key as the execution', () => {
    assert.equal(keyProblem('BTWLQA-71'), undefined);
    assert.match(String(keyProblem(undefined)), /no test execution key/);
    assert.match(String(keyProblem('btwlqa-71')), /not a Jira issue key/);
    assert.match(String(keyProblem('BTWLQA-')), /not a Jira issue key/);
  });

  it('imports each report into the given execution, with one token', async () => {
    const xray = fakeXray();
    const done = await importReports({
      ...opts,
      execution: 'BTWLQA-71',
      files: ['reports/a.xml', 'reports/b.xml'],
      fetchFn: xray.fetchFn,
      read: reader({ 'reports/a.xml': JUNIT, 'reports/b.xml': JUNIT }),
    });
    assert.deepEqual(done, [
      { file: 'reports/a.xml', key: 'BTWLQA-71' },
      { file: 'reports/b.xml', key: 'BTWLQA-71' },
    ]);
    assert.deepEqual(
      xray.calls.map((c) => c.url),
      [
        `${XRAY_URL}/api/v2/authenticate`,
        `${XRAY_URL}/api/v2/import/execution/junit?testExecKey=BTWLQA-71`,
        `${XRAY_URL}/api/v2/import/execution/junit?testExecKey=BTWLQA-71`,
      ],
    );
    assert.deepEqual(JSON.parse(xray.calls[0].body), { client_id: 'id', client_secret: 'secret' });
    assert.equal(xray.calls[1].headers.Authorization, 'Bearer token-1');
    assert.equal(xray.calls[1].headers['Content-Type'], 'text/xml');
    assert.equal(xray.calls[1].body, JUNIT);
  });

  it('imports into a new execution of a project when given --project', async () => {
    const xray = fakeXray({ execution: 'BTWLQA-90' });
    const done = await importReports({
      ...opts,
      project: 'BTWLQA',
      files: ['r.xml'],
      fetchFn: xray.fetchFn,
      read: reader({ 'r.xml': JUNIT }),
    });
    assert.deepEqual(done, [{ file: 'r.xml', key: 'BTWLQA-90' }]);
    assert.equal(xray.calls[1].url, `${XRAY_URL}/api/v2/import/execution/junit?projectKey=BTWLQA`);
  });

  it('sends nothing without an execution or a project', async () => {
    const xray = fakeXray();
    await assert.rejects(
      importReports({
        ...opts,
        files: ['r.xml'],
        fetchFn: xray.fetchFn,
        read: reader({ 'r.xml': JUNIT }),
      }),
      /give --execution <key> or --project <key>/,
    );
    assert.equal(xray.calls.length, 0);
  });

  it('sends nothing when a file is not a JUnit report', async () => {
    const xray = fakeXray();
    await assert.rejects(
      importReports({
        ...opts,
        execution: 'BTWLQA-71',
        files: ['r.xml', 'coverage.json'],
        fetchFn: xray.fetchFn,
        read: reader({ 'r.xml': JUNIT, 'coverage.json': '{}' }),
      }),
      /coverage\.json is not a JUnit report/,
    );
    assert.equal(xray.calls.length, 0);
  });

  it('fails when Xray puts the results into another execution', async () => {
    const xray = fakeXray({ execution: 'BTWLQA-90' });
    await assert.rejects(
      importReports({
        ...opts,
        execution: 'BTWLQA-71',
        files: ['r.xml'],
        fetchFn: xray.fetchFn,
        read: reader({ 'r.xml': JUNIT }),
      }),
      /into BTWLQA-90, not BTWLQA-71/,
    );
  });

  it('fails on an error answer and names the status', async () => {
    const xray = fakeXray({ status: 400 });
    await assert.rejects(
      importReports({
        ...opts,
        execution: 'BTWLQA-71',
        files: ['r.xml'],
        fetchFn: xray.fetchFn,
        read: reader({ 'r.xml': JUNIT }),
      }),
      /Xray answered 400 for .*\/import\/execution\/junit:/,
    );
  });

  it('fails without the Xray API key pair', async () => {
    await assert.rejects(
      importReports({
        execution: 'BTWLQA-71',
        files: ['r.xml'],
        clientId: '',
        clientSecret: '',
        read: reader({ 'r.xml': JUNIT }),
      }),
      /XRAY_CLIENT_ID and XRAY_CLIENT_SECRET/,
    );
  });

  it('reports failures as an xray annotation and exits 1', async () => {
    const lines = /** @type {string[]} */ ([]);
    const orig = console.log;
    console.log = (/** @type {unknown[]} */ ...args) => void lines.push(args.join(' '));
    try {
      assert.equal(await main(['reports/junit.xml'], {}), 1);
    } finally {
      console.log = orig;
    }
    assert.match(
      lines.join('\n'),
      /^::error title=xray::give --execution <key> or --project <key>/m,
    );
  });
});
