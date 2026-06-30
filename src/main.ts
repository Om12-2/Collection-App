import './style.css'
import { initApp } from './app'
import { registerSW } from 'virtual:pwa-register'

initApp()

registerSW({
  onNeedRefresh() {
    if (confirm('A new version is available. Reload to update?')) {
      window.location.reload()
    }
  },
  onOfflineReady() {
    console.log('App ready to work offline')
  },
})
