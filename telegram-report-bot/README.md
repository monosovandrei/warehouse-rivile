# Telegram-бот отчета по отгрузкам

Самостоятельный локальный/серверный бот для Telegram. Веб-интерфейс склада для него не нужен.

## Что делает

Команда `/report` присылает отчет с 1 числа текущего месяца по текущую дату:

- выручка по оборудованию;
- маржа по оборудованию;
- маржинальность;
- маржа по отделам;
- маржа по менеджерам внутри отдела.

Источник данных: Rivile `GET_I06_LIST`.

В отчет попадают только проведенные продажи `I06_OP_TIP=51`, `I06_PERKELTA=2`. Возвраты `I06_OP_TIP=52` учитываются как минус. Услуги отделяются от оборудования по `I07_TIPAS=2` и кодам `999...`.

## Настройка

```bash
cd telegram-report-bot
npm ci
cp .env.example .env
```

Заполнить `.env`:

```env
RIVILE_API_KEY=...
TELEGRAM_BOT_TOKEN=...
REPORT_TIME_ZONE=Europe/Moscow
REPORT_CURRENCY=EUR
```

Проверить расчет без Telegram:

```bash
npm run report
```

Запустить бота:

```bash
npm start
```

В Telegram-группе:

```txt
/report
```

## Ограничение доступа

После добавления бота в группу написать:

```txt
/chatid
```

Бот вернет ID группы. Добавить его в `.env`:

```env
TELEGRAM_ALLOWED_CHAT_IDS=-1001234567890
```

После изменения `.env` перезапустить процесс.

## Текущий маппинг отделов

`Отдел Продаж`: `104`, `105`, `115`, `121`, `124`, `125`, `127`

`CS`: `103`, `107`, `118`, `120`, `122`, `126`

Остальные менеджеры не попадают в блок по отделам.

Короткие имена:

```txt
103 - Серафима
104 - Сергей
105 - Билал
107 - Стефанчик
115 - Эд
118 - Кристина
120 - Антонио
121 - Андрей
122 - Ася
124 - Вита
125 - Артемий
126 - Илья
127 - Саша
```

## systemd пример

Файл: `systemd/servermall-report-bot.service`.

Скопировать проект, например, в `/opt/servermall-report-bot`, создать `.env`, затем:

```bash
sudo cp systemd/servermall-report-bot.service /etc/systemd/system/servermall-report-bot.service
sudo systemctl daemon-reload
sudo systemctl enable servermall-report-bot
sudo systemctl start servermall-report-bot
sudo systemctl status servermall-report-bot
```
