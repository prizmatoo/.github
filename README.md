# prizmatoo/.github

Org-wide shared CI for Beyond the Wall Logistics (BTWL): reusable GitHub Actions workflows, the
default pull request template, the CODEOWNERS template and the small Node scripts the checks run.

- **Owners:** Cei (`@cei-prizmato`, Platform, lead), Gehana (`@gehna-prizmato`, QA, backup)
- **Jira:** project `BTWL`, component `btwl-shared-ci`
- **Confluence:** space `BTWL`, section ENG (Engineering Handbook), page "Engineering standards v1"

## Run it locally

Node 22.22.0 (`.nvmrc`) and the pnpm version pinned in `package.json` (`packageManager`), through
corepack. A global pnpm of another major fails `make setup` on the lockfile.

```bash
corepack enable # once per machine: provides pnpm 9.15.4 from packageManager
make setup      # pnpm install --frozen-lockfile
make ci         # lint, typecheck, test, build
```

| target           | what it does                                                  |
| ---------------- | ------------------------------------------------------------- |
| `make lint`      | `prettier --check` on YAML, Markdown and JS                   |
| `make typecheck` | `tsc --noEmit` with `checkJs` over `scripts/` and `test/`     |
| `make test`      | `node --test`; JUnit XML to `reports/junit.xml`               |
| `make catalog`   | `service-catalog.yaml` against `service-catalog.schema.json`  |
| `make build`     | nothing to build: the workflows run the scripts from source   |
| `make ci`        | installs if `node_modules/` is missing, then all of the above |

`make ci` does not run the Python sample (`test/fixtures/python-sample`); the `ci-python-sample`
workflow does that on every PR. To run it yourself you need uv and Python 3.12
(`uv python install 3.12`): `make -C test/fixtures/python-sample setup ci`.

**Running a script by hand.** In Actions the workflows set these from the event; locally, copy
`.env.example` to `.env` and export what the script needs. `make test` reads none of them.

| variable                               | read by              | what                                                  |
| -------------------------------------- | -------------------- | ----------------------------------------------------- |
| `PR_BRANCH`, `PR_TITLE`, `PR_BODY`     | `pr-check.js`        | the PR's branch, title and body                       |
| `PR_BODY`, `PR_LABELS`                 | `regression-test.js` | body and labels (JSON array of names)                 |
| `PR_NUMBER`, `PR_AUTHOR`               | `regression-test.js` | only with `no-regression-test`: who added the label   |
| `GITHUB_REPOSITORY`, `GITHUB_TOKEN`    | `regression-test.js` | `prizmatoo/<repo>` and a token that can read the PR   |
| `XRAY_CLIENT_ID`, `XRAY_CLIENT_SECRET` | `xray-import.js`     | your Xray Cloud API key pair                          |
| `GITHUB_OUTPUT`                        | `tag-version.js`     | set by Actions; unset locally, the version is printed |

## Pull request template

`.github/PULL_REQUEST_TEMPLATE.md` is the org default: every repo without its own template gets it.
Replace `BTWL-<n>` in the Jira link with your issue key and tick one PR type. Do not reformat the
file (it is in `.prettierignore`); the checks below read its checkboxes and the Jira link.

## CODEOWNERS template

`CODEOWNERS.template` has one default line per squad: component lead first, backup second
(ownership matrix in the ENG handbook). Copy it to `CODEOWNERS` in the repo root, keep your
squad's line, add finer rules below it.

## Service catalog

`service-catalog.yaml` (version 2) has one entry per repository in the org: what it is, the owning
squad, primary (Jira component lead) and backup (reviewer) as GitHub logins, the Jira component,
the Confluence page that describes it, the language, the path globs that belong to the component,
and what it produces and consumes. The ENG page "Service catalog v2" is the prose version of the
same list.

```yaml
- name: btwl-order-service
  description: Customer orders, order lines and quotes via @btwl/pricing
  owner_team: Order-to-Cash
  primary: venkat-prizmato
  backup: krunal-prizmato
  jira_component: btwl-order-service
  confluence_space: BTWL
  confluence_page: Service catalog
  language: TypeScript (Fastify, Vitest)
  paths: [src/**, test/**, openapi.yaml, docs/adr/**]
  produces:
    - { kind: api, name: btwl-order-service, spec: openapi.yaml }
    - kind: event
      name: order.shipped.v1
      event: OrderShipped
      version: 1
      contract: contracts/events/OrderShipped.v1.schema.json
  consumes:
    - { kind: library, name: '@btwl/pricing' }
    - { kind: api, name: btwl-inventory-service }
```

**produces and consumes.** Each item has a `kind` (`api`, `event`, `file`, `library`, `workflow`)
and a `name` that is unique in the catalog: an API is named after its repo, a library after its
package, an event after its topic (`<entity>.<event>.v<major>`, ADR-005 in btwl-order-service)
with `event`, `version` and the `contract` file in the producing repo, a file or a workflow after
what its readers call it (`finance-export`, `route-approval.yml`). An event behind a feature flag
names it (`flag`). A repo consumes by that same name; a consumed event names the consumer group
(`group`), and `since` says from which version of the consumer. Systems outside the org
(Ledgerline, TollGate, Hearth, ...) are consumed as `kind: external`; a file read outside the org
names its readers (`to`). A produced item that passes on data from something its repo consumes
says so with `from`: billing's `finance-export` is built `from: [order.shipped.v1]` (one row per
shipped order, keyed by `order_id`). Billing's own API is not: billing absorbs an event change in
its consumer and its API stays as it was.

Two checks run in `make ci`, so `ci.yml` runs them on every PR here. `make catalog`
(`scripts/catalog-check.js`) checks the file against `service-catalog.schema.json` (JSON Schema
2020-12): required fields, known squads, GitHub logins, `btwl-*` components, the shape of every
produced and consumed item (a produced event needs its contract, a consumed one its group), no
unknown fields. Each problem is an error annotation on the catalog line it is about and starts
with the repo's name:

```text
::error file=service-catalog.yaml,line=145,title=catalog::btwl-billing-service: missing owner_team
```

`make test` checks what a schema cannot: owners are org members and not the same person twice,
components are `btwl-<repo>` (`btwl-shared-ci` for this repo), this repo's `CODEOWNERS` matches its
own entry, every repo of the org has an entry, every consumed item is produced by another entry,
and `from` names something the repo consumes. A new repo gets its entry in the PR that creates it;
a new consumer adds its `consumes` line in the PR that starts consuming. A new field goes into the
schema in the same PR.

**Blast radius.** Before changing a contract, ask the catalog who is downstream:

```bash
make setup
node scripts/blast-radius.js OrderShipped          # every major of the event
node scripts/blast-radius.js order.shipped.v1      # one topic, API, file or library by name
node scripts/blast-radius.js @btwl/pricing --json
```

It lists the consumers of each topic with their squad, lead, backup and consumer group, says "no
consumers yet" for a topic nobody reads, follows a consumer further only through what it produces
`from` the item, and ends with the repos, items, teams and outside systems to involve:

```text
OrderShipped, produced by btwl-order-service:
  order.shipped.v1
    btwl-billing-service (Order-to-Cash; krunal-prizmato, backup venkat-prizmato), consumer group btwl-billing-service
      passes it on in finance-export (file), read by Ledgerline
    btwl-inventory-service (Warehouse Systems; sathwik-prizmato, backup aaquib-prizmato), consumer group btwl-inventory-service, since 2.0.0
  order.shipped.v2 (behind orders.events.v2, from 1.5.0)
    no consumers yet

Blast radius: btwl-billing-service, btwl-inventory-service, finance-export
Teams to involve: Order-to-Cash, Warehouse Systems
Outside the org: Ledgerline
```

It runs here only (it reads the YAML with this repo's dependencies); nothing in the workflows calls
it.

## Workflows

All workflows here are reusable (`on: workflow_call`). Repos call them with `@main`; there is
nothing to copy. Every workflow keeps `GITHUB_TOKEN` read-only and reports through checks only.

### `ci-node.yml`

CI for the TypeScript repos. Steps: checkout, pnpm (`pnpm/action-setup` reads `packageManager`
from `package.json`), Node from `.nvmrc`, pnpm store cache, `make setup`, `make ci`, coverage
floor, then the coverage directory is uploaded as the artifact `coverage-<repo>-<sha>`.

The pnpm store is cached with `actions/cache`, keyed on the OS and the hash of `pnpm-lock.yaml`,
falling back to the newest store for the OS. In the BTWL-38 spike this took installs from 94s
(cold) to 21s (warm). A lockfile change misses the exact key once; the next run is warm again.
A cache download that stalls is given up after 2 minutes (`SEGMENT_DOWNLOAD_TIMEOUT_MINS`) and the
install runs cold; with the default of 10 minutes about one run in ten looked hung in "Cache pnpm
store" (BTWL-347). ci-python's uv cache has the same limit.

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  ci:
    uses: prizmatoo/.github/.github/workflows/ci-node.yml@main
```

| input               | default                          | meaning                                              |
| ------------------- | -------------------------------- | ---------------------------------------------------- |
| `working-directory` | `.`                              | where `package.json`, `.nvmrc` and the Makefile live |
| `coverage-path`     | `coverage`                       | coverage output uploaded as an artifact              |
| `coverage-summary`  | `coverage/coverage-summary.json` | summary the coverage floor reads                     |
| `coverage-floor`    | `80`                             | minimum total line coverage, percent                 |
| `junit-path`        | `reports/junit.xml`              | JUnit XML uploaded for the Xray import               |
| `quarantine-file`   | `test/quarantine.json`           | tests CI skips while their fix waits (see below)     |

**JUnit results.** `make test` writes `reports/junit.xml` in every repo. `ci-node.yml` uploads it
as the artifact `junit-<repo>-<sha>` (e.g. `junit-btwl-order-service-3f9c2a4…`), which is what the
Xray import picks up, and keeps it 30 days. The upload also runs when `make ci` fails, since the
failing runs are the ones QA needs. If `make ci` passes but the file is missing, the job fails.
`ci-python.yml` does the same.

**Xray import.** `xray-import.yml` (below) sends this artifact to the release's Test Execution
in Xray; a repo adds it as a second job.

**Coverage floor.** After `make ci`, `scripts/coverage-floor.js` reads the coverage summary and
fails the job when total line coverage is below the floor, printing the per-file summary (lowest
first). Vitest and Jest need the `json-summary` reporter for that file:

```ts
// vitest.config.ts
test: { coverage: { provider: 'v8', reporter: ['text', 'json-summary', 'lcov'] } }
// jest.config.js
coverageReporters: ['text', 'json-summary', 'lcov']
```

A missing summary fails the job too. A repo with no tests yet sets `coverage-floor: 0`, which
turns the check off visibly in its `ci.yml` instead of passing silently. The comparison uses the
unrounded percentage: 79.95% fails.

Generated code (OpenAPI clients and the like) should not count: exclude it in the repo's test
config (`coverage.exclude` in Vitest, `coveragePathIgnorePatterns` in Jest), not by lowering the
floor.

**Coverage in the job summary (BTWL-424).** The same step writes a coverage table to the run's
job summary (the `make ci` check's summary page): line coverage of this build, of main, the
change and the floor, then the files whose coverage moved, the largest drop first, and the files
main does not have yet (marked `new`). Main builds keep their coverage summary in the Actions cache
(`coverage-main-<directory>-<sha>`); a PR build restores the one of its base commit, or the newest
main one, and passes it as `--base`. The summary names the main commit it compared with and says
when that is not the PR's base (the change then includes what merged in between). Nothing is
posted on the PR (no bot output on BTWL repos): open the check's details to read it. The cache
never fails a build; without a main summary the change column stays empty. The floor is
unchanged.

**Quarantined tests in the job summary (BTWL-430).** A test that fails for a reason outside the
code under test (the real clock, a time window) can be skipped in CI while its fix waits. The repo
lists it in `test/quarantine.json` (`tests/quarantine.json` in Python repos) with its Jira bug:

```json
{
  "tests": [
    {
      "name": "quote expires at end of day",
      "file": "test/quote/expiry.test.ts",
      "issue": "BTWL-402",
      "since": "2026-03-18",
      "skipInCiBetweenUtc": ["23:00", "00:30"],
      "why": "uses the real clock: fails when the quote and the check fall on two UTC days"
    }
  ]
}
```

After `make ci`, `scripts/quarantine-summary.js` writes a "Quarantined tests" table to the job
summary: each test with its Jira link, the days since it was quarantined, the CI window it is
skipped in, and whether this build ran it (passed, failed) or skipped it, read from the JUnit
report. A repo without the file shows "None". The step only reports: it never fails the build, and
a list it cannot read becomes a warning. Skipping the test is still the repo's own test helper
(btwl-order-service `test/support/quarantine.ts`); remove the entry in the PR that fixes the test.

**Repo owner checklist** (from the pnpm vs npm spike, BTWL-38):

- [ ] `"packageManager": "pnpm@9.15.4"` in `package.json`, and `pnpm-lock.yaml` committed
- [ ] `make setup` is `pnpm install --frozen-lockfile`
- [ ] `.nvmrc` contains the org's Node pin, `22.22.0` today (the same in every repo, so CI and
      laptops run one Node; Platform moves all repos together)
- [ ] Makefile has `setup lint typecheck test build ci`; `make ci` passes locally in under 3 minutes
- [ ] `.github/workflows/ci.yml` calls `ci-node.yml@main` as above

### `ci-python.yml`

Same shape for the Python repos: checkout, `astral-sh/setup-uv` (with its uv cache), a check that
`pyproject.toml`, `uv.lock` and `.python-version` are there, Python from `.python-version`,
`make setup` (`uv sync --frozen`), `make ci`, the JUnit check, coverage floor. Same inputs as
`ci-node.yml`; `coverage-path` and `coverage-summary` default to `coverage.json`
(`pytest --cov --cov-report=json`). ruff runs with `RUFF_OUTPUT_FORMAT=github`, so its findings
show as annotations on the PR's files.

```yaml
# .github/workflows/ci.yml
name: ci
on:
  push:
    branches: [main]
  pull_request:
permissions:
  contents: read
jobs:
  ci:
    uses: prizmatoo/.github/.github/workflows/ci-python.yml@main
```

The gate targets map to the Python tools like this (`test/fixtures/python-sample` is a working
example, and `ci-python-sample.yml` runs it through this workflow on every PR here):

| target           | Python                                                                      |
| ---------------- | --------------------------------------------------------------------------- |
| `make setup`     | `uv sync --frozen`                                                          |
| `make lint`      | `ruff check .` and `ruff format --check .`                                  |
| `make typecheck` | `mypy` (strict) over `src` and `tests`                                      |
| `make test`      | `pytest --junitxml=reports/junit.xml --cov --cov-report=json:coverage.json` |
| `make build`     | `uv build`                                                                  |

**JUnit ids.** pytest writes `classname` as the test module's dotted path and `name` as the test
function, so the id Xray matches is `<module>.<function>`, for example
`tests.test_pallets.test_a_part_pallet_counts_as_one` (a parametrized case adds `[<id>]`, a
test class adds its name after the module). Keep `junit_family = "xunit2"` in `pyproject.toml`
and give tests names that say what they check: the id is the Generic test definition (QA page
"Test repository conventions").

**Line coverage.** The floor reads `totals.percent_covered` from `coverage.json`. With
`branch = true` coverage.py folds branches into that number, so leave branch measurement off
(the default) or the floor no longer measures lines.

**Repo owner checklist** (Python):

- [ ] `.python-version` contains `3.12`, and `requires-python = ">=3.12,<3.13"` in `pyproject.toml`
- [ ] `uv.lock` committed; `make setup` is `uv sync --frozen`
- [ ] dev tools (ruff, mypy, pytest, pytest-cov) pinned in a `dev` dependency group
- [ ] Makefile has `setup lint typecheck test build ci`; `make ci` passes locally in under 3 minutes
- [ ] `.github/workflows/ci.yml` calls `ci-python.yml@main` as above

### `xray-import.yml`

Imports the JUnit report of a build into a Test Execution in Xray (project BTWLQA), so the
release's execution shows the automated results next to the manual runs (BTWL-197). It runs after
`ci-node.yml` or `ci-python.yml` in the same workflow run, downloads their `junit-<repo>-<sha>`
artifact and sends each file to Xray's JUnit import for that execution
(`scripts/xray-import.js`).

**The execution key is required.** QA creates the Test Execution for a release beforehand (QA page
"Test repository conventions") and gives the repo its key. Without a key, or with something that is
not an issue key, the job fails at its first step, so Xray never creates an execution of its own.
Xray matches each testcase to the Generic test whose definition is its JUnit id (see **JUnit ids**
above); a testcase that has no Generic test yet becomes a new one, so name tests before they reach
`main`.

It is a workflow of its own, not an input of `ci-node.yml` and `ci-python.yml`, so the key can be
required without touching the repos that do not import: their CI is unchanged. The API key pair is
the one of the QA account that owns the execution (the runs show who imported them), kept as repo
or org secrets.

```yaml
# .github/workflows/ci.yml: a main build that imports into the release's execution
jobs:
  ci:
    uses: prizmatoo/.github/.github/workflows/ci-node.yml@main
  xray:
    needs: ci
    if: ${{ !cancelled() && github.ref == 'refs/heads/main' }}
    uses: prizmatoo/.github/.github/workflows/xray-import.yml@main
    with:
      test-execution-key: ${{ vars.XRAY_TEST_EXECUTION }}
    secrets:
      xray-client-id: ${{ secrets.XRAY_CLIENT_ID }}
      xray-client-secret: ${{ secrets.XRAY_CLIENT_SECRET }}
```

`vars.XRAY_TEST_EXECUTION` is a repository variable QA sets to the release's execution and moves
to the next one when it is created; while it is unset the `xray` job fails and says why. The job
runs when `make ci` failed too: failing runs are the ones QA needs.

| input                | default              | meaning                                      |
| -------------------- | -------------------- | -------------------------------------------- |
| `test-execution-key` | (required)           | Test Execution in BTWLQA, e.g. `BTWLQA-123`  |
| `junit-artifact`     | `junit-<repo>-<sha>` | artifact with the JUnit XML                  |
| `shared-ci-ref`      | `main`               | ref of this repo whose `xray-import.js` runs |

**By hand.** The same script imports a report downloaded from a build, for example a release
build's results into the release's execution:

```sh
XRAY_CLIENT_ID=... XRAY_CLIENT_SECRET=... \
  node scripts/xray-import.js --execution BTWLQA-123 junit.xml
```

### `pr-check.yml`

Two jobs, both reported as checks on the PR.

**`traceability`** fails the PR when it does not follow the traceability rules:

| what   | rule                                                                 |
| ------ | -------------------------------------------------------------------- |
| branch | `BTWL-<n>`; `BTWL-<n>-2`, `-3` … for follow-up PRs on the same issue |
| title  | `[BTWL-<n>] <Jira summary>`, same key as the branch                  |
| body   | contains `https://prizmato.atlassian.net/browse/BTWL-<n>` (same key) |

**`regression-test`** makes every bug fix come with a test. A PR is a bug fix when "Bug Fix" or
"Hot Fix" is ticked in the PR template, or it has the `bug` or `hotfix` label. If such a PR changes
anything under `src/` and nothing in a `test/`, `tests/` or `__tests__/` directory, the check fails
with "bug fixes need a regression test".
PRs for stories, tasks and spikes (another type ticked) are skipped. The Jira issue type is not
looked up, because that would need a Jira token in Actions; tick the box.

Some fixes cannot get a sensible test (a config default, a dependency pin). For those a reviewer
applies the **`no-regression-test`** label and the PR body gives the reason on its own line:

```text
No regression test: only the default timeout in config/defaults.ts changes
```

The label counts only when a CODEOWNER of the repo applied it, and not the PR author; the job
reads the PR's label events to check that (read-only). Without a reason of at least a few words,
or with the label applied by the author, the check still fails.

Both jobs report as failing checks only. They never comment or review: no bot output on BTWL
repos. Call the workflow from the repo; it runs again when the title, body or labels change:

```yaml
# .github/workflows/pr.yml
name: pr
on:
  pull_request:
    types: [opened, edited, synchronize, reopened, labeled, unlabeled]
permissions:
  contents: read
  issues: read # who applied no-regression-test
  pull-requests: read
jobs:
  pr-check:
    uses: prizmatoo/.github/.github/workflows/pr-check.yml@main
```

The check scripts live in `scripts/` of this repo; the workflow checks them out next to the
caller's code. `prizmatoo/.github` is private, so if `GITHUB_TOKEN` cannot read it, pass a
read-only token as the `shared-ci-token` secret.

### `gitleaks.yml`

Secrets scan over the commits of the PR (base..head), or of the push. Runs the pinned gitleaks
release binary (input `gitleaks-version`, checked against the release checksums) and fails with an
annotation on each file and line that matches. Findings are redacted in the log.

The repo's own `.gitleaks.toml` is authoritative. A documented fixture that looks like a secret
gets an allowlist entry there, with a comment saying what it is:

```toml
[extend]
useDefault = true

[allowlist]
description = "Documented test fixtures"
# Static test key pair used by the JWT tests; not used anywhere else.
paths = ['''test/fixtures/keys/.*''']
```

Add it next to `pr-check` in the repo's `pr.yml`:

```yaml
gitleaks:
  uses: prizmatoo/.github/.github/workflows/gitleaks.yml@main
```

### `release.yml`

Release build for packages (first user: `@btwl/pricing`). On a `v<semver>` tag it:

1. checks the tag equals `v` + the `version` in `package.json`;
2. runs `make setup` and `make ci`;
3. cuts the `## [<version>]` section of `CHANGELOG.md` into `release-notes.md`;
4. runs `npm pack` and uploads the tarball and `release-notes.md` as the artifact
   `release-<repo>-<version>`.

**It does not publish and does not create the GitHub release.** No bot writes to BTWL repos, so
`GITHUB_TOKEN` stays read-only. The component lead creates the GitHub release from
`release-notes.md` with their own token and attaches the packed tarball to it; consumers vendor
that file (OPS page "Release process"). GitHub Packages is not used: its npm registry only
accepts the org's own scope. The build and the tests still run in CI, so what the lead publishes is
exactly what passed.

**Production approval (BTWL-322).** A release that goes to production (`production: true`, the
default; a library sets `false`) asks approval-router before anything is deployed: once `pack`
passed, the `prod-change` job calls the router's `route-approval.yml` with workflow `prod-change`
and the service and version as attributes, and waits; the `approved` job then puts the request,
who approved and when in the run's job summary, which the release task links. One admin approves
(`approval-router decide AR-<n> approve`, see the runbook "production changes through
approval-router" in btwl-approval-router); a rejection fails the run, and so does no decision
within 240 minutes (the router escalates to `#platform-oncall` after 4 business hours, policy `platform-4h@1`). The chat-thread
approval is retired. The rules are this repo's `.approvals/prod-change.yml`; the router evaluates
its registered copy, so a change to the file goes to both (onboarding page "Approval Router:
onboarding a workflow").

| input / secret                                 | default                          | meaning                                              |
| ---------------------------------------------- | -------------------------------- | ---------------------------------------------------- |
| `production`                                   | `true`                           | ask for `prod-change`; `false` for a library         |
| `router-url`                                   | `https://approvals.btwl.example` | the router                                           |
| `auth-gateway-url`                             | `https://auth.btwl.example`      | issues the repo's service token for the router       |
| `approval-client-id`, `approval-client-secret` | –                                | the repo's service client (`svc:approvals:request`)  |
| `router-token`                                 | `GITHUB_TOKEN`                   | read-only token for the private btwl-approval-router |

```yaml
# .github/workflows/release.yml
name: release
on:
  push:
    tags: ['v*']
permissions:
  contents: read
jobs:
  release:
    uses: prizmatoo/.github/.github/workflows/release.yml@main
    secrets:
      approval-client-id: ${{ secrets.APPROVAL_CLIENT_ID }}
      approval-client-secret: ${{ secrets.APPROVAL_CLIENT_SECRET }}
```
