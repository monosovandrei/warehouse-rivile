# Инструкция по выкладке: склад Rivile GAMA

## Назначение

Внутренний веб-инструмент для просмотра складских остатков из Rivile GAMA.

Инструмент:

- показывает только позиции, которые есть в наличии;
- группирует строки с разными серийными номерами в одну модель;
- суммирует остаток в колонке `Available`;
- показывает закупочную цену в колонке `Purchase`;
- показывает цену из Google Sheet `SUPERBASE` в колонке `Price`;
- показывает раздел `Foreign stock` для зарубежных остатков поставщиков;
- разделяет оборудование по типам на основе поля `Group` из Rivile;
- использует локальный суточный слепок склада, отдельный суточный слепок цен и отдельный слепок зарубежного прайса, чтобы не дергать внешние источники при каждом открытии страницы.

## Требования к серверу

- Node.js 20 или новее.
- npm.
- Исходящий HTTPS-доступ к `https://api.manorivile.lt/client/v2`.
- Права на запись в директорию проекта для файлов `data/warehouse-snapshot.json`, `data/price-snapshot.json` и `data/foreign-stock-snapshot.json`.

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
PRICE_SHEET_ID=14j4GfREVs4ZOj9UrDsY6EzGXOUz5KTJlQf9qwkHFq84
PRICE_SHEET_GID=1211767849
PRICE_SHEET_NAME=SUPERBASE
PRICE_SHEET_CURRENCY=EUR
PRICE_SNAPSHOT_TTL_MS=86400000
FOREIGN_STOCK_SNAPSHOT_TTL_MS=86400000
FOREIGN_STOCK_SYNC_HOUR=3
FOREIGN_STOCK_STALE_DAYS=5
FOREIGN_STOCK_DELIVERY_BUSINESS_DAYS=10
FOREIGN_STOCK_CURRENCY=EUR
# FOREIGN_STOCK_SOURCE_URL=https://supplier.example.local/api/warehouse-snapshot
# FOREIGN_STOCK_SOURCE_PATH=/opt/warehouse/imports/supplier-price.csv
FOREIGN_STOCK_SOURCE_TIMEOUT_MS=30000
# FOREIGN_STOCK_SOURCE_TOKEN=replace_with_supplier_api_token
# FOREIGN_STOCK_SOURCE_AUTH_HEADER=Authorization
# FOREIGN_STOCK_SOURCE_HEADERS_JSON={"X-API-Key":"replace_with_supplier_api_key"}
```

Важно:

- реальный `RIVILE_API_KEY` нельзя хранить в репозитории или архиве;
- ключ нужно передать ИТ отдельно через утвержденный канал для секретов;
- `RIVILE_PAGE_LIMIT` не означает "загрузить только столько страниц", это аварийный максимум;
- backend сам читает страницы Rivile до конца списка и останавливается, когда API вернул неполную страницу.

## Доступ к Google Sheet с ценами

Лист `SUPERBASE` сейчас должен быть доступен backend-у одним из двух способов.

### Вариант A: публичный CSV

Использовать только если можно безопасно открыть файл на чтение по ссылке или опубликовать отдельный CSV-export.

```env
PRICE_SHEET_CSV_URL=https://docs.google.com/spreadsheets/d/.../export?format=csv&gid=...
```

### Вариант B: приватный Google Sheet через service account

Рекомендуемый вариант, если файл с ценами не должен быть публичным.

1. ИТ создаёт Google Cloud service account.
2. ИТ включает Google Sheets API.
3. Файл Google Sheet шарится на email service account с правом чтения.
4. В `.env` добавляются:

```env
GOOGLE_SERVICE_ACCOUNT_EMAIL=warehouse-prices@project-id.iam.gserviceaccount.com
GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Если автоопределение колонок не найдёт нужные поля, явно указать названия колонок:

```env
PRICE_SHEET_CODE_COLUMN=Code
PRICE_SHEET_NAME_COLUMN=Name
PRICE_SHEET_PRICE_COLUMN=Price
```

## Зарубежные остатки поставщиков

Раздел `Foreign stock` читает отдельный supplier snapshot API и сохраняет ответ в `data/foreign-stock-snapshot.json`.

Важно: Telegram Bot API не позволяет backend-боту напрямую читать сообщения другого бота `@SM_supplier_bot`. Правильный продакшен-вариант: сервер, на котором лежат данные поставщика, отдаёт актуальный слепок через API. Наш боевой сервер один раз в день забирает этот слепок и показывает его в `Foreign stock`.

Нужно настроить один из источников:

```env
FOREIGN_STOCK_SOURCE_URL=https://supplier.example.local/api/warehouse-snapshot
```

или:

```env
FOREIGN_STOCK_SOURCE_PATH=/opt/warehouse/imports/supplier-price.csv
```

Боевой вариант: `FOREIGN_STOCK_SOURCE_URL`. Локальный файл нужен только для теста или аварийной ручной загрузки.

Если API поставщика требует авторизацию:

```env
FOREIGN_STOCK_SOURCE_TOKEN=replace_with_supplier_api_token
FOREIGN_STOCK_SOURCE_AUTH_HEADER=Authorization
```

Если нужен нестандартный заголовок:

```env
FOREIGN_STOCK_SOURCE_HEADERS_JSON={"X-API-Key":"replace_with_supplier_api_key"}
```

Поддерживаются JSON, CSV и HTML-export текущего прайса. Для production предпочтителен JSON. JSON может быть массивом строк или объектом с массивом в `items`, `records` или `data`.

Минимальные поля:

- код или название позиции;
- цена;
- дата обновления цены.

Желательные поля:

- бренд;
- поставщик;
- количество.

Если автоопределение колонок не найдёт нужные поля, явно указать:

```env
FOREIGN_STOCK_CATEGORY_COLUMN=Category
FOREIGN_STOCK_CODE_COLUMN=Code
FOREIGN_STOCK_NAME_COLUMN=Name
FOREIGN_STOCK_BRAND_COLUMN=Brand
FOREIGN_STOCK_SUPPLIER_COLUMN=Supplier
FOREIGN_STOCK_QTY_COLUMN=Qty
FOREIGN_STOCK_PRICE_COLUMN=Price
FOREIGN_STOCK_CURRENCY_COLUMN=Currency
FOREIGN_STOCK_PRICE_TYPE_COLUMN=PriceType
FOREIGN_STOCK_DATE_COLUMN=Date
```

Правила:

- обновление запускается каждый день в `FOREIGN_STOCK_SYNC_HOUR`, по умолчанию в 03:00 локального времени сервера;
- если свежий `data/foreign-stock-snapshot.json` уже есть, экран не ходит во внешний API при каждом открытии;
- цена старше `FOREIGN_STOCK_STALE_DAYS`, по умолчанию 5 дней, помечается как `Possibly stale`;
- доставка для всех позиций: `FOREIGN_STOCK_DELIVERY_BUSINESS_DAYS`, по умолчанию 10 рабочих дней.

## Сборка

```bash
npm ci
npm run build
```

После сборки:

- frontend лежит в `dist/`;
- backend находится в `server/index.ts`;
- локальный слепок склада создается в `data/warehouse-snapshot.json`;
- локальный слепок цен создается в `data/price-snapshot.json`;
- локальный слепок зарубежных остатков создается в `data/foreign-stock-snapshot.json`.

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
- При первом успешном чтении Google Sheet backend создает `data/price-snapshot.json`.
- При первом успешном чтении supplier feed backend создает `data/foreign-stock-snapshot.json`.
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
- Google Sheet `SUPERBASE` для цены в колонке `Price`.
- Supplier snapshot API для раздела `Foreign stock`.

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
- `data/`;
- `dist/`, если ИТ будет собирать проект на сервере.

Если ИТ не будет собирать проект на сервере, нужно заранее выполнить `npm run build` и передать `dist/`.

## Чеклист выкладки

- На сервере создан `.env`.
- В `.env` указан реальный `RIVILE_API_KEY`.
- Для Google Sheet настроен публичный CSV или service account.
- Для зарубежных остатков настроен `FOREIGN_STOCK_SOURCE_URL` или `FOREIGN_STOCK_SOURCE_PATH`.
- `RIVILE_PAGE_LIMIT` установлен не ниже ожидаемого количества страниц склада, например `1000`.
- `npm ci` выполнен без ошибок.
- `npm run build` выполнен без ошибок.
- `npm start` запускается без ошибок.
- `curl /api/health` возвращает `ok: true`.
- Первый запрос к `/api/warehouse` создает или использует `data/warehouse-snapshot.json`.
- Интерфейс открывается через внутренний домен.
