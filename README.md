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

## Workflows

### `pr-check.yml`

Fails the PR when it does not follow the traceability rules:

| what   | rule                                                                  |
| ------ | --------------------------------------------------------------------- |
| branch | `BTWL-<n>`; `BTWL-<n>-2`, `-3` … for follow-up PRs on the same issue  |
| title  | `[BTWL-<n>] <Jira summary>`, same key as the branch                   |
| body   | contains `https://prizmato.atlassian.net/browse/BTWL-<n>` (same key) |

It reports as a failing check only. It never comments or reviews: no bot output on BTWL repos.
Call it from the repo (runs again when the title or body is edited):

```yaml
# .github/workflows/pr.yml
name: pr
on:
  pull_request:
    types: [opened, edited, synchronize, reopened]
permissions:
  contents: read
jobs:
  pr-check:
    uses: prizmatoo/.github/.github/workflows/pr-check.yml@main
```

The check scripts live in `scripts/` of this repo; the workflow checks them out next to the
caller's code. `prizmatoo/.github` is private, so if `GITHUB_TOKEN` cannot read it, pass a
read-only token as the `shared-ci-token` secret.
