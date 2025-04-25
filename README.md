# prizmatoo/.github

Org-wide shared CI for Beyond the Wall Logistics (BTWL): reusable GitHub Actions workflows, the
default pull request template, the CODEOWNERS template and the small Node scripts the checks run.

- **Owners:** Cei (`@cei-prizmato`, Platform, lead), Gehana (`@gehna-prizmato`, QA, backup)
- **Jira:** project `BTWL`, component `btwl-shared-ci`
- **Confluence:** space `BTWL`, section ENG (Engineering Handbook), page "Engineering standards v1"

## Run it locally

Node 22 (`.nvmrc`) and pnpm 9 (`packageManager` in `package.json`; `corepack enable` picks it up).

```bash
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

Same shape for the Python repos: checkout, `astral-sh/setup-uv` (with its uv cache), Python from
`.python-version`, `make setup` (`uv sync --frozen`), `make ci`, coverage floor. Same inputs as
`ci-node.yml`; `coverage-path` and `coverage-summary` default to `coverage.json`
(`pytest --cov --cov-report=json`).

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
`GITHUB_TOKEN` stays read-only. The component lead publishes the packed tarball to GitHub
Packages with their own token and creates the GitHub release from `release-notes.md` (OPS page
"Release process v1"). The build and the tests still run in CI, so what the lead publishes is
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
