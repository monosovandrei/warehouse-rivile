# Инструкция по выкладке: склад Rivile GAMA

## Назначение

Внутренний веб-инструмент для просмотра складских остатков из Rivile GAMA.

Инструмент:

- показывает только позиции, которые есть в наличии;
- группирует строки с разными серийными номерами в одну модель;
- суммирует остаток в колонке `Available`;
- показывает закупочную цену в колонке `Purchase`;
- разделяет оборудование по типам на основе поля `Group` из Rivile;
- использует локальный суточный слепок склада, чтобы не дергать Rivile API при каждом открытии страницы.

## Требования к серверу

- Node.js 20 или новее.
- npm.
- Исходящий HTTPS-доступ к `https://api.manorivile.lt/client/v2`.
- Права на запись в директорию проекта для файла `data/warehouse-snapshot.json`.

## Переменные окружения

На сервере нужно создать `.env` на основе `.env.example`.

```env
PORT=5174
RIVILE_API_KEY=replace_with_real_key
RIVILE_API_URL=https://api.manorivile.lt/client/v2
RIVILE_PAGE_LIMIT=1000
RIVILE_PRODUCT_PAGE_LIMIT=1000
RIVILE_REQUEST_DELAY_MS=150
WAREHOUSE_SNAPSHOT_TTL_MS=86400000
```

Важно:

- реальный `RIVILE_API_KEY` нельзя хранить в репозитории или архиве;
- ключ нужно передать ИТ отдельно через утвержденный канал для секретов;
- `RIVILE_PAGE_LIMIT` не означает "загрузить только столько страниц", это аварийный максимум;
- backend сам читает страницы Rivile до конца списка и останавливается, когда API вернул неполную страницу.

## Сборка

```bash
npm ci
npm run build
```

После сборки:

- frontend лежит в `dist/`;
- backend находится в `server/index.ts`;
- локальный слепок склада создается в `data/warehouse-snapshot.json`.

## Запуск

```bash
npm start
```

По умолчанию приложение и API доступны на:

```txt
http://127.0.0.1:5174
```

Проверка состояния:

```bash
curl http://127.0.0.1:5174/api/health
```

Основной endpoint склада:

```bash
curl http://127.0.0.1:5174/api/warehouse
```

Принудительно пересобрать слепок вручную, если это нужно администратору:

```bash
curl "http://127.0.0.1:5174/api/warehouse?refresh=1"
```

## Как работает слепок склада

- При первом запуске backend создает `data/warehouse-snapshot.json`.
- Срок актуальности слепка задается через `WAREHOUSE_SNAPSHOT_TTL_MS`.
- Значение по умолчанию: 24 часа.
- Если слепок свежий, API сразу возвращает его без обращения к Rivile.
- Если слепок устарел, API сразу возвращает старый слепок и запускает фоновую синхронизацию.
- Если структура слепка устарела, backend пересобирает его перед ответом.
- Это снижает риск лимитов Rivile API и ускоряет открытие интерфейса.

## Данные Rivile

Backend использует:

- `GET_I17_LIST` для остатков склада;
- `GET_N17_LIST` для справочника товаров и поля `Group`;
- `I17_P_PIR_K` для закупочной цены;
- `I17_SUMA` для стоимости остатка.

Запрос остатков выполняется без параметра `group`, потому что в сгруппированном ответе Rivile не отдает поля закупочной цены. Группировка одинаковых деталей выполняется уже внутри приложения.

## Вариант A: nginx проксирует всё в Node

Использовать, если Node должен отдавать и frontend из `dist/`, и `/api`.

```nginx
server {
    listen 80;
    server_name warehouse.example.local;

    location / {
        proxy_pass http://127.0.0.1:5174;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

## Вариант B: nginx отдает frontend, Node отдает API

Использовать, если ИТ предпочитает отдавать статические файлы через nginx.

```nginx
server {
    listen 80;
    server_name warehouse.example.local;

    root /opt/warehouse/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:5174/api/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

## Пример systemd service

```ini
[Unit]
Description=Rivile warehouse app
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/warehouse
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=warehouse
Group=warehouse

[Install]
WantedBy=multi-user.target
```

Команды:

```bash
sudo systemctl daemon-reload
sudo systemctl enable warehouse
sudo systemctl start warehouse
sudo systemctl status warehouse
```

## Что передавать на сервер

Передать содержимое проекта, исключая:

- `node_modules/`;
- `.env`;
- `data/*.json`;
- `dist/`, если ИТ будет собирать проект на сервере.

Если ИТ не будет собирать проект на сервере, нужно заранее выполнить `npm run build` и передать `dist/`.

## Чеклист выкладки

- На сервере создан `.env`.
- В `.env` указан реальный `RIVILE_API_KEY`.
- `RIVILE_PAGE_LIMIT` установлен не ниже ожидаемого количества страниц склада, например `1000`.
- `npm ci` выполнен без ошибок.
- `npm run build` выполнен без ошибок.
- `npm start` запускается без ошибок.
- `curl /api/health` возвращает `ok: true`.
- Первый запрос к `/api/warehouse` создает или использует `data/warehouse-snapshot.json`.
- Интерфейс открывается через внутренний домен.
