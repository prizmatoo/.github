# Gate targets, same names as every BTWL repo (Engineering standards v1).
# This repo is plain JavaScript (ESM) and YAML: nothing is bundled, the workflows run the scripts from source.
.PHONY: setup lint typecheck test build ci

setup:
	pnpm install --frozen-lockfile

lint:
	pnpm exec prettier --check '**/*.{yml,yaml,md,js}'

# JSDoc-typed JS, checked by tsc (checkJs) without emitting anything.
typecheck:
	pnpm exec tsc --noEmit -p tsconfig.json

test:
	@mkdir -p reports
	node --test \
	  --test-reporter=spec --test-reporter-destination=stdout \
	  --test-reporter=junit --test-reporter-destination=reports/junit.xml \
	  'test/*.test.js'

build:
	@echo "build: nothing to build, workflows and scripts run from source"

ci:
	@test -d node_modules || pnpm install --frozen-lockfile
	$(MAKE) lint typecheck test build
