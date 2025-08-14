# ci-python sample

A small Python 3.12 project that `.github/workflows/ci-python-sample.yml` runs through
`ci-python.yml` on every pull request in this repository, so a change to the Python CI is tested
before any Python repo picks it up from `main`.

```bash
make setup   # uv sync --frozen
make ci      # ruff, mypy, pytest (reports/junit.xml, coverage.json), uv build
```
