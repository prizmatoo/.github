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

# Coverage of scripts/ via node's built-in coverage (lcov), held to the same 80% floor as the
# other repos, by the same script ci-node runs.
test:
	@mkdir -p reports coverage
	node --test --experimental-test-coverage --test-coverage-exclude='test/**' \
	  --test-reporter=spec --test-reporter-destination=stdout \
	  --test-reporter=junit --test-reporter-destination=reports/junit.xml \
	  --test-reporter=lcov --test-reporter-destination=coverage/lcov.info \
	  'test/*.test.js'
	node scripts/coverage-floor.js coverage/lcov.info --floor 80

build:
	@echo "build: nothing to build, workflows and scripts run from source"

ci:
	@test -d node_modules || pnpm install --frozen-lockfile
	$(MAKE) lint typecheck test build
