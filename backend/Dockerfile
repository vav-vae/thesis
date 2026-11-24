FROM python:3.12-slim-bookworm

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    ENVIRONMENT=production \
    PANORAMA_MAX_CONCURRENT_JOBS=1 \
    OMP_NUM_THREADS=1 \
    OPENBLAS_NUM_THREADS=1 \
    PANORAMA_OUTPUT_DIR=/tmp/libot-outputs

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 libgomp1 \
    && rm -rf /var/lib/apt/lists/*
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt \
    && python -c "import cv2, numpy; assert hasattr(cv2, 'SIFT_create')"

# Copy only application source; credentials, local environments, captures,
# tests, and generated images never enter the runtime image.
COPY *.py ./
COPY services/*.py ./services/

RUN useradd --create-home --uid 10001 libot
USER libot
EXPOSE 8000
CMD ["python", "start.py"]
