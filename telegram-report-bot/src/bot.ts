import 'dotenv/config'
import { buildSalesReportMessage, loadCurrentMonthSalesReport } from './sales-report.ts'

type TelegramUpdate = {
  update_id: number
  message?: {
    chat: {
      id: number | string
      title?: string
      type: string
    }
    message_id: number
    text?: string
  }
}

type TelegramResponse<T> = {
  ok: boolean
  result?: T
  description?: string
}

const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN?.trim()
const telegramAllowedChatIds = new Set(
  (process.env.TELEGRAM_ALLOWED_CHAT_IDS ?? '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
)

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function telegramApi<T>(method: string, body: Record<string, unknown>) {
  if (!telegramBotToken) throw new Error('TELEGRAM_BOT_TOKEN is not configured')

  const response = await fetch(`https://api.telegram.org/bot${telegramBotToken}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = (await response.json()) as TelegramResponse<T>

  if (!response.ok || !payload.ok) {
    throw new Error(payload.description ?? `Telegram ${method} failed with ${response.status}`)
  }

  return payload.result as T
}

async function sendTelegramMessage(chatId: string | number, text: string, replyToMessageId?: number) {
  await telegramApi('sendMessage', {
    chat_id: chatId,
    disable_web_page_preview: true,
    reply_to_message_id: replyToMessageId,
    text,
  })
}

async function handleTelegramUpdate(update: TelegramUpdate) {
  const message = update.message
  const text = message?.text?.trim()
  if (!message || !text?.startsWith('/')) return

  const chatId = message.chat.id
  const command = text.split(/\s+/)[0].replace(/@.+$/, '').toLowerCase()

  if (command === '/chatid') {
    await sendTelegramMessage(chatId, `Chat ID: ${chatId}`, message.message_id)
    return
  }

  if (telegramAllowedChatIds.size > 0 && !telegramAllowedChatIds.has(String(chatId))) {
    await sendTelegramMessage(chatId, `Нет доступа к отчёту. Chat ID этой группы: ${chatId}`, message.message_id)
    return
  }

  if (command === '/start' || command === '/help') {
    await sendTelegramMessage(
      chatId,
      'Команды:\n/report - выручка и маржа с 1 числа текущего месяца по сейчас\n/chatid - ID чата для allowlist',
      message.message_id,
    )
    return
  }

  if (command !== '/report' && command !== '/margin') return

  await telegramApi('sendChatAction', { action: 'typing', chat_id: chatId })

  try {
    const report = await loadCurrentMonthSalesReport()
    await sendTelegramMessage(chatId, buildSalesReportMessage(report), message.message_id)
  } catch (error) {
    await sendTelegramMessage(
      chatId,
      `Не смог посчитать отчёт: ${error instanceof Error ? error.message : 'unknown error'}`,
      message.message_id,
    )
  }
}

async function startTelegramBot() {
  if (!telegramBotToken) {
    throw new Error('TELEGRAM_BOT_TOKEN is not configured in .env')
  }

  let offset = 0
  const me = await telegramApi<{ username?: string }>('getMe', {})
  await telegramApi('deleteWebhook', { drop_pending_updates: false })
  await telegramApi('setMyCommands', {
    commands: [
      { command: 'report', description: 'Выручка и маржа за текущий месяц' },
      { command: 'chatid', description: 'Показать ID текущего чата' },
    ],
  })

  const lastUpdates = await telegramApi<TelegramUpdate[]>('getUpdates', {
    allowed_updates: ['message'],
    offset: -1,
    timeout: 0,
  })
  if (lastUpdates.length > 0) {
    offset = lastUpdates[lastUpdates.length - 1].update_id + 1
  }

  console.log(`Telegram report bot started${me.username ? ` as @${me.username}` : ''}`)

  while (true) {
    try {
      const updates = await telegramApi<TelegramUpdate[]>('getUpdates', {
        allowed_updates: ['message'],
        offset,
        timeout: 25,
      })

      for (const update of updates) {
        offset = update.update_id + 1
        await handleTelegramUpdate(update)
      }
    } catch (error) {
      console.error('Telegram bot polling failed:', error)
      await sleep(5000)
    }
  }
}

startTelegramBot().catch((error) => {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
})
