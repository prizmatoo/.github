# prizmatoo/.github

Org-wide shared CI for Beyond the Wall Logistics (BTWL): reusable GitHub Actions workflows, the
default pull request template, the CODEOWNERS template and the small Node scripts the checks run.

- **Owners:** Cei (`@cei-prizmato`, Platform, lead), Gehana (`@gehna-prizmato`, QA, backup)
- **Jira:** project `BTWL`, component `btwl-shared-ci`
- **Confluence:** space `BTWL`, section ENG (Engineering Handbook), page "Engineering standards v1"

## Run it locally

Node 22 (`.nvmrc`) and the pnpm version pinned in `package.json` (`packageManager`), through
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

`service-catalog.yaml` has one entry per repository in the org: what it is, the owning squad,
primary (Jira component lead) and backup (reviewer) as GitHub logins, the Jira component, the
Confluence page that describes it, the language and the path globs that belong to the component.
The ENG page "Service catalog" is the prose version of the same list.

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
```

`make test` validates it: required fields, known squads, owners are org members and not the same
person twice, components are `btwl-<repo>` (`btwl-shared-ci` for this repo), and this repo's
`CODEOWNERS` matches its own entry. A new repo gets its entry in the PR that creates it.

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

**Repo owner checklist** (from the pnpm vs npm spike, BTWL-38):

- [ ] `"packageManager": "pnpm@9.15.4"` in `package.json`, and `pnpm-lock.yaml` committed
- [ ] `make setup` is `pnpm install --frozen-lockfile`
- [ ] `.nvmrc` contains `22`
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
```
