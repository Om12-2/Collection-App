import { getAllClients, getLoansForClient, addLoan, recordRepayment } from './db'
import type { Client } from './types'
import { getOutstanding } from './utils'

export async function findClient(query: string): Promise<Client | null> {
  const clients = await getAllClients()
  const normalized = query.trim().toLowerCase()
  if (!normalized) return null

  const byId = clients.find(
    (c) => c.id.toLowerCase() === normalized || c.id.toLowerCase().startsWith(normalized),
  )
  if (byId) return byId

  const byExactName = clients.find((c) => c.name.toLowerCase() === normalized)
  if (byExactName) return byExactName

  const byPartialName = clients.filter((c) => c.name.toLowerCase().includes(normalized))
  if (byPartialName.length === 1) return byPartialName[0]
  if (byPartialName.length > 1) {
    const best = byPartialName.find((c) => c.name.toLowerCase().startsWith(normalized))
    return best ?? byPartialName[0]
  }

  const words = normalized.split(/\s+/)
  for (const client of clients) {
    const nameWords = client.name.toLowerCase().split(/\s+/)
    if (words.every((w) => nameWords.some((nw) => nw.startsWith(w) || nw.includes(w)))) {
      return client
    }
  }

  return null
}

export async function recordClientRepayment(clientId: string, amount: number): Promise<number> {
  const loans = await getLoansForClient(clientId)
  const outstandingLoans = loans
    .filter((l) => getOutstanding(l) > 0)
    .sort((a, b) => a.dateGiven.localeCompare(b.dateGiven))

  let remaining = amount
  for (const loan of outstandingLoans) {
    if (remaining <= 0) break
    const outstanding = getOutstanding(loan)
    const apply = Math.min(remaining, outstanding)
    await recordRepayment(loan.id, apply)
    remaining -= apply
  }
  return amount - remaining
}

export async function addClientLoan(clientId: string, amount: number): Promise<void> {
  const today = new Date().toISOString().split('T')[0]
  await addLoan({ clientId, amount, dateGiven: today, notes: 'Added via voice command' })
}
