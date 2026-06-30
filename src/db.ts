import Dexie, { type EntityTable } from 'dexie'
import type { Client, Loan } from './types'

const db = new Dexie('CollectionAppDB') as Dexie & {
  clients: EntityTable<Client, 'id'>
  loans: EntityTable<Loan, 'id'>
}

db.version(1).stores({
  clients: 'id, name, createdAt',
  loans: 'id, clientId, dateGiven, dueDate',
})

export function generateId(): string {
  return crypto.randomUUID()
}

export async function getAllClients(): Promise<Client[]> {
  return db.clients.orderBy('name').toArray()
}

export async function getClient(id: string): Promise<Client | undefined> {
  return db.clients.get(id)
}

export async function addClient(client: Omit<Client, 'id' | 'createdAt'>): Promise<Client> {
  const newClient: Client = {
    id: generateId(),
    createdAt: new Date().toISOString(),
    ...client,
  }
  await db.clients.add(newClient)
  return newClient
}

export async function updateClient(id: string, updates: Partial<Omit<Client, 'id' | 'createdAt'>>): Promise<void> {
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

export async function recordRepayment(loanId: string, amount: number): Promise<void> {
  const loan = await db.loans.get(loanId)
  if (!loan) throw new Error('Loan not found')
  const newRepaid = Math.min(loan.amountRepaid + amount, loan.amount)
  await db.loans.update(loanId, { amountRepaid: newRepaid })
}

export async function clearClientBalance(clientId: string): Promise<number> {
  const loans = await getLoansForClient(clientId)
  let cleared = 0
  await db.transaction('rw', db.loans, async () => {
    for (const loan of loans) {
      const outstanding = loan.amount - loan.amountRepaid
      if (outstanding > 0) {
        await db.loans.update(loan.id, { amountRepaid: loan.amount })
        cleared += outstanding
      }
    }
  })
  return cleared
}

export async function deleteLoan(loanId: string): Promise<void> {
  await db.loans.delete(loanId)
}

export async function exportAllData(): Promise<{ clients: Client[]; loans: Loan[] }> {
  const [clients, loans] = await Promise.all([getAllClients(), getAllLoans()])
  return { clients, loans }
}

export { db }
