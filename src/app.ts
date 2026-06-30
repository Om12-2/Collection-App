import type { Loan, View } from './types'
import {
  addClient,
  addLoan,
  clearClientBalance,
  deleteClient,
  deleteLoan,
  getAllClients,
  getAllLoans,
  getClient,
  getLoansForClient,
  recordRepayment,
  updateClient,
} from './db'
import { exportToPDF, sharePDF } from './pdf-export'
import {
  daysUntilDue,
  escapeHtml,
  formatCurrency,
  formatDate,
  getDueDate,
  getLoanStatus,
  getOutstanding,
  summarizeClient,
  todayISO,
} from './utils'
import { initVoice } from './voice'

interface AppState {
  view: View
  selectedClientId: string | null
  searchQuery: string
  lastVoiceClientId: string | null
}

const state: AppState = {
  view: 'dashboard',
  selectedClientId: null,
  searchQuery: '',
  lastVoiceClientId: null,
}

const app = document.querySelector<HTMLDivElement>('#app')!

function navigate(view: View, clientId?: string) {
  state.view = view
  if (clientId !== undefined) {
    state.selectedClientId = clientId
    state.lastVoiceClientId = clientId
  }
  if (view !== 'repay') repayLoanId = null
  render()
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const existing = document.querySelector('.toast')
  existing?.remove()
  const toast = document.createElement('div')
  toast.className = `toast toast-${type}`
  toast.textContent = message
  document.body.appendChild(toast)
  requestAnimationFrame(() => toast.classList.add('show'))
  setTimeout(() => {
    toast.classList.remove('show')
    setTimeout(() => toast.remove(), 300)
  }, 3000)
}

function statusBadge(loan: Loan): string {
  const status = getLoanStatus(loan)
  const labels = { paid: 'Paid', overdue: 'Overdue', 'due-soon': 'Due Soon', active: 'Active' }
  return `<span class="badge badge-${status}">${labels[status]}</span>`
}

async function renderDashboard(): Promise<string> {
  const [clients, loans] = await Promise.all([getAllClients(), getAllLoans()])
  const totalLent = loans.reduce((s, l) => s + l.amount, 0)
  const totalRepaid = loans.reduce((s, l) => s + l.amountRepaid, 0)
  const totalOutstanding = loans.reduce((s, l) => s + getOutstanding(l), 0)
  const overdueLoans = loans.filter((l) => getLoanStatus(l) === 'overdue')
  const dueSoonLoans = loans.filter((l) => getLoanStatus(l) === 'due-soon')

  const recentLoans = loans.slice(0, 5)
  const clientMap = new Map(clients.map((c) => [c.id, c]))

  return `
    <div class="page">
      <header class="page-header">
        <h1>Collection Manager</h1>
        <p class="subtitle">Your data is stored locally on this device</p>
        <p class="voice-hint">🎤 Tap the mic below to say e.g. "Ramesh deposited 300"</p>
      </header>

      <div class="stats-grid">
        <div class="stat-card">
          <span class="stat-label">Clients</span>
          <span class="stat-value">${clients.length}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Total Lent</span>
          <span class="stat-value">${formatCurrency(totalLent)}</span>
        </div>
        <div class="stat-card highlight">
          <span class="stat-label">Outstanding</span>
          <span class="stat-value">${formatCurrency(totalOutstanding)}</span>
        </div>
        <div class="stat-card">
          <span class="stat-label">Repaid</span>
          <span class="stat-value">${formatCurrency(totalRepaid)}</span>
        </div>
      </div>

      ${overdueLoans.length > 0 ? `
        <div class="alert alert-danger">
          <strong>${overdueLoans.length} overdue loan${overdueLoans.length > 1 ? 's' : ''}</strong>
          <span>Past the 100-day repayment period</span>
        </div>
      ` : ''}

      ${dueSoonLoans.length > 0 ? `
        <div class="alert alert-warning">
          <strong>${dueSoonLoans.length} due soon</strong>
          <span>Within 14 days of deadline</span>
        </div>
      ` : ''}

      <section class="section">
        <div class="section-header">
          <h2>Recent Activity</h2>
        </div>
        ${recentLoans.length === 0 ? '<p class="empty-text">No loans yet. Add a client and record a payment.</p>' : `
          <div class="loan-list">
            ${recentLoans.map((loan) => {
              const client = clientMap.get(loan.clientId)
              return `
                <div class="loan-item" data-client="${loan.clientId}">
                  <div class="loan-item-main">
                    <span class="loan-client">${escapeHtml(client?.name ?? 'Unknown')}</span>
                    <span class="loan-amount">${formatCurrency(loan.amount)}</span>
                  </div>
                  <div class="loan-item-sub">
                    <span>${formatDate(loan.dateGiven)}</span>
                    ${statusBadge(loan)}
                  </div>
                </div>
              `
            }).join('')}
          </div>
        `}
      </section>

      <div class="action-grid">
        <button class="action-btn" data-action="add-client">
          <span class="action-icon">+</span>
          <span>Add Client</span>
        </button>
        <button class="action-btn" data-action="clients">
          <span class="action-icon">👥</span>
          <span>All Clients</span>
        </button>
        <button class="action-btn secondary" data-action="export-pdf">
          <span class="action-icon">📄</span>
          <span>Export PDF</span>
        </button>
        <button class="action-btn secondary" data-action="share-pdf">
          <span class="action-icon">☁️</span>
          <span>Share Backup</span>
        </button>
      </div>
    </div>
  `
}

async function renderClients(): Promise<string> {
  const clients = await getAllClients()
  const loans = await getAllLoans()
  const query = state.searchQuery.toLowerCase()

  const filtered = clients.filter(
    (c) => c.name.toLowerCase().includes(query) || c.phone.includes(query),
  )

  return `
    <div class="page">
      <header class="page-header with-back">
        <button class="back-btn" data-action="dashboard">←</button>
        <div>
          <h1>Clients</h1>
          <p class="subtitle">${clients.length} total</p>
        </div>
      </header>

      <div class="search-bar">
        <input type="search" id="search-input" placeholder="Search by name or phone..." value="${escapeHtml(state.searchQuery)}" />
      </div>

      <button class="fab" data-action="add-client">+</button>

      ${filtered.length === 0 ? `
        <div class="empty-state">
          <p>${query ? 'No clients match your search.' : 'No clients yet.'}</p>
          <button class="btn primary" data-action="add-client">Add First Client</button>
        </div>
      ` : `
        <div class="client-list">
          ${filtered.map((client) => {
            const clientLoans = loans.filter((l) => l.clientId === client.id)
            const { totalOutstanding } = summarizeClient(client, clientLoans)
            const hasOverdue = clientLoans.some((l) => getLoanStatus(l) === 'overdue')
            const isCleared = totalOutstanding <= 0
            return `
              <div class="client-card ${hasOverdue ? 'has-overdue' : ''} ${isCleared ? 'is-cleared' : ''}">
                <div class="client-card-body" data-client="${client.id}">
                  <div class="client-card-main">
                    <span class="client-name">${escapeHtml(client.name)}</span>
                    ${client.phone ? `<span class="client-phone">${escapeHtml(client.phone)}</span>` : ''}
                    ${isCleared ? '<span class="badge badge-paid">Cleared</span>' : ''}
                  </div>
                  <div class="client-card-amount">
                    <span class="amount-label">Outstanding</span>
                    <span class="amount-value ${totalOutstanding > 0 ? 'owed' : 'clear'}">${formatCurrency(totalOutstanding)}</span>
                  </div>
                </div>
                <div class="client-card-actions">
                  <button class="btn-icon" data-action="edit-client" data-client-id="${client.id}" title="Edit client">✏️</button>
                  ${totalOutstanding > 0 ? `
                    <button class="btn-icon cleared" data-action="mark-cleared" data-client-id="${client.id}" title="Mark as cleared">✓</button>
                  ` : ''}
                </div>
              </div>
            `
          }).join('')}
        </div>
      `}
    </div>
  `
}

function renderAddClient(): string {
  const today = todayISO()
  const dueDate = getDueDate(today)

  return `
    <div class="page">
      <header class="page-header with-back">
        <button class="back-btn" data-action="clients">←</button>
        <h1>Add Client</h1>
      </header>

      <form id="add-client-form" class="form">
        <div class="form-group">
          <label for="client-name">Client Name *</label>
          <input type="text" id="client-name" required placeholder="Enter full name" autocomplete="name" />
        </div>
        <div class="form-group">
          <label for="client-phone">Phone Number</label>
          <input type="tel" id="client-phone" placeholder="e.g. 9876543210" autocomplete="tel" />
        </div>
        <div class="form-group">
          <label for="client-amount">Amount Given *</label>
          <input type="number" id="client-amount" required min="1" step="1" placeholder="e.g. 300" inputmode="numeric" />
          <span class="field-hint">Amount you are lending to this client</span>
        </div>
        <div class="form-group">
          <label for="client-date-given">Date Given</label>
          <input type="date" id="client-date-given" value="${today}" />
        </div>
        <div class="period-box" id="client-period-box">
          <span class="period-label">Repayment Period (100 days)</span>
          <div class="period-dates">
            <span id="period-from">${formatDate(today)}</span>
            <span class="period-arrow">→</span>
            <span id="period-to">${formatDate(dueDate)}</span>
          </div>
          <span class="period-days">Client must repay within 100 days</span>
        </div>
        <div class="form-group">
          <label for="client-notes">Notes</label>
          <textarea id="client-notes" rows="3" placeholder="Optional notes about this client"></textarea>
        </div>
        <button type="submit" class="btn primary full-width">Save Client &amp; Add Amount</button>
      </form>
    </div>
  `
}

async function renderEditClient(): Promise<string> {
  if (!state.selectedClientId) return ''
  const client = await getClient(state.selectedClientId)
  if (!client) {
    state.view = 'clients'
    return renderClients()
  }

  return `
    <div class="page">
      <header class="page-header with-back">
        <button class="back-btn" data-action="clients">←</button>
        <h1>Edit Client</h1>
      </header>

      <form id="edit-client-form" class="form">
        <div class="form-group">
          <label for="edit-client-name">Client Name *</label>
          <input type="text" id="edit-client-name" required value="${escapeHtml(client.name)}" autocomplete="name" />
        </div>
        <div class="form-group">
          <label for="edit-client-phone">Phone Number</label>
          <input type="tel" id="edit-client-phone" value="${escapeHtml(client.phone)}" autocomplete="tel" />
        </div>
        <div class="form-group">
          <label for="edit-client-notes">Notes</label>
          <textarea id="edit-client-notes" rows="3">${escapeHtml(client.notes)}</textarea>
        </div>
        <button type="submit" class="btn primary full-width">Save Changes</button>
      </form>
    </div>
  `
}

async function renderClientDetail(): Promise<string> {
  if (!state.selectedClientId) return ''
  const client = await getClient(state.selectedClientId)
  if (!client) {
    state.view = 'clients'
    return renderClients()
  }

  const loans = await getLoansForClient(client.id)
  const { totalLent, totalRepaid, totalOutstanding } = summarizeClient(client, loans)

  return `
    <div class="page">
      <header class="page-header with-back">
        <button class="back-btn" data-action="clients">←</button>
        <div>
          <h1>${escapeHtml(client.name)}</h1>
          ${client.phone ? `<p class="subtitle">${escapeHtml(client.phone)}</p>` : ''}
        </div>
      </header>

      <div class="client-summary">
        <div class="summary-item">
          <span class="summary-label">Total Lent</span>
          <span class="summary-value">${formatCurrency(totalLent)}</span>
        </div>
        <div class="summary-item">
          <span class="summary-label">Repaid</span>
          <span class="summary-value repaid">${formatCurrency(totalRepaid)}</span>
        </div>
        <div class="summary-item highlight">
          <span class="summary-label">Outstanding</span>
          <span class="summary-value owed">${formatCurrency(totalOutstanding)}</span>
        </div>
      </div>

      ${client.notes ? `<p class="client-notes">${escapeHtml(client.notes)}</p>` : ''}

      <div class="client-action-row">
        <button class="btn secondary" data-action="edit-client">✏️ Edit Client</button>
        ${totalOutstanding > 0 ? `
          <button class="btn success" data-action="mark-cleared">✓ Mark as Cleared</button>
        ` : `
          <span class="badge badge-paid badge-lg">Fully Cleared</span>
        `}
      </div>

      <div class="section-header">
        <h2>Loans</h2>
        <span class="repay-period">100-day repayment period</span>
      </div>

      <button class="btn primary full-width" data-action="add-loan" style="margin-bottom: 1rem;">
        + Add Payment to Account
      </button>

      ${loans.length === 0 ? `
        <p class="empty-text">No payments recorded yet.</p>
      ` : `
        <div class="loan-detail-list">
          ${loans.map((loan) => {
            const outstanding = getOutstanding(loan)
            const days = daysUntilDue(loan.dueDate)
            const daysText = outstanding <= 0
              ? 'Fully repaid'
              : days < 0
                ? `${Math.abs(days)} days overdue`
                : `${days} days remaining`
            return `
              <div class="loan-detail-card">
                <div class="loan-detail-header">
                  <span class="loan-detail-amount">${formatCurrency(loan.amount)}</span>
                  ${statusBadge(loan)}
                </div>
                <div class="loan-detail-dates">
                  <div><span>Given:</span> ${formatDate(loan.dateGiven)}</div>
                  <div><span>Due:</span> ${formatDate(loan.dueDate)}</div>
                </div>
                <div class="loan-detail-progress">
                  <div class="progress-bar">
                    <div class="progress-fill" style="width: ${(loan.amountRepaid / loan.amount) * 100}%"></div>
                  </div>
                  <div class="progress-text">
                    <span>Repaid: ${formatCurrency(loan.amountRepaid)}</span>
                    <span class="${days < 0 && outstanding > 0 ? 'overdue-text' : ''}">${daysText}</span>
                  </div>
                </div>
                ${outstanding > 0 ? `
                  <button class="btn small" data-action="repay" data-loan="${loan.id}">Record Repayment</button>
                ` : ''}
                <button class="btn small danger-text" data-action="delete-loan" data-loan="${loan.id}">Delete</button>
              </div>
            `
          }).join('')}
        </div>
      `}

      <div class="danger-zone">
        <button class="btn danger full-width" data-action="delete-client">Delete Client</button>
      </div>
    </div>
  `
}

function renderAddLoan(): string {
  return `
    <div class="page">
      <header class="page-header with-back">
        <button class="back-btn" data-action="client-detail">←</button>
        <h1>Add Payment</h1>
      </header>

      <p class="info-box">
        Record the amount you are lending to this client. They will have <strong>100 days</strong> to pay it back.
      </p>

      <form id="add-loan-form" class="form">
        <div class="form-group">
          <label for="loan-amount">Amount *</label>
          <input type="number" id="loan-amount" required min="1" step="1" placeholder="e.g. 300" inputmode="numeric" />
        </div>
        <div class="form-group">
          <label for="loan-date">Date Given</label>
          <input type="date" id="loan-date" value="${new Date().toISOString().split('T')[0]}" />
        </div>
        <div class="form-group">
          <label for="loan-notes">Notes</label>
          <textarea id="loan-notes" rows="2" placeholder="Optional notes"></textarea>
        </div>
        <button type="submit" class="btn primary full-width">Add to Account</button>
      </form>
    </div>
  `
}

function renderRepay(loanId: string): string {
  return `
    <div class="page">
      <header class="page-header with-back">
        <button class="back-btn" data-action="client-detail">←</button>
        <h1>Record Repayment</h1>
      </header>

      <form id="repay-form" class="form" data-loan="${loanId}">
        <div class="form-group">
          <label for="repay-amount">Repayment Amount *</label>
          <input type="number" id="repay-amount" required min="1" step="1" placeholder="Amount received" inputmode="numeric" />
        </div>
        <button type="submit" class="btn primary full-width">Record Payment</button>
      </form>
    </div>
  `
}

async function render(): Promise<void> {
  let html = ''
  switch (state.view) {
    case 'dashboard':
      html = await renderDashboard()
      break
    case 'clients':
      html = await renderClients()
      break
    case 'add-client':
      html = renderAddClient()
      break
    case 'client-detail':
      html = await renderClientDetail()
      break
    case 'edit-client':
      html = await renderEditClient()
      break
    case 'add-loan':
      html = renderAddLoan()
      break
    case 'repay':
      html = repayLoanId ? renderRepay(repayLoanId) : await renderClientDetail()
      break
  }

  app.innerHTML = html + renderNav()
  attachListeners()
}

function renderNav(): string {
  const items = [
    { view: 'dashboard' as View, label: 'Home', icon: '🏠' },
    { view: 'clients' as View, label: 'Clients', icon: '👥' },
    { view: 'add-client' as View, label: 'Add', icon: '➕' },
  ]
  return `
    <nav class="bottom-nav">
      ${items.map((item) => `
        <button class="nav-item ${state.view === item.view || (item.view === 'clients' && (state.view === 'client-detail' || state.view === 'edit-client')) ? 'active' : ''}" data-action="${item.view}">
          <span class="nav-icon">${item.icon}</span>
          <span class="nav-label">${item.label}</span>
        </button>
      `).join('')}
    </nav>
  `
}

let repayLoanId: string | null = null

function attachListeners() {
  app.querySelectorAll('[data-action]').forEach((el) => {
    el.addEventListener('click', async (e) => {
      const target = e.currentTarget as HTMLElement
      const action = target.dataset.action!

      switch (action) {
        case 'dashboard':
        case 'clients':
        case 'add-client':
          navigate(action as View)
          break
        case 'client-detail':
          navigate('client-detail')
          break
        case 'add-loan':
          navigate('add-loan')
          break
        case 'edit-client': {
          const clientId = target.dataset.clientId ?? state.selectedClientId
          if (clientId) navigate('edit-client', clientId)
          break
        }
        case 'mark-cleared': {
          const clientId = target.dataset.clientId ?? state.selectedClientId
          if (!clientId) break
          const client = await getClient(clientId)
          const clientLoans = await getLoansForClient(clientId)
          const { totalOutstanding } = summarizeClient(client!, clientLoans)
          if (totalOutstanding <= 0) {
            showToast('Client is already cleared')
            break
          }
          if (confirm(`Mark ${client?.name} as fully cleared? This will record ${formatCurrency(totalOutstanding)} as repaid.`)) {
            await clearClientBalance(clientId)
            showToast(`${client?.name} marked as cleared`)
            if (state.view === 'client-detail') {
              render()
            } else {
              navigate('clients')
            }
          }
          break
        }
        case 'export-pdf':
          try {
            await exportToPDF()
            showToast('PDF downloaded successfully')
          } catch {
            showToast('Failed to export PDF', 'error')
          }
          break
        case 'share-pdf':
          try {
            await sharePDF()
            showToast('Backup shared')
          } catch {
            showToast('Share cancelled or failed', 'error')
          }
          break
        case 'repay':
          repayLoanId = target.dataset.loan ?? null
          if (repayLoanId) {
            state.view = 'repay'
            render()
          }
          break
        case 'delete-loan':
          if (confirm('Delete this loan record?')) {
            await deleteLoan(target.dataset.loan!)
            showToast('Loan deleted')
            render()
          }
          break
        case 'delete-client':
          if (confirm('Delete this client and all their loans? This cannot be undone.')) {
            await deleteClient(state.selectedClientId!)
            showToast('Client deleted')
            navigate('clients')
          }
          break
      }
    })
  })

  app.querySelectorAll('[data-client]').forEach((el) => {
    el.addEventListener('click', () => {
      const clientId = (el as HTMLElement).dataset.client!
      navigate('client-detail', clientId)
    })
  })

  app.querySelectorAll('[data-action="edit-client"], [data-action="mark-cleared"]').forEach((el) => {
    el.addEventListener('click', (e) => e.stopPropagation())
  })

  const editClientForm = app.querySelector<HTMLFormElement>('#edit-client-form')
  editClientForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!state.selectedClientId) return
    const name = (app.querySelector('#edit-client-name') as HTMLInputElement).value.trim()
    const phone = (app.querySelector('#edit-client-phone') as HTMLInputElement).value.trim()
    const notes = (app.querySelector('#edit-client-notes') as HTMLTextAreaElement).value.trim()
    if (!name) return
    await updateClient(state.selectedClientId, { name, phone, notes })
    showToast(`${name} updated`)
    navigate('client-detail')
  })

  const searchInput = app.querySelector<HTMLInputElement>('#search-input')
  searchInput?.addEventListener('input', () => {
    state.searchQuery = searchInput.value
    render()
  })

  const addClientForm = app.querySelector<HTMLFormElement>('#add-client-form')
  addClientForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const name = (app.querySelector('#client-name') as HTMLInputElement).value.trim()
    const phone = (app.querySelector('#client-phone') as HTMLInputElement).value.trim()
    const notes = (app.querySelector('#client-notes') as HTMLTextAreaElement).value.trim()
    const amount = Number((app.querySelector('#client-amount') as HTMLInputElement).value)
    const dateGiven = (app.querySelector('#client-date-given') as HTMLInputElement).value
    if (!name || amount <= 0) return
    const client = await addClient({ name, phone, notes })
    await addLoan({ clientId: client.id, amount, dateGiven, notes: '' })
    showToast(`${client.name} added with ${formatCurrency(amount)}`)
    navigate('client-detail', client.id)
  })

  const dateGivenInput = app.querySelector<HTMLInputElement>('#client-date-given')
  dateGivenInput?.addEventListener('change', () => {
    const fromEl = app.querySelector('#period-from')
    const toEl = app.querySelector('#period-to')
    if (fromEl && toEl && dateGivenInput.value) {
      fromEl.textContent = formatDate(dateGivenInput.value)
      toEl.textContent = formatDate(getDueDate(dateGivenInput.value))
    }
  })

  const addLoanForm = app.querySelector<HTMLFormElement>('#add-loan-form')
  addLoanForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    if (!state.selectedClientId) return
    const amount = Number((app.querySelector('#loan-amount') as HTMLInputElement).value)
    const dateGiven = (app.querySelector('#loan-date') as HTMLInputElement).value
    const notes = (app.querySelector('#loan-notes') as HTMLTextAreaElement).value.trim()
    if (amount <= 0) return
    await addLoan({ clientId: state.selectedClientId, amount, dateGiven, notes })
    showToast(`${formatCurrency(amount)} added to account`)
    navigate('client-detail')
  })

  const repayForm = app.querySelector<HTMLFormElement>('#repay-form')
  repayForm?.addEventListener('submit', async (e) => {
    e.preventDefault()
    const loanId = repayForm.dataset.loan
    if (!loanId) return
    const amount = Number((app.querySelector('#repay-amount') as HTMLInputElement).value)
    if (amount <= 0) return
    await recordRepayment(loanId, amount)
    showToast(`${formatCurrency(amount)} repayment recorded`)
    repayLoanId = null
    navigate('client-detail')
  })
}

export function initApp() {
  initVoice({
    getContext: () => ({
      lastClientId: state.lastVoiceClientId,
      selectedClientId: state.selectedClientId,
    }),
    onResult: (message, success, clientId) => {
      showToast(message, success ? 'success' : 'error')
      if (clientId) {
        state.lastVoiceClientId = clientId
        state.selectedClientId = clientId
      }
    },
    onRefresh: () => {
      render()
    },
  })
  render()
}
