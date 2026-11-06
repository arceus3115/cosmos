.PHONY: setup validate build build-prototype migrate load api dev frontend frontend-build editor package-site

setup:
	python3 -m pip install -e .

validate:
	ra-pipeline validate

build:
	ra-pipeline build --output exports/current

build-prototype:
	ra-pipeline build --include-prototype --output exports/current

migrate:
	@psql "$$PGURL" -v ON_ERROR_STOP=1 -f api/migrations/001_initial.sql

load:
	@ra-pipeline load

api:
	PYTHONPATH=api uvicorn religion_almanac_api.main:app --host 127.0.0.1 --port 8000

dev:
	npm run dev:all

frontend:
	npm run dev

frontend-build:
	npm run build

editor:
	npm run dev:editor

package-site: frontend-build
	python3 tools/package_site.py
