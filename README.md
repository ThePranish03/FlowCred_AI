# 💳 FlowCred AI

<p align="center">
  <strong>Explainable Accounts Receivable Intelligence System</strong><br/>
  Predict late-payment risk · Estimate payment delays · Discover customer payment behaviour
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Python-3.14-3776AB?style=for-the-badge&logo=python&logoColor=white" alt="Python 3.14"/>
  <img src="https://img.shields.io/badge/FastAPI-Backend-009688?style=for-the-badge&logo=fastapi&logoColor=white" alt="FastAPI"/>
  <img src="https://img.shields.io/badge/React-18-61DAFB?style=for-the-badge&logo=react&logoColor=black" alt="React 18"/>
  <img src="https://img.shields.io/badge/PostgreSQL-17-4169E1?style=for-the-badge&logo=postgresql&logoColor=white" alt="PostgreSQL 17"/>
  <img src="https://img.shields.io/badge/Docker-Compose-2496ED?style=for-the-badge&logo=docker&logoColor=white" alt="Docker Compose"/>
</p>

---

## Overview

**FlowCred AI** is an accounts-receivable intelligence application that uses historical invoice and payment information to help businesses understand payment risk and customer behaviour. It combines three trained machine-learning models with a web dashboard, REST API, authentication, database persistence, and CSV ingestion.

| Capability | Business question | Model |
|---|---|---|
| Late-payment classification | How likely is this invoice to be paid late? | XGBoost Classifier |
| Payment-delay regression | How many days early or late might payment occur relative to the due date? | HistGradientBoosting Regressor |
| Customer behaviour clustering | Which payment-behaviour segment does this customer resemble? | K-Means (6 clusters) |

FlowCred AI is a decision-support system. Predictions should be reviewed alongside business context and should not be the sole basis for consequential financial decisions.

## Features

- React dashboard for invoice and customer analytics.
- Late-payment probability, operational risk band, and model threshold.
- Signed payment-delay estimate: negative means early, zero means on time, positive means late.
- Customer behaviour segmentation from the saved six-cluster model.
- Invoice/customer search, filtering, pagination, and detail views.
- JWT authentication, token refresh/rotation, logout, and role-based API authorization.
- CSV validation and persistence of accepted invoice records.
- Prediction history and model metadata.
- PostgreSQL persistence with Alembic migrations.
- Nginx serves the frontend and proxies API requests to FastAPI.
- Strict readiness check: database and all three model pipelines must be available.

> **Scope note:** Cash-inflow forecasting is available as a weekly, per-currency model (USD and CAD separately). Its target is an **invoice-clearance proxy**, not verified bank receipts, and forecasts are historical simulations bounded by the dataset's 2020-03-13 cutoff. See `documents/cash_flow_forecasting.md`.

## Architecture

\`\`\`text
                 Browser
                    |
                    v
          React + TypeScript UI
                    |
                    v
                Nginx :80
               /         \\
        Static UI        /api/*
                           |
                           v
                    FastAPI :8000
                    /     |      \\
                Auth/API  ML      Uploads
                   |   inference     |
                   v      v          v
               PostgreSQL  Saved   Upload
                           models  volume
                   |
                   v
             Persistent volume
\`\`\`

### Technology stack

| Layer | Technologies |
|---|---|
| Frontend | React 18, TypeScript, Vite 6, Tailwind CSS, Radix/shadcn-style UI, React Router, TanStack Query, Axios, Zustand, Recharts |
| Backend | Python 3.14, FastAPI, Pydantic, Uvicorn |
| Database | PostgreSQL 17 in Docker; SQLite for local backend development |
| ORM / migrations | SQLAlchemy 2, Alembic |
| Authentication | JWT, PBKDF2-HMAC-SHA256 password hashing, refresh-token rotation |
| Machine learning | XGBoost, scikit-learn, NumPy, Pandas, SciPy, Joblib |
| Infrastructure | Docker, Docker Compose, Nginx |

---

# Run FlowCred AI

There are two ways to run the application:

1. **Docker Compose (recommended):** starts PostgreSQL, FastAPI, and the production frontend together.
2. **Local development:** starts the backend and frontend in separate terminals.

## Option 1 — Run everything with Docker (recommended)

### Requirements

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) with its Linux container engine running.
- Git.
- PowerShell (Windows) or a terminal (macOS/Linux).

Check Docker:

\`\`\`powershell
docker --version
docker compose version
docker info
\`\`\`

### Step 1. Clone the repository

\`\`\`powershell
git clone https://github.com/ThePranish03/FlowCred_AI.git
cd FlowCred_AI
\`\`\`

### Step 2. Create the environment file

The Compose file is in \`backend/docker-compose.yml\`; its environment file is \`backend/.env\`.

Windows PowerShell:

\`\`\`powershell
Copy-Item backend/.env.example backend/.env
notepad backend/.env
\`\`\`

macOS/Linux:

\`\`\`bash
cp backend/.env.example backend/.env
\`\`\`

Set these values in \`backend/.env\`:

\`\`\`env
APP_ENV=production
JWT_SECRET_KEY=REPLACE_WITH_A_UNIQUE_RANDOM_SECRET
POSTGRES_PASSWORD=REPLACE_WITH_A_LONG_ALPHANUMERIC_PASSWORD
FRONTEND_PORT=8080
\`\`\`

Generate a cryptographically random JWT key:

Windows:

\`\`\`powershell
python -c "import secrets; print(secrets.token_urlsafe(48))"
\`\`\`

macOS/Linux:

\`\`\`bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
\`\`\`

Copy the generated value into \`JWT_SECRET_KEY\`. Use a different strong password for PostgreSQL. For the current Compose URL interpolation, use an alphanumeric database password unless you correctly URL-encode reserved characters.

**Never commit \`backend/.env\` or share its secrets.** The repository ignores local environment files.

### Step 3. Validate Docker Compose

Run this from the repository root:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml config
\`\`\`

Resolve any missing environment variable or YAML error before continuing.

### Step 4. Build and start the application

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml up --build -d
\`\`\`

This builds the frontend and backend images and starts all services:

- **db:** PostgreSQL 17.
- **api:** FastAPI. Waits for PostgreSQL health, applies Alembic migrations, loads and validates the existing ML models, then starts Uvicorn.
- **frontend:** React production build served by Nginx. Waits for API health and proxies \`/api/\` requests to the backend.

### Step 5. Verify the services

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml ps
\`\`\`

Wait for all three services to report \`healthy\`.

Typical containers:

| Service | Typical container | Expected status |
|---|---|---|
| db | backend-db-1 | healthy |
| api | backend-api-1 | healthy |
| frontend | backend-frontend-1 | healthy |

The first API start can take longer while the models load. Inspect logs:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml logs --tail=150 api
docker compose --env-file backend/.env -f backend/docker-compose.yml logs --tail=100 frontend
\`\`\`

The API health check returns healthy only when PostgreSQL and all three ML model pipelines are available.

### Step 6. Open the application

Open the frontend:

**http://localhost:8080**

The frontend is published to the Windows host on port 8080 by default. Change \`FRONTEND_PORT\` in \`backend/.env\` to use another port.

The API port 8000 is intentionally **not published to the host** in the default Compose setup. Nginx forwards frontend API calls over the internal Docker network.

### Optional: expose FastAPI directly on localhost:8000

For local debugging or direct Swagger access, edit \`backend/docker-compose.yml\` and add this under the \`api:\` service:

\`\`\`yaml
    ports:
      - "8000:8000"
\`\`\`

Keep the indentation aligned with the other \`api\` properties. Then recreate the API:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml up -d --force-recreate api
\`\`\`

You can then open:

- API health: http://localhost:8000/api/v1/health
- Swagger UI: http://localhost:8000/docs

Without that optional port mapping, do not expect \`http://localhost:8000\` to respond from Windows. The frontend at port 8080 still communicates with the API internally.

---

## Option 2 — Run locally without Docker

This is useful for development when you want to run Vite and FastAPI separately.

### Requirements

- Python **3.14**.
- Node.js **22** and npm.
- Git.
- SQLite for the simplest local database setup, or a separately configured PostgreSQL instance.

Python 3.14 is currently required because the recovered model helper is preserved as CPython 3.14 bytecode and the existing serialized model artifacts depend on its historical class reference.

Check versions:

\`\`\`powershell
python --version
node --version
npm --version
\`\`\`

### A. Backend setup

Run from the repository root.

**1. Create and activate a virtual environment**

\`\`\`powershell
py -3.14 -m venv backend/.venv
.\\backend\\.venv\\Scripts\\Activate.ps1
\`\`\`

If PowerShell blocks activation:

\`\`\`powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
.\\backend\\.venv\\Scripts\\Activate.ps1
\`\`\`

**2. Install backend dependencies**

\`\`\`powershell
python -m pip install --upgrade pip
python -m pip install -r backend/requirements.txt
\`\`\`

**3. Configure the backend**

\`\`\`powershell
Copy-Item backend/.env.example backend/.env
notepad backend/.env
\`\`\`

For local SQLite development, use:

\`\`\`env
APP_ENV=development
DEBUG=true
DATABASE_URL=sqlite:///./flowcred.db
JWT_SECRET_KEY=use_a_unique_local_secret_at_least_32_characters_long
MODEL_DIR=../models
DATA_DIR=../data
CORS_ORIGINS=http://localhost:5173
\`\`\`

Keep this file in the \`backend\` directory. Do not use these development settings for a public production deployment.

**4. Apply database migrations**

From the repository root:

\`\`\`powershell
python -m alembic -c backend/alembic.ini upgrade head
\`\`\`

**5. Start FastAPI**

\`\`\`powershell
python -m uvicorn app.main:app --app-dir backend --reload --host 127.0.0.1 --port 8000
\`\`\`

Keep this terminal open. The backend will be available at:

- Health: http://localhost:8000/api/v1/health
- Swagger UI: http://localhost:8000/docs

### B. Frontend setup

Open a **second terminal** at the repository root.

**1. Install frontend dependencies**

\`\`\`powershell
cd frontend
npm ci
\`\`\`

**2. Configure live API mode**

Create \`frontend/.env.local\` containing:

\`\`\`env
VITE_API_MODE=live
VITE_API_BASE_URL=http://localhost:8000/api/v1
\`\`\`

**3. Start Vite**

\`\`\`powershell
npm run dev
\`\`\`

Open:

**http://localhost:5173**

The backend's \`CORS_ORIGINS\` must include \`http://localhost:5173\`. Restart the backend after changing its environment file.

### Useful development commands

Frontend build and type-check:

\`\`\`powershell
cd frontend
npm run build
\`\`\`

Frontend lint:

\`\`\`powershell
npm run lint
\`\`\`

Backend tests (from repository root):

\`\`\`powershell
python -m pytest backend/tests
\`\`\`

---

## First login and roles

The backend supports registration and login. Public registrations are assigned the accountant role. The configured \`BOOTSTRAP_ADMIN_EMAIL\` can receive the initial admin role when the database is empty and the first registered email matches that setting.

To bootstrap the initial admin:

1. Set \`BOOTSTRAP_ADMIN_EMAIL\` in \`backend/.env\` to the email you intend to register.
2. Start with an empty database.
3. Register that email as the first user.
4. Log in with the registered credentials.

Changing \`BOOTSTRAP_ADMIN_EMAIL\` does not automatically promote an existing account. Keep credentials private. The current application uses a shared workspace; organization-level tenant isolation is not implemented.

---

## Machine-learning models

The API loads saved model artifacts from \`models/\`; it does not retrain them during normal application startup.

### 1. Late-payment classification

- Algorithm: XGBoost Classifier.
- Output: late-payment probability and operational risk band.
- Artifacts: \`late_payment_classifier.joblib\`, \`late_payment_feature_pipeline.joblib\`, and \`late_payment_model_metadata.json\`.
- Operational threshold: **0.45**. The classification threshold is separate from the risk-band cutoffs.

| Metric | Test result |
|---|---:|
| Accuracy | 0.7809 |
| Precision | 0.7389 |
| Recall | 0.6882 |
| F1 | 0.7127 |
| ROC-AUC | 0.8436 |
| PR-AUC | 0.8070 |

### 2. Payment-delay regression

- Algorithm: HistGradientBoosting Regressor.
- Output: signed delay in days relative to the due date.
- Artifacts: \`payment_delay_regressor.joblib\`, \`payment_delay_feature_pipeline.joblib\`, and \`payment_delay_model_metadata.json\`.

| Metric | Test result |
|---|---:|
| MAE | 3.2768 days |
| RMSE | 7.7524 days |
| R² | 0.4694 |
| Median absolute error | 1.6130 days |

Interpretation: negative = early, zero = on time, positive = late.

### 3. Customer behaviour clustering

- Algorithm: K-Means with six clusters.
- Evaluation population: 1,425 customers.
- Artifacts: \`customer_behavior_clusterer.joblib\`, \`customer_behavior_feature_pipeline.joblib\`, and \`customer_behavior_clustering_metadata.json\`.

| Metric | Value |
|---|---:|
| Silhouette score | 0.8006 |
| Calinski-Harabasz score | 3954.67 |
| Davies-Bouldin score | 0.5719 |
| Mean stability ARI | 0.9742 |

Cluster sizes are highly imbalanced. Cluster IDs are labels, not an ordered risk scale.

### Model compatibility note

The original \`feature_engineering_utils\` implementation was recovered as CPython 3.14 bytecode and is preserved in \`backend/vendor/\`. The backend loader imports that explicit vendor path, verifies the bytecode magic, and preserves historical module/class references required by the serialized model artifacts. This is why the project currently targets **CPython 3.14**.

Do not delete, regenerate, or replace the vendor bytecode or loader without revalidating all saved model artifacts and inference outputs.

---

## Project structure

\`\`\`text
FlowCred_AI/
├── architectures/                 # Architecture diagrams
├── backend/
│   ├── app/                        # FastAPI, authentication, DB, ML inference
│   ├── migrations/                 # Alembic migration scripts
│   ├── tests/                      # Backend tests
│   ├── vendor/                     # Recovered CPython 3.14 helper bytecode
│   ├── Dockerfile
│   ├── docker-compose.yml
│   ├── requirements.txt
│   ├── alembic.ini
│   ├── .env.example
│   └── README.md                   # Backend-specific guide
├── data/
│   ├── raw/
│   └── processed/                  # Cleaned source and customer features
├── frontend/
│   ├── public/demo-data/           # Dashboard source snapshots
│   ├── src/
│   │   ├── api/
│   │   ├── components/
│   │   ├── pages/
│   │   ├── stores/
│   │   └── types/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── package.json
├── models/                          # Saved estimators, pipelines, metadata
├── notebooks/                       # ML development workflow
├── reports/                         # Evaluation reports
├── requirements.txt                 # Notebook/research dependencies
└── README.md
\`\`\`

## API overview

The REST API is versioned under \`/api/v1\`. Use FastAPI's Swagger documentation at \`/docs\` when the API port is reachable for exact payload schemas and response formats.

| Area | Endpoint examples | Purpose |
|---|---|---|
| Health | \`GET /api/v1/health\` | Database and model readiness |
| Authentication | \`POST /api/v1/auth/register\`, \`/login\`, \`/refresh\`, \`/logout\` | Account and token lifecycle |
| Current user | \`GET /api/v1/auth/me\` | Current authenticated profile |
| Dashboard | \`GET /api/v1/dashboard/summary\` | Dashboard summary |
| Invoices | \`GET /api/v1/invoices\`, \`GET /api/v1/invoices/{invoice_id}\` | Invoice list and detail |
| Customers | \`GET /api/v1/customers\`, \`GET /api/v1/customers/{customer_id}\` | Customer list and detail |
| Segments | \`GET /api/v1/customers/segments\` | Customer clustering |
| Predictions | \`POST /api/v1/invoices/predict/late-payment\`, \`POST /api/v1/invoices/predict/payment-delay\` | Invoice inference |
| Upload | \`POST /api/v1/datasets/upload\` | CSV validation and persistence |
| Metrics and insights | \`GET /api/v1/models/metrics\`, \`GET /api/v1/insights\` | Model metrics and insights |

Authenticated API calls use a bearer access token.

## CSV upload notes

The frontend's documented required CSV columns are:

- \`invoice_id\`
- \`customer_id\`
- \`name_customer\`
- \`invoice_amount\`
- \`invoice_date\`
- \`due_date\`
- \`invoice_currency\`
- \`cust_payment_terms\`
- \`invoice_status\`

Optional source fields include \`payment_date\`, \`delay_days\`, \`is_late\`, \`business_code\`, \`doc_id\`, \`document_create_date\`, and \`posting_id\`.

The server performs its own validation, including duplicate invoice ID checks. Review the upload response for accepted and rejected records. Currency values are preserved: do not combine USD and CAD amounts without explicit FX conversion.

## Tests and verification

Backend tests:

\`\`\`powershell
python -m pytest backend/tests
\`\`\`

Artifact verification (if \`backend/verify_artifacts.py\` is present in your checkout):

\`\`\`powershell
python backend/verify_artifacts.py
\`\`\`

Frontend production build:

\`\`\`powershell
cd frontend
npm ci
npm run build
\`\`\`

Docker inspection, from the repository root:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml config
docker compose --env-file backend/.env -f backend/docker-compose.yml ps
docker compose --env-file backend/.env -f backend/docker-compose.yml logs --tail=150 api
\`\`\`

A successful image build alone does not prove deployment acceptance. Confirm all services are healthy, PostgreSQL migrations completed, all three models loaded in the running container, and browser workflows (login, upload, inference, and persisted retrieval) work end to end.

## Troubleshooting

### Docker cannot connect to the daemon

Start Docker Desktop, wait for the Linux engine, then run:

\`\`\`powershell
docker info
\`\`\`

### Backend is unhealthy

Inspect the backend logs:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml logs --tail=200 api
docker compose --env-file backend/.env -f backend/docker-compose.yml ps
\`\`\`

Production readiness requires PostgreSQL and all three model pipelines. HTTP 503 means a required dependency is unavailable; fix the root cause rather than weakening the health check.

### JWT secret validation fails

Set a unique random \`JWT_SECRET_KEY\` of at least 32 characters in \`backend/.env\`, then recreate the API:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml up -d --force-recreate api
\`\`\`

### localhost:8000 is unreachable

The default Compose file does not publish API port 8000. Open the frontend at \`http://localhost:8080\`. Add the optional \`8000:8000\` mapping under the API service if direct host access is required.

### Model helper or model loading fails

Keep Python 3.14 and the exact recovered bytecode under \`backend/vendor/\`. Inspect API logs. Do not delete the recovered bytecode, rewrite its historical class, retrain the saved models, or bypass readiness without validating artifact compatibility.

### Port 8080 is already occupied

Set another free host port in \`backend/.env\`, for example:

\`\`\`env
FRONTEND_PORT=8081
\`\`\`

Recreate the frontend and open \`http://localhost:8081\`.

### Restart or stop the stack

Restart:

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml restart
\`\`\`

Stop containers (named volumes are preserved):

\`\`\`powershell
docker compose --env-file backend/.env -f backend/docker-compose.yml down
\`\`\`

**Do not use \`docker compose down -v\` unless you intentionally want to delete PostgreSQL and upload volumes.** It can remove persisted application data.

## ML notebook workflow

The notebooks document the research and model-development process:

| Order | Notebook | Purpose |
|---|---|---|
| 1 | \`01_data_preprocessing.ipynb\` | Clean and prepare the source dataset |
| 1.5 | \`1.5_data_quality_validation.ipynb\` | Validate data quality |
| 2 | \`02_late_payment_feature_engineering.ipynb\` | Build classifier features |
| 3 | \`03_late_payment_classification.ipynb\` | Train and evaluate late-payment model |
| 4 | \`04_payment_delay_feature_engineering.ipynb\` | Build delay-regression features |
| 5 | \`05_payment_delay_regression_training.ipynb\` | Train and evaluate delay model |
| 6 | \`06_customer_behavior_feature_engineering.ipynb\` | Build customer-level features |
| 7 | \`07_customer_behavior_clustering.ipynb\` | Train and evaluate customer segments |

To run the root research workflow:

\`\`\`powershell
python -m venv .venv
.\\.venv\\Scripts\\Activate.ps1
python -m pip install -r requirements.txt
jupyter notebook
\`\`\`

Model research/training is separate from starting the web application. The deployed API loads the saved artifacts.

## Security and known limitations

- Use strong unique JWT and database secrets; keep \`.env\` out of version control.
- Configure HTTPS/TLS before public exposure.
- JWT authentication, refresh-token rotation, role checks, upload validation, SQL parameterization, and selected audit events are implemented.
- A shared rate limiter has not yet been implemented.
- Read auditing is incomplete; not every read operation is recorded.
- Organization-level tenant isolation is not implemented; current authorization is within a shared workspace.
- Cash-flow forecasting (Model 4) is available for USD and CAD at 7/30/90-day horizons, but it forecasts an **invoice-clearance proxy**: the source has no payment ledger, so partially settled invoices may differ from cash actually received. Daily values are derived estimates, and every forecast is a historical simulation against a 2020-03-13 data cutoff, not a live projection. Forecasting readiness is reported by `GET /api/v1/cash-flow/health` and is deliberately independent of the three-model readiness gate.
- Some dashboard/source snapshot endpoints may show the supplied original dataset snapshot; invoice/customer list/detail and prediction persistence use the database.
- Predictions are decision support, not guarantees.

## Author

**Pranish Belsare**  
Computer Science & Artificial Intelligence / Machine Learning

- GitHub: [@ThePranish03](https://github.com/ThePranish03)
- Repository: [FlowCred_AI](https://github.com/ThePranish03/FlowCred_AI)

<p align="center">
  <strong>FlowCred AI</strong><br/>
  <sub>From invoice history to intelligent payment insights.</sub>
</p>
