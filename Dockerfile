FROM python:3.11-slim

# Tesseract OCR (中文)
RUN apt-get update && apt-get install -y --no-install-recommends \
    tesseract-ocr tesseract-ocr-chi-sim \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# Railway 通过 PORT 环境变量指定端口
CMD uvicorn main:app --host 0.0.0.0 --port ${PORT:-8502}
