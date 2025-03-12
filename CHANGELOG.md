# Changelog

All notable changes to the shared CI are documented here.
The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Callers use `@main`, so there are no release tags yet; everything lands under Unreleased.

## [Unreleased]

### Added

- Repo scaffold: Makefile gate targets, prettier, `tsc` over the scripts, `node:test` with JUnit output.
- Org pull request template and `CODEOWNERS.template` with a default owner per squad (BTWL-42).
- Reusable `pr-check.yml`: branch, title and Jira link must carry the same `BTWL-<n>` key (BTWL-42).
- Reusable `ci-node.yml` (pnpm from `packageManager`, Node from `.nvmrc`, `make setup` + `make ci`,
  coverage artifact) and its Python counterpart `ci-python.yml` (BTWL-37).
- Reusable `gitleaks.yml`: scans the PR's commits with gitleaks 8.23.1, honours the repo's
  `.gitleaks.toml`, annotates findings on file and line (BTWL-39).
- Coverage floor in `ci-node.yml` and `ci-python.yml`: fails below 80% total line coverage and
  prints the per-file summary (inputs `coverage-floor`, `coverage-summary`) (BTWL-46).
- `regression-test` job in `pr-check.yml`: a bug-fix PR that changes `src/` without touching
  `test/` or `tests/` fails with "bug fixes need a regression test" (BTWL-50).
- pnpm store cache in `ci-node.yml`, keyed on `pnpm-lock.yaml` (BTWL-65).
- Reusable `release.yml`: on a `v*` tag, checks the tag against `package.json`, runs `make ci`,
  `npm pack`s and uploads the tarball with the CHANGELOG section as release notes. It does not
  publish; the component lead publishes with their own token (BTWL-60).
- `service-catalog.yaml` v1: one entry per repo with owner team, primary, backup, Jira
  component, Confluence page, language and path globs; validated in `make test` (BTWL-70).
