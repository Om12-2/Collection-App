import Dexie, { type EntityTable } from 'dexie'
import type { Client, Loan, Payment } from './types'

const db = new Dexie('CollectionAppDB') as Dexie & {
  clients: EntityTable<Client, 'id'>
  loans: EntityTable<Loan, 'id'>
  payments: EntityTable<Payment, 'id'>
}

db.version(1).stores({
  clients: 'id, name, createdAt',
  loans: 'id, clientId, dateGiven, dueDate',
})

db.version(2).stores({
  clients: 'id, name, createdAt',
  loans: 'id, clientId, dateGiven, dueDate',
  payments: 'id, clientId, loanId, createdAt',
})

db.version(3)
  .stores({
    clients: 'id, clientNumber, name, createdAt',
    loans: 'id, clientId, dateGiven, dueDate',
    payments: 'id, clientId, loanId, createdAt',
  })
  .upgrade(async (tx) => {
    const clients = await tx.table<Client>('clients').orderBy('createdAt').toArray()
    let nextNumber = 1
    for (const client of clients) {
      await tx.table<Client>('clients').update(client.id, { clientNumber: nextNumber })
      nextNumber += 1
    }
  })

export function generateId(): string {
  return crypto.randomUUID()
}

export async function getAllClients(): Promise<Client[]> {
  const clients = await db.clients.toArray()
  return clients.sort((a, b) => {
    const aNumber = a.clientNumber ?? Number.MAX_SAFE_INTEGER
    const bNumber = b.clientNumber ?? Number.MAX_SAFE_INTEGER
    return aNumber - bNumber || a.name.localeCompare(b.name)
  })
}

export async function getClient(id: string): Promise<Client | undefined> {
  return db.clients.get(id)
}

async function getNextClientNumber(): Promise<number> {
  const highestClient = await db.clients.orderBy('clientNumber').last()
  return (highestClient?.clientNumber ?? 0) + 1
}

export async function addClient(client: Omit<Client, 'id' | 'clientNumber' | 'createdAt'>): Promise<Client> {
  return db.transaction('rw', db.clients, async () => {
    const newClient: Client = {
      id: generateId(),
      clientNumber: await getNextClientNumber(),
      createdAt: new Date().toISOString(),
      ...client,
    }
    await db.clients.add(newClient)
    return newClient
  })
}

export async function updateClient(id: string, updates: Partial<Omit<Client, 'id' | 'clientNumber' | 'createdAt'>>): Promise<void> {
  await db.clients.update(id, updates)
}

export async function deleteClient(id: string): Promise<void> {
  await db.transaction('rw', db.clients, db.loans, async () => {
    await db.loans.where('clientId').equals(id).delete()
    await db.clients.delete(id)
  })
}

export async function getLoansForClient(clientId: string): Promise<Loan[]> {
  return db.loans.where('clientId').equals(clientId).reverse().sortBy('dateGiven')
}

export async function getAllLoans(): Promise<Loan[]> {
  return db.loans.orderBy('dateGiven').reverse().toArray()
}

export async function addLoan(loan: Omit<Loan, 'id' | 'dueDate' | 'amountRepaid'>): Promise<Loan> {
  const dateGiven = new Date(loan.dateGiven)
  const dueDate = new Date(dateGiven)
  dueDate.setDate(dueDate.getDate() + 100)

  const newLoan: Loan = {
    id: generateId(),
    dueDate: dueDate.toISOString().split('T')[0],
    amountRepaid: 0,
    ...loan,
  }
  await db.loans.add(newLoan)
  return newLoan
}

export async function recordRepayment(
  loanId: string,
  amount: number,
  meta?: { createdAt?: string; method?: Payment['method']; note?: string },
): Promise<void> {
  const loan = await db.loans.get(loanId)
  if (!loan) throw new Error('Loan not found')

  const apply = Math.max(0, Math.min(amount, loan.amount - loan.amountRepaid))
  if (apply <= 0) return

  const createdAt = meta?.createdAt ?? new Date().toISOString()
  const method: Payment['method'] = meta?.method ?? 'manual'
  const note = meta?.note ?? ''

  await db.transaction('rw', db.loans, db.payments, async () => {
    const newRepaid = Math.min(loan.amountRepaid + apply, loan.amount)
    await db.loans.update(loanId, { amountRepaid: newRepaid })
    await db.payments.add({
      id: generateId(),
      clientId: loan.clientId,
      loanId: loan.id,
      amount: apply,
      createdAt,
      method,
      note,
    })
  })
}

export async function clearClientBalance(clientId: string): Promise<number> {
  const loans = await getLoansForClient(clientId)
  let cleared = 0
  await db.transaction('rw', db.loans, db.payments, async () => {
    for (const loan of loans) {
      const outstanding = loan.amount - loan.amountRepaid
      if (outstanding > 0) {
        await db.loans.update(loan.id, { amountRepaid: loan.amount })
        await db.payments.add({
          id: generateId(),
          clientId,
          loanId: loan.id,
          amount: outstanding,
          createdAt: new Date().toISOString(),
          method: 'system',
          note: 'Marked as cleared',
        })
        cleared += outstanding
      }
    }
  })
  return cleared
}

export async function getRecentPayments(limit = 5): Promise<Payment[]> {
  return db.payments.orderBy('createdAt').reverse().limit(limit).toArray()
}

export async function deleteLoan(loanId: string): Promise<void> {
  await db.loans.delete(loanId)
}

export async function exportAllData(): Promise<{ clients: Client[]; loans: Loan[] }> {
  const [clients, loans] = await Promise.all([getAllClients(), getAllLoans()])
  return { clients, loans }
}

export { db }
