# Deploy / Runbook — vkr-checker-hse

Сервер: `89.125.107.91` (Ubuntu 24.04), домен вкр-чекер.рф (`xn----ctbkawc3be3d.xn--p1ai`),
путь `/root/vkr-checker-hse`, ветка `vkr-version-1`. Стек: Next.js 14 → PM2 (`vkr-checker`) → nginx + Certbot.

## Зачем это (контекст бага 2026-06-16)

Тестировщик ловил на фронте `Unexpected token '<', "<html>..." is not valid JSON`.
Причина — **нехватка памяти**: бокс имеет всего **961 МБ RAM**, а тяжёлый эндпоинт
`POST /api/course/check` (файл до 50 МБ → `mammoth`/`pdf-parse` → большой GPT-промпт)
раздувал Node к ~1.6 ГБ. В итоге процесс либо падал (`FATAL: Reached heap limit`) → nginx 502,
либо так тормозил на swap, что nginx рубил запрос в 504. Любой такой HTML-ответ фронт
пытался распарсить как JSON → ошибка.

> ⚠️ **Настоящее лечение — апгрейд RAM до 2–4 ГБ.** Всё ниже — смягчение, чтобы не падало.

## Что в этом репозитории относится к фиксу

| Файл | Назначение |
|------|-----------|
| `ecosystem.config.js` (корень) | PM2-конфиг: heap `--max-old-space-size=2048` + `max_memory_restart: 2600M` |
| `deploy/setup-swap.sh` | идемпотентно поднимает swap до ~3 ГБ + `vm.swappiness=10` |
| `deploy/nginx-vkr-checker.conf` | nginx с отдельным `location /api/course/` и `proxy_read_timeout 300s` |
| `src/lib/http.ts` + правки в `course/page.tsx`, `report/page.tsx` | фронт показывает понятную ошибку вместо сырого `Unexpected token '<'` |

## Применение с нуля / на другом сервере

```bash
# 0) забрать актуальный код
cd /root/vkr-checker-hse
git pull --ff-only origin vkr-version-1     # см. примечание про ecosystem.config.js ниже

# 1) swap (один раз; идемпотентно)
sudo bash deploy/setup-swap.sh

# 2) nginx-конфиг
sudo cp deploy/nginx-vkr-checker.conf /etc/nginx/sites-available/vkr-checker
sudo ln -sf /etc/nginx/sites-available/vkr-checker /etc/nginx/sites-enabled/vkr-checker
sudo nginx -t && sudo systemctl reload nginx

# 3) сборка и запуск под PM2 (heap берётся из ecosystem.config.js)
NODE_OPTIONS=--max-old-space-size=2048 npm run build
pm2 delete vkr-checker 2>/dev/null || true
pm2 start ecosystem.config.js
pm2 save
```

### ⚠️ Примечание про `ecosystem.config.js` при первом `git pull`
Если на сервере уже лежит **untracked** `ecosystem.config.js` (как было до этого фикса),
`git pull` упадёт с «untracked working tree files would be overwritten». Содержимое
в репозитории идентично рабочему — поэтому безопасно удалить локальный и потянуть из git:
```bash
rm -f ecosystem.config.js && git pull --ff-only origin vkr-version-1
```

## Обычное обновление кода (после правок в git)

```bash
cd /root/vkr-checker-hse
git pull --ff-only origin vkr-version-1
NODE_OPTIONS=--max-old-space-size=2048 npm run build
pm2 restart vkr-checker --update-env
```
`.env` и `data/vkr.db` в `.gitignore` — `git pull` их не трогает.

## Проверка после применения
```bash
swapon --show                       # ~3 ГБ суммарно
pm2 jlist | grep -o 'max-old-space-size=2048'
nginx -t                            # syntax ok
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/        # 200
curl -s -o /dev/null -w '%{http_code}\n' https://вкр-чекер.рф/          # 200
```

## TODO (не сделано)
- [ ] **Апгрейд RAM до 2–4 ГБ** — главный пункт; swap это лишь костыль.
- [ ] Сменить root-пароль (светился в переписке) и перейти на SSH-ключи (`PasswordAuthentication no`).
