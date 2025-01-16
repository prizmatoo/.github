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
