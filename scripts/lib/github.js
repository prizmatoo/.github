// Read-only GitHub REST calls the checks need. Nothing here writes to GitHub.

/**
 * @typedef {{ event: string, actor?: { login: string } | null, label?: { name: string } }} IssueEvent
 * @typedef {(url: string, init?: { headers?: Record<string, string> }) => Promise<{ ok: boolean, status: number, json: () => Promise<any> }>} Fetch
 */

/**
 * Login of whoever applied `label` to the issue or PR most recently, or undefined.
 * @param {{ fetch: Fetch, apiUrl: string, repo: string, number: string | number, token: string, label: string }} args
 * @returns {Promise<string | undefined>}
 */
export async function labelActor({ fetch, apiUrl, repo, number, token, label }) {
  const headers = {
    accept: 'application/vnd.github+json',
    authorization: `Bearer ${token}`,
    'x-github-api-version': '2022-11-28',
  };
  /** @type {string | undefined} */
  let actor;
  for (let page = 1; ; page++) {
    const url = `${apiUrl}/repos/${repo}/issues/${number}/events?per_page=100&page=${page}`;
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET ${url} failed with ${res.status}`);
    /** @type {IssueEvent[]} */
    const events = await res.json();
    for (const e of events) {
      if (e.event === 'labeled' && e.label?.name === label) actor = e.actor?.login;
    }
    if (events.length < 100) return actor;
  }
}
