# Webhook Relay TypeScript SDK

SWAGGER_SRC ?= ../../rusenask/webhookrelay/frontend/swagger/swagger.yaml

.PHONY: install build typecheck openapi swagger clean publish-dry

install:
	npm install

# swagger copies the latest OpenAPI spec from the webhookrelay repo into this
# package. Point SWAGGER_SRC at your checkout if it lives elsewhere.
swagger:
	cp $(SWAGGER_SRC) swagger/swagger.yaml
	@echo "copied $(SWAGGER_SRC) -> swagger/swagger.yaml"

# openapi regenerates the internal, low-level typed API client from the
# swagger spec into src/generated. Mirrors `make openapi` in the webhookrelay
# repo (which runs swagger-typescript-api for the dashboard). The hand-written
# SDK in src/ is the ergonomic surface; the generated client is the raw
# escape hatch, re-exported from "@webhookrelay/sdk/generated".
openapi: swagger
	npx swagger-typescript-api generate \
		-p ./swagger/swagger.yaml \
		-o ./src/generated \
		-n api.ts \
		--extract-request-params \
		--extract-response-body
	node scripts/postprocess-generated.mjs
	@echo "regenerated src/generated/api.ts"

build:
	npm run build

typecheck:
	npm run typecheck

publish-dry:
	npm publish --dry-run

clean:
	rm -rf dist node_modules
