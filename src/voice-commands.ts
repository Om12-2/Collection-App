import { getAllClients } from './db'
import { addClientLoan, findClient, recordClientRepayment } from './voice-actions'
import { formatCurrency } from './utils'

export interface VoiceContext {
  lastClientId: string | null
  selectedClientId: string | null
}

export interface VoiceResult {
  success: boolean
  message: string
  clientId?: string
}

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5,
  six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15,
  sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20,
  thirty: 30, forty: 40, fifty: 50, sixty: 60, seventy: 70,
  eighty: 80, ninety: 90, hundred: 100, thousand: 1000,
}

function normalizeTranscript(text: string): string {
  return text
    .toLowerCase()
    .replace(/[.,!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseAmount(text: string): number | null {
  const digitMatch = text.match(/(?:rs\.?|rupees?|inr)?\s*(\d[\d,]*)\s*(?:rs\.?|rupees?|inr)?/i)
    ?? text.match(/(\d[\d,]*)/)
  if (digitMatch) {
    const n = parseInt(digitMatch[1].replace(/,/g, ''), 10)
    if (!isNaN(n) && n > 0) return n
  }

  const words = text.split(/\s+/)
  let total = 0
  let current = 0
  let found = false

  for (const word of words) {
    const w = word.replace(/[^a-z]/g, '')
    if (w in NUMBER_WORDS) {
      found = true
      const val = NUMBER_WORDS[w]
      if (val === 100) {
        current = current === 0 ? 100 : current * 100
      } else if (val === 1000) {
        current = current === 0 ? 1000 : current * 1000
      } else {
        current += val
      }
    } else if (found && current > 0) {
      total += current
      current = 0
    }
  }
  if (current > 0) {
    total += current
  }
  return found && total > 0 ? total : null
}

const REPAY_KEYWORDS = /\b(deposited|deposit|paid|payment|repaid|repay|repayment|returned|gave back|paid back|has paid|has deposited)\b/
const LEND_KEYWORDS = /\b(lent|lend|loan|gave|give|added|add|advance|advanced)\b/
const PRONOUN_PATTERN = /\b(he|she|him|her|they|them|this client|the client)\b/

function extractClientName(text: string): string | null {
  const idMatch = text.match(/client\s+(?:id\s+)?([a-f0-9-]{4,})/i)
  if (idMatch) return idMatch[1]

  const patterns = [
    /(?:for|from|to)\s+client\s+(.+?)(?:\s+(?:has|have|deposited|paid|lent|gave|add))/i,
    /client\s+(.+?)(?:\s+(?:has|have|deposited|paid|lent|gave|add))/i,
    /^(.+?)\s+(?:has|have)\s+(?:deposited|paid)/i,
    /^(.+?)\s+(?:deposited|paid|repaid|returned)/i,
    /(?:for|from)\s+(.+?)(?:\s+(?:deposited|paid|repaid))/i,
    /(?:lent|gave|add(?:ed)?)\s+(?:\d[\d,]*\s*)?(?:rs\.?|rupees?)?\s*(?:to|for)\s+(.+?)$/i,
    /(?:to|for)\s+(.+?)(?:'s)?\s+(?:account|loan)/i,
    /^(.+?)\s+(?:lent|loan|advance)/i,
  ]

  for (const pattern of patterns) {
    const match = text.match(pattern)
    if (match?.[1]) {
      const name = match[1]
        .replace(/\b(ok|okay|yes|the|a|an|client|id)\b/gi, ' ')
        .replace(/\s+/g, ' ')
        .trim()
      if (name.length >= 2) return name
    }
  }

  return null
}

function usesPronoun(text: string): boolean {
  return PRONOUN_PATTERN.test(text) && !extractClientName(text)
}

export async function processVoiceCommand(
  transcript: string,
  context: VoiceContext,
): Promise<VoiceResult> {
  const text = normalizeTranscript(transcript)
  if (!text) {
    return { success: false, message: 'I did not catch that. Please try again.' }
  }

  const amount = parseAmount(text)
  const isRepay = REPAY_KEYWORDS.test(text)
  const isLend = LEND_KEYWORDS.test(text) && !isRepay

  if (!amount) {
    return {
      success: false,
      message: 'Please include an amount, for example: "Ramesh deposited 300".',
    }
  }

  if (!isRepay && !isLend) {
    return {
      success: false,
      message: 'Say whether it is a deposit or a new loan, for example: "Ramesh deposited 300" or "lent 300 to Ramesh".',
    }
  }

  let client: Awaited<ReturnType<typeof findClient>> = null

  const nameQuery = extractClientName(text)
  if (nameQuery) {
    client = await findClient(nameQuery)
    if (!client) {
      return { success: false, message: `No client found matching "${nameQuery}".` }
    }
  } else if (usesPronoun(text)) {
    const contextId = context.selectedClientId ?? context.lastClientId
    if (!contextId) {
      return {
        success: false,
        message: 'Which client? Say the client name first, for example: "Ramesh deposited 300".',
      }
    }
    client = await findClient(contextId)
    if (!client) {
      return { success: false, message: 'Could not find that client. Please say the client name.' }
    }
  } else {
    const clients = await getAllClients()
    const words = text.split(/\s+/)
    for (const c of clients) {
      const nameLower = c.name.toLowerCase()
      if (words.some((w) => w.length > 2 && nameLower.includes(w))) {
        client = c
        break
      }
    }
    if (!client) {
      return {
        success: false,
        message: 'Which client? Say something like: "Ramesh deposited 300" or "he deposited 300" after selecting a client.',
      }
    }
  }

  if (isRepay) {
    const applied = await recordClientRepayment(client.id, amount)
    if (applied === 0) {
      return {
        success: false,
        message: `${client.name} has no outstanding balance to repay.`,
        clientId: client.id,
      }
    }
    const msg = applied < amount
      ? `Recorded ${formatCurrency(applied)} repayment from ${client.name}. ${formatCurrency(amount - applied)} had no outstanding loan to apply to.`
      : `Recorded ${formatCurrency(applied)} repayment from ${client.name}.`
    return { success: true, message: msg, clientId: client.id }
  }

  await addClientLoan(client.id, amount)
  return {
    success: true,
    message: `Added ${formatCurrency(amount)} to ${client.name}'s account. Due in 100 days.`,
    clientId: client.id,
  }
}

export function getExampleCommands(): string[] {
  return [
    '"Ramesh deposited 300"',
    '"He has deposited 500" (with client selected)',
    '"Lent 1000 to Suresh"',
    '"Client ID abc... paid 200"',
  ]
}
