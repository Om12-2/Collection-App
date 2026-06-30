import type { Client, Loan } from './types'

export function formatCurrency(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
}

/** ASCII-safe currency for PDF export (jsPDF default fonts lack Rupee symbol support) */
export function formatCurrencyPDF(amount: number): string {
  const formatted = amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })
  return `Rs. ${formatted}`
}

export function formatDate(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** ASCII-safe date for PDF export */
export function formatDatePDF(dateStr: string): string {
  const d = new Date(dateStr)
  if (isNaN(d.getTime())) return dateStr
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

/** Strip non-ASCII characters that break jsPDF default fonts */
export function sanitizeForPDF(text: string): string {
  return text.replace(/[^\x20-\x7E]/g, ' ').replace(/\s+/g, ' ').trim()
}

export function daysUntilDue(dueDate: string): number {
  const due = new Date(dueDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  due.setHours(0, 0, 0, 0)
  return Math.ceil((due.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
}

export function getLoanStatus(loan: Loan): 'paid' | 'overdue' | 'due-soon' | 'active' {
  const outstanding = loan.amount - loan.amountRepaid
  if (outstanding <= 0) return 'paid'
  const days = daysUntilDue(loan.dueDate)
  if (days < 0) return 'overdue'
  if (days <= 14) return 'due-soon'
  return 'active'
}

export function getOutstanding(loan: Loan): number {
  return Math.max(0, loan.amount - loan.amountRepaid)
}

export function summarizeClient(_client: Client, loans: Loan[]) {
  const totalLent = loans.reduce((sum, l) => sum + l.amount, 0)
  const totalRepaid = loans.reduce((sum, l) => sum + l.amountRepaid, 0)
  const totalOutstanding = loans.reduce((sum, l) => sum + getOutstanding(l), 0)
  return { totalLent, totalRepaid, totalOutstanding }
}

export function escapeHtml(text: string): string {
  const div = document.createElement('div')
  div.textContent = text
  return div.innerHTML
}

export function getDueDate(dateGiven: string, periodDays = 100): string {
  const due = new Date(dateGiven)
  due.setDate(due.getDate() + periodDays)
  return due.toISOString().split('T')[0]
}

export function todayISO(): string {
  return new Date().toISOString().split('T')[0]
}
