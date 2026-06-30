export interface Client {
  id: string
  name: string
  phone: string
  notes: string
  createdAt: string
}

export interface Loan {
  id: string
  clientId: string
  amount: number
  dateGiven: string
  dueDate: string
  amountRepaid: number
  notes: string
}

export interface Payment {
  id: string
  clientId: string
  loanId: string
  amount: number
  createdAt: string
  method: 'manual' | 'voice' | 'system'
  note: string
}

export type View = 'dashboard' | 'clients' | 'add-client' | 'client-detail' | 'edit-client' | 'add-loan' | 'repay'

export interface ClientWithLoans extends Client {
  loans: Loan[]
  totalOutstanding: number
  totalLent: number
  totalRepaid: number
}
