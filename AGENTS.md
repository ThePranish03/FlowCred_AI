# AGENTS.md — FlowCred AI

Accounts-receivable risk app: React SPA (`frontend/`) + FastAPI (`backend/`) + SQLite/Postgres, serving four pre-trained ML artifacts from `models/` (three invoice-scoped models plus an aggregate cash-flow forecaster). Inference only — nothing retrains at runtime.

## Hard constraints (models break if violated)

- **CPython 3.14 only.** `backend/feature_engineering_utils.py` is a loader (not the real source) that imports `backend/vendor/feature_engineering_utils.cpython-314.pyc` after checking bytecode magic. The pickled artifacts reference that class. On this machine `python` is 3.12 → use `python3` (3.14.7) or `backend/.venv/bin/python`.
- Never delete, regenerate, or "clean up" `models/*.joblib`, `models/*_metadata.json`, `data/processed/*.csv`, or `backend/vendor/*.pyc`. Keep `backend/requirements.txt` pins (sklearn/feature-engine/xgboost) or artifacts fail to load.
- Fixing model code means editing `backend/app/ml.py` / `backend/app/main.py`, not the wrapper or bytecode.

## Commands (run from repo root)

```bash
python3 -m venv backend/.venv && backend/.venv/bin/pip install -r backend/requirements.txt
cp backend/.env.example backend/.env

python3 -m alembic -c backend/alembic.ini upgrade head
python3 -m uvicorn app.main:app --app-dir backend --reload --port 8000

python3 -m pytest backend/tests          # conftest puts backend/ on sys.path
python3 backend/verify_artifacts.py      # saved-artifact parity check

cd frontend && npm ci && npm run dev     # 5173
npm run build                            # = tsc --noEmit && vite build
```

- `npm run lint` runs `eslint .` but no ESLint dependency or config is checked in — it does not work. Type-check via `npm run build`.
- No CI, formatter, or pre-commit hooks; the test suite is the only automated gate.
- Compose (file lives in `backend/`, context is repo root): `docker compose --env-file backend/.env -f backend/docker-compose.yml up --build -d`. Never `down -v` (named volumes hold Postgres + uploads).

### Model 4 (cash-flow forecasting) pipeline

```bash
backend/.venv/bin/python backend/scripts/build_cash_flow_dataset.py   # target -> daily/weekly CSVs
backend/.venv/bin/python backend/scripts/train_cash_flow_models.py     # backtest + artifacts + metrics
backend/.venv/bin/python backend/scripts/make_cashflow_plots.py        # report figures
backend/.venv/bin/python backend/scripts/export_cashflow_demo.py       # frontend demo fixture
```

Retraining rewrites `data/processed/cash_flow_*.csv`, `reports/cash_flow/*` and the three Model 4 files in `models/`. It never touches the other artifacts. The cross-validation contract lives in `reports/cash_flow/DECISIONS.md` and must be respected when re-running.

## Config quirks

- Env always lives in `backend/.env` regardless of cwd (`load_dotenv` in `app/database.py` and `app/main.py`; Compose uses `--env-file`). Restart after edits.
- `APP_ENV=production` rejects `JWT_SECRET_KEY` under 32 chars or the example values (`app/auth.py`).
- Development startup runs `Base.metadata.create_all` **and** seeds the DB from `data/processed/flowcred_cleaned.csv` when the invoice table is empty. Production relies only on Alembic, so any schema change needs `db_models.py` + a new revision in `backend/migrations/versions/` (0001, 0002 exist).
- `/api/v1/health` returns 503 unless the DB and all three model pipelines load. Don't relax it to make a test or deploy pass.

## Architecture notes

- `backend/app/main.py` (~670 lines) is the entire API: auth, invoices/customers, upload, predictions, health. `ml.py` holds feature building + inference.
- Not everything is DB-backed: `dashboard/summary`, `payment-risk/summary`, `delay-predictions/summary`, `models/metrics`, `insights`, `datasets*`, `customers/segments` serve static JSON from `frontend/public/demo-data/`. Changing those numbers means editing the JSON or regenerating with `cd frontend && python3 scripts/generate-demo-data.py`. Invoice/customer lists and prediction history come from SQL.
- Roles: `admin`, `business_owner`, `accountant`, `collections`, enforced per route with `allow_roles(...)`, not a global middleware. Public registration always creates `accountant` (`RegisterInput.role` is ignored); the first user matching `BOOTSTRAP_ADMIN_EMAIL` gets `admin`. Single shared workspace — no tenant isolation.
- Late-payment bands are hardcoded in `app/ml.py`/`main.py` (<0.3 Low, <0.7 Medium) and the operational threshold (0.45) comes from metadata. The classifier deliberately uses the raw 19 engineered columns, not the saved `*_feature_pipeline.joblib` scaler — that artifact degrades held-out metrics, so don't "fix" it.
- Prediction payloads are camelCase: `{invoice: {amount, currency (USD|CAD only), invoiceDate, dueDate, paymentTerms}, customerHistory: {...}}`. CSV upload is the opposite: snake_case required columns, 25 MiB cap, USD/CAD only, statuses `paid|open|overdue`, duplicate IDs (in-file or already in DB) rejected.
- Currency is mixed USD+CAD with no FX; aggregates are nominal.
- **Model 4** adds cash-flow forecasting without changing `MODEL_IDS`. It has its own loader (`load_forecast_models`), its own status map (`FORECAST_STATUS`) and its own health route (`/api/v1/cash-flow/health`); a missing forecast artifact must never make `/api/v1/health` return 503. Forecasts are served from a frozen `replay` grid inside the artifact, so serving never retrains and the same `asOf` is reproducible. Weekly is the modelled frequency; daily values are derived estimates from currency-specific weekday shares and must always carry `isEstimate`. The target is an invoice-clearance **proxy** — do not describe it as verified cash. Persistence uses `cash_flow_forecast_runs` / `cash_flow_forecast_points` (migration 0006), never the invoice-scoped `Prediction` table.

## Frontend

- API mode is build-time: `VITE_API_MODE` defaults to `demo` (fixtures via `src/api/demo.ts`, any 6-char password, no backend); set `live` plus `VITE_API_BASE_URL` for real JWT auth. Env changes require a rebuild.
- Swap point is `src/api/index.ts`; axios + refresh-token retry in `src/api/client.ts`; role lists for nav and route guards in `src/lib/constants.ts` (keep the two in sync).
- `frontend/README.md` is partially stale (calls upload/auth "pending", says Node 18). Trust the code and root `README.md`; the Docker build uses `node:22-alpine`.

## Don't touch to "improve"

`reports/`, `architectures/`, `documents/`, `notebooks/` are recorded evidence/mockups; changing them does not change behavior and rewrites the project's documented history.
