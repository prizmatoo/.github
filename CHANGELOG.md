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
