FROM python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY pyproject.toml /app/
COPY src /app/src
COPY backend/requirements.txt /app/requirements.txt

RUN python -m pip install --upgrade pip && \
    pip install -r requirements.txt && \
    pip install -e .

COPY backend /app/backend

CMD ["uvicorn", "backend.app:app", "--host", "0.0.0.0", "--port", "8080"]
