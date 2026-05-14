FROM python:3.10-slim

# Evitar que o Python gere arquivos .pyc e garantir que logs apareçam em tempo real
ENV PYTHONDONTWRITEBYTECODE 1
ENV PYTHONUNBUFFERED 1

WORKDIR /app

# Instalar dependências do sistema
RUN apt-get update && apt-get install -y \
    build-essential \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copiar apenas os requisitos primeiro para aproveitar o cache do Docker
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copiar o restante do código
COPY . .

# Criar pasta temp para uploads temporários e definir permissões
RUN mkdir -p /app/temp && chmod 777 /app/temp

# Expor a porta definida no .env (padrão 8000)
EXPOSE 8000

# Comando para rodar a aplicação com Uvicorn
CMD ["uvicorn", "main:app", "--host", "0.0.0.0", "--port", "8000"]
