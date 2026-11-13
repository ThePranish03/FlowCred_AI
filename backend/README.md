# FlowCred AI

Production preparation for the existing FlowCred AI application. The React interface and the three trained model artifacts are retained; the backend provides the `/api/v1` authentication, invoice, customer, upload, and inference APIs.

## Architecture and stack

- Existing React 18 + TypeScript + Vite frontend, served by Nginx in Compose.
- FastAPI + Pydantic API, SQLAlchemy 2, Alembic, and PostgreSQL 17 in deployment.
- SQLite remains the default for local development and backend unit tests.
- Existing scikit-learn / XGBoost estimators and saved preprocessing objects are loaded from `../models`; no model retraining is performed.
- PostgreSQL stores users, refresh-token state, customers, invoices, prediction history, upload metadata, model registry, and audit events. Uploaded CSV files live in the persistent upload volume.

## Requirements and installation

Use Python 3.14 for the checked-in model helper bytecode and tested model artifact compatibility. Use Node 22 for the frontend. From the repository root:

```powershell
py -3.14 -m venv backend/.venv
backend/.venv/Scripts/Activate.ps1
python -m pip install -r backend/requirements.txt
Copy-Item backend/.env.example backend/.env
```

For local SQLite, set `DATABASE_URL=sqlite:///./flowcred.db` in `backend/.env`. In one terminal run `python -m alembic -c backend/alembic.ini upgrade head`, then `python -m uvicorn app.main:app --app-dir backend --reload --port 8000`. In another terminal run `npm ci` and `npm run dev` from `frontend`. The frontend remains unchanged; set `VITE_API_MODE=live` and `VITE_API_BASE_URL=http://localhost:8000/api/v1` in its local environment. API docs are at `/docs`; health is `/api/v1/health`.

## Environment variables

`backend/.env.example` lists the supported settings. Important values:

| Variable | Purpose |
| --- | --- |
| `APP_ENV` | `development` or `production`; production requires a configured JWT secret and Alembic-managed schema. |
| `DATABASE_URL` | SQLAlchemy URL; SQLite locally, `postgresql+psycopg://...` in deployment. |
| `JWT_SECRET_KEY` | Long random secret; do not commit or reuse the example value. |
| `JWT_ALGORITHM` | JWT signing algorithm (HS256 by default). |
| `ACCESS_TOKEN_EXPIRE_MINUTES`, `REFRESH_TOKEN_EXPIRE_DAYS` | Token lifetimes. |
| `BOOTSTRAP_ADMIN_EMAIL` | Email allowed to claim the initial admin role during registration. |
| `MODEL_DIR`, `DATA_DIR` | Existing model artifacts and persistent upload storage. |
| `CORS_ORIGINS` | Comma-separated allowed browser origins. |
| `DB_POOL_SIZE`, `DB_MAX_OVERFLOW`, `DB_POOL_TIMEOUT` | SQLAlchemy PostgreSQL pool settings. |
| `POSTGRES_PASSWORD`, `FRONTEND_PORT` | Compose database password and published frontend port. |

## PostgreSQL

Install PostgreSQL 17 locally or use the Compose service. Set a PostgreSQL `DATABASE_URL`, then run `python -m alembic -c backend/alembic.ini upgrade head`. The API verifies a database connection at startup and reports its status at `/api/v1/health`. Alembic revisions create the schema and add invoice payment terms and integrity constraints. Compose runs `alembic upgrade head` before Uvicorn; rollback behavior should be validated separately before production use.

## Docker deployment

Create `backend/.env` from the example and set unique secrets. Generate `JWT_SECRET_KEY` with a cryptographically secure random generator; choose an alphanumeric `POSTGRES_PASSWORD` for the current Compose URL form. Start from the project root:

```powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml up --build -d
docker compose --env-file backend/.env -f backend/docker-compose.yml ps
docker compose --env-file backend/.env -f backend/docker-compose.yml logs api
```

The stack includes the API, frontend, and PostgreSQL. PostgreSQL and uploaded files use named persistent volumes. The API runs Alembic before Uvicorn; Compose waits for PostgreSQL health before starting it and waits for API health before starting the frontend. All services restart unless stopped. The frontend is at `http://localhost:8080` by default and proxies `/api/` to the backend. A Docker deployment is only verified when all three Compose services report healthy and the API reports PostgreSQL and all model pipelines available.

## API and authentication

Interactive OpenAPI documentation: `/docs`. The backend uses the existing `/api/v1` routes for registration/login, refresh/logout, invoices/customers, CSV upload, risk/delay inference, clustering, and health. Public registrations receive the accountant role; only the configured bootstrap email can claim the initial admin role. Other role assignment is not user-controlled. Passwords use salted PBKDF2-HMAC-SHA256 (310,000 rounds). Access tokens expire after 30 minutes by default. Refresh tokens are stored server-side, rotated on refresh, and prior tokens are revoked. SQLAlchemy bound parameters protect database queries from SQL injection. Role dependencies protect financial endpoints; the API currently has a single shared workspace and no organization-level tenant boundary.

Uploads accept CSV only, cap files at 25 MiB, enforce required columns, date/currency/status/positive-amount checks, reject duplicate IDs (including existing invoice IDs), and persist valid records in the same transaction as upload metadata. Invoice list/detail endpoints read persisted invoices and latest prediction results. Prediction records retain model versions. Failed persistence rolls back and removes the corresponding stored file.

## Models and compatibility

The three existing pipelines are late-payment classification, payment-delay regression, and customer clustering. Health reports availability/error status and model versions from the saved metadata. Inference uses the original serialized estimators and preprocessing transforms.

The source for `feature_engineering_utils` was recovered from the project's retained CPython 3.14 cache bytecode, not reimplemented. The original bytecode is preserved as `backend/vendor/feature_engineering_utils.cpython-314.pyc`; `backend/feature_engineering_utils.py` loads that exact vendor path. In Docker it is copied to `/srv/flowcred/vendor`, away from the wrapper's own `__pycache__`, so importing the wrapper cannot select and execute its own cache recursively. The loader verifies the CPython bytecode magic before execution and fails explicitly if the matching artifact is missing or incompatible. Its runtime compatibility requirement is CPython 3.14, and the model artifacts also require the dependency versions pinned in `requirements.txt`. Startup marks each model ready only after loading its saved estimator and preprocessing artifacts and successfully exercising the original inference path. Do not delete or regenerate this compatibility module or its bytecode without reproducing the exact class used by the pickle files.

## Security review and known limitations

- JWT expiry, refresh rotation, salted password hashing, role checks, upload limits, SQL parameterization, and audit events for authentication-sensitive mutations and predictions are implemented.
- CORS is origin allow-listed by `CORS_ORIGINS`; Compose uses the frontend origin. Configure HTTPS and the real production origin at the reverse proxy.
- There is no application rate limiter yet. Add a shared proxy/API rate limit before exposing authentication and upload routes to the public internet.
- Audit events currently cover key mutations and predictions, not every read. Consider retention, export, and tamper-resistant audit storage for regulated operation.
- Role authorization applies across the shared workspace; per-company/customer row-level tenancy is not implemented.
- Cash-inflow forecasting remains unavailable because no verified model artifact exists. Static dashboard summary/source snapshot endpoints may not reflect newly uploaded data; invoice/customer lists and prediction histories use persisted data.
- PostgreSQL, Compose container startup, and full browser-to-database E2E have not yet been confirmed in this machine. See the final execution report before treating deployment as accepted.

## Verification

Run the artifact parity checks and automated backend suite:

```powershell
python backend/verify_artifacts.py
python -m pytest backend/tests
```

For PostgreSQL acceptance, run migrations against a disposable PostgreSQL database, insert and read invoices/predictions, force a transaction failure and verify rollback, then verify successful recovery. For full acceptance, start Compose, wait for every health check, register/login, upload a valid and invalid CSV, retrieve persisted invoice rows, run both invoice predictions and customer clustering, inspect history, refresh once, reuse the old refresh token, and verify anonymous/role-denied requests return 401/403.
