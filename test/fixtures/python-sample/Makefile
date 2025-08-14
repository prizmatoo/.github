# Same gate targets as every BTWL repo (Engineering standards §2).
.PHONY: setup lint typecheck test build ci

setup:
	uv sync --frozen

lint:
	uv run ruff check .
	uv run ruff format --check .

typecheck:
	uv run mypy src tests

test:
	uv run pytest

build:
	uv build --quiet

ci:
	@test -d .venv || uv sync --frozen
	$(MAKE) lint typecheck test build
