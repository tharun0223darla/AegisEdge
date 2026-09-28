FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PADDLE_DEVICE=cpu \
    FLAGS_use_mkldnn=0 \
    PADDLEX_HOME=/home/meditrack/.paddlex \
    HF_HOME=/home/meditrack/.cache/huggingface

RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 \
    libglib2.0-0 \
    libgomp1 \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 meditrack

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir --disable-pip-version-check -r requirements.txt

COPY --chown=meditrack:meditrack preprocessing.py main.py ./
RUN mkdir -p /home/meditrack/.paddlex /home/meditrack/.cache/huggingface \
    && chown -R meditrack:meditrack /home/meditrack

USER meditrack
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10m --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8000/health/ready', timeout=8)" || exit 1

CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
