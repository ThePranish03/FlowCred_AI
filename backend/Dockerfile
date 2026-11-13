FROM python:3.14-slim
WORKDIR /srv/flowcred
RUN apt-get update && apt-get install -y --no-install-recommends libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY backend/requirements.txt ./requirements.txt
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY backend/feature_engineering_utils.py ./feature_engineering_utils.py
COPY backend/vendor ./vendor
COPY backend/alembic.ini ./backend/alembic.ini
COPY backend/migrations ./backend/migrations
COPY models ./models
COPY data/processed ./data/processed
COPY frontend/public/demo-data ./frontend/public/demo-data
ENV MODEL_DIR=/srv/flowcred/models DATA_DIR=/srv/flowcred/data
EXPOSE 8000
CMD ["sh", "-c", "alembic -c backend/alembic.ini upgrade head && uvicorn app.main:app --host 0.0.0.0 --port 8000"]
