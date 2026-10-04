FROM node:20-bookworm-slim

WORKDIR /app

# Build-инструменты на случай, если для better-sqlite3 нет готового prebuild под node 20
RUN apt-get update && apt-get install -y --no-install-recommends \
      python3 make g++ ca-certificates \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
# Запас heap под сборку Next.js (как на старом сервере)
ENV NODE_OPTIONS=--max-old-space-size=2048

# Зависимости отдельным слоем (кеширование). devDeps нужны для next build.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

# Исходники (node_modules/.next/data/.env исключены через .dockerignore)
COPY . .

# Production-сборка Next.js
RUN npm run build

# Каталог данных (БД + загрузки) монтируется как volume сюда
RUN mkdir -p /app/data

EXPOSE 3000
CMD ["npm", "start"]
