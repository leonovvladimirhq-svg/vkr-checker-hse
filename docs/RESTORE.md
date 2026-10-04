# Восстановление с нуля и эксплуатация сервера

Как поднять ВКР-чекер на новом компьютере или новом сервере, как восстановить данные
и как выкладывать обновления. Внешние сервисы и ключи описаны в [SERVICES.md](SERVICES.md).

## Что где лежит

| Что | Где | В git? |
|---|---|---|
| Код, документация, Dockerfile, конфиг nginx | GitHub `leonovvladimirhq-svg/vkr-checker-hse` | да |
| Полная копия репозитория одним файлом | `*.bundle` в папке бэкапа (см. [BACKUP_LOG.md](BACKUP_LOG.md)) | — |
| `.env` с ключами | `/opt/vkr-checker/.env` на ВМ + менеджер паролей | **нет** |
| База `vkr.db` и файлы работ (`uploads/`, `course-uploads/`, `course-reviews/`) | `/opt/vkr-checker/data/` на ВМ + архив `prod-data_<дата>.tar.gz` в папке бэкапа | **нет** (персональные данные студентов) |

## 1. Восстановить код

```bash
git clone https://github.com/leonovvladimirhq-svg/vkr-checker-hse.git
cd vkr-checker-hse
git checkout vkr-version-1     # рабочая ветка: из неё деплоится прод
```

Если GitHub недоступен, код восстанавливается из bundle-файла:

```bash
git clone vkr-checker-hse_all-branches.bundle vkr-checker-hse
```

## 2. Запустить на своём компьютере

Нужны Node.js 20+ и npm 10+.

```bash
npm ci                    # точные версии из package-lock.json
cp .env.example .env      # и заполнить OPENAI_API_KEY / OPENAI_BASE_URL / OPENAI_MODEL
npm run dev               # http://localhost:3000
```

Папка `data/` и пустая база `data/vkr.db` создаются при первом запросе. Учётные записи преподавателей
тоже создаются автоматически, но без паролей, поэтому войти в панель преподавателя нельзя.
Пароль задаётся так: `node scripts/teacher-account.mjs password <логин>`.

## 3. Поднять сервер с нуля (Yandex Cloud)

1. **ВМ:** Ubuntu 22.04, 2 vCPU, 4 ГБ RAM, диск от 20 ГБ, статический публичный IP. Пользователь `yc-user`, SSH-ключ.
2. **Пакеты:**
   ```bash
   sudo apt-get update && sudo apt-get install -y nginx certbot python3-certbot-nginx
   curl -fsSL https://get.docker.com | sudo sh          # Docker Engine + compose plugin
   sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile
   echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
   ```
3. **Код:** на своём компьютере, в папке репозитория:
   ```bash
   git -c core.autocrlf=false archive --format=tar.gz -o vkr-full.tgz HEAD
   scp vkr-full.tgz yc-user@<IP>:/tmp/
   ```
   На сервере: `sudo mkdir -p /opt/vkr-checker && sudo chown yc-user: /opt/vkr-checker && tar -xzf /tmp/vkr-full.tgz -C /opt/vkr-checker`.
4. **`.env`:** `cp .env.example .env`, вписать значения из менеджера паролей. Ключ AI Studio создаётся **без срока действия**, см. [SERVICES.md](SERVICES.md#yandex-ai-studio--языковая-модель).
5. **Данные:** восстановить из архива, см. [раздел 4](#4-восстановить-данные). Без этого сервис стартует с пустой базой.
6. **Запуск:** `cd /opt/vkr-checker && sudo docker compose up -d --build`. Сборка занимает 3–5 минут. Проверка: `curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/` должен вернуть `200`.
7. **nginx:** скопировать `deploy/nginx-vkr-checker.conf` в `/etc/nginx/sites-available/vkr-checker`, **без строк `# managed by Certbot`** и без второго блока `server`. Затем:
   ```bash
   sudo ln -sf /etc/nginx/sites-available/vkr-checker /etc/nginx/sites-enabled/vkr-checker
   sudo rm -f /etc/nginx/sites-enabled/default
   sudo nginx -t && sudo systemctl reload nginx
   ```
8. **Домен:** в reg.ru поменять A-записи `вкр-чекер.рф` и `www` на новый IP и подождать, пока DNS обновится.
9. **SSL:** `sudo certbot --nginx -d xn----ctbkawc3be3d.xn--p1ai -d www.xn----ctbkawc3be3d.xn--p1ai`. Certbot сам допишет HTTPS в конфиг и включит автопродление. Проверка: `sudo certbot renew --dry-run`.
10. **Пароли преподавателей:** если база восстановлена из архива, прежние пароли продолжают работать. Если база новая, задайте их заново:
    `sudo docker exec -w /app vkr-checker node scripts/teacher-account.mjs password <логин>`.

## 4. Восстановить данные

Архив `prod-data_<дата>.tar.gz` содержит снимок базы `vkr-snapshot-<дата>.db` и папки `uploads/`, `course-uploads/`, `course-reviews/`.

```bash
cd /opt/vkr-checker
sudo docker compose stop
mkdir -p data && tar -xzf /tmp/prod-data_<дата>.tar.gz -C data
mv data/vkr-snapshot-*.db data/vkr.db
rm -f data/vkr.db-wal data/vkr.db-shm      # журнал от прежней базы к снимку не относится
sudo docker compose up -d
```

Проверка: в панели преподавателя видны прежние работы, файлы скачиваются.

## Резервная копия данных

Автоматического бэкапа нет. Ручная копия делается без остановки сервиса:

```bash
# на сервере: согласованный снимок базы через SQLite backup API (учитывает журнал -wal)
cd /opt/vkr-checker
T=$(date +%Y%m%d)
sudo docker exec -w /app vkr-checker node -e "require('better-sqlite3')('data/vkr.db',{readonly:true}).backup('data/vkr-snapshot-$T.db').then(()=>console.log('ok'))"
sudo tar -czf /opt/vkr-checker-backups/data-$T.tar.gz -C data vkr-snapshot-$T.db uploads course-uploads course-reviews
sudo rm data/vkr-snapshot-$T.db
# на своём компьютере
scp -i ~/.ssh/yc_faqbot_key yc-user@89.169.146.175:/opt/vkr-checker-backups/data-<дата>.tar.gz .
```

⚠️ **Не копируйте один `vkr.db` командой `cp`.** База работает в режиме WAL, и свежие изменения лежат в
`vkr.db-wal`. Копия без журнала окажется старой: например, файлы `vkr.db.pre-*` от 23.09.2026 в
`data/` на сервере фактически содержат состояние на 22.06.2026.

## Обычный деплой

Сервер не является git-репозиторием. Код приезжает архивом из локального репозитория:

```bash
# на своём компьютере, в папке репозитория, на нужном коммите
git -c core.autocrlf=false archive --format=tar.gz -o /tmp/vkr-src.tgz HEAD src scripts package.json package-lock.json
scp -i ~/.ssh/yc_faqbot_key /tmp/vkr-src.tgz yc-user@89.169.146.175:/tmp/
ssh -i ~/.ssh/yc_faqbot_key yc-user@89.169.146.175
```
```bash
# на сервере
cd /opt/vkr-checker
T=$(date +%Y%m%d-%H%M%S)
sudo mkdir -p /opt/vkr-checker-backups/src-$T && sudo cp -a src scripts package.json package-lock.json /opt/vkr-checker-backups/src-$T/
sudo tar -xzf /tmp/vkr-src.tgz -C /opt/vkr-checker
sudo docker compose up -d --build
sudo docker compose logs --tail 50
```

- `core.autocrlf=false` нужен, чтобы на сервер попадали файлы с переводами строк LF. Без этого флага git на Windows отдаёт CRLF. На работу сервиса это не влияет, но мешает сверять код на сервере с git.
- Если менялись `Dockerfile` или `docker-compose.yml`, добавьте их в команду `git archive`.
- `.env` и `data/` деплой не трогает.
- После деплоя у пользователей с открытой вкладкой работает старый интерфейс, пока они не обновят страницу (F5).

**Откат:** `sudo cp -a /opt/vkr-checker-backups/src-<метка>/. /opt/vkr-checker/ && sudo docker compose up -d --build`.

## Повседневные команды на сервере

```bash
cd /opt/vkr-checker
sudo docker compose logs -f --tail 200        # лог приложения
sudo docker compose restart                   # перезапуск
sudo docker stats --no-stream; free -h        # память (контейнер падал по OOM на старом сервере)
sudo tail -f /var/log/nginx/access.log
sudo docker exec -w /app vkr-checker node scripts/teacher-account.mjs list
```
