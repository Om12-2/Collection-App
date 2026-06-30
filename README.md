# Collection Manager

A mobile-first Progressive Web App (PWA) for financiers to manage client loans and collections. All data is stored **locally on your device** using IndexedDB — no server or internet required for daily use.

## Features

- **Add clients** with name, phone, and notes
- **Record payments** lent to clients (e.g. ₹300 added to their account)
- **100-day repayment period** — each loan automatically gets a due date 100 days from the date given
- **Track repayments** — record partial or full repayments with progress bars
- **Dashboard** — overview of total lent, outstanding, overdue loans
- **Local storage** — database lives on your phone/device (IndexedDB)
- **PDF export** — download a full backup as PDF
- **Share backup** — send PDF to cloud storage, email, or another device via the native share sheet (on supported phones)
- **Voice commands** — speak deposits and loans hands-free (see below)
- **Installable PWA** — add to home screen on Android/iOS for app-like experience
- **Works offline** — fully functional without internet after first load

## Getting Started

```bash
npm install
npm run dev
```

Open the URL shown in your terminal (usually `http://localhost:5173`).

### Install on Phone

1. Run `npm run build` and serve the `dist` folder, or deploy to any static host
2. Open the URL on your phone's browser
3. **Android (Chrome):** Menu → "Add to Home screen" / "Install app"
4. **iPhone (Safari):** Share → "Add to Home Screen"

## Usage

1. **Add a client** from the Home screen or Clients tab
2. Open the client and tap **"Add Payment to Account"** to record an amount you lent them
3. The app sets the due date automatically (100 days from the loan date)
4. Tap **"Record Repayment"** when the client pays you back
5. Use **Export PDF** or **Share Backup** on the dashboard to create a backup you can save to Google Drive, email, or transfer to a PC

## Voice Commands

Tap the **🎤 Voice Commands** bar at the bottom, then tap the microphone and speak:

| Say this | Action |
|---|---|
| "Ramesh deposited 300" | Records ₹300 repayment from Ramesh |
| "Ok, he has deposited 300" | Records repayment for the currently selected client |
| "Suresh paid 500" | Records ₹500 repayment from Suresh |
| "Lent 1000 to Suresh" | Adds ₹1000 loan to Suresh's account (100-day due date) |
| "Client ID abc... paid 200" | Repayment matched by client ID |

The app speaks back to confirm what it did. Works best in **Chrome on Android** or desktop (requires microphone permission).

## Build for Production

```bash
npm run build
npm run preview
```

The built files are in the `dist/` folder — deploy to any static hosting (Netlify, Vercel, GitHub Pages, or serve locally).

## Tech Stack

- Vite + TypeScript
- Dexie (IndexedDB wrapper)
- jsPDF + jspdf-autotable (PDF export)
- vite-plugin-pwa (offline support & installability)
