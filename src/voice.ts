import { getExampleCommands, processVoiceCommand, type VoiceContext } from './voice-commands'

interface SpeechRecognitionEvent extends Event {
  results: SpeechRecognitionResultList
  resultIndex: number
}

interface SpeechRecognitionInstance extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  start(): void
  stop(): void
  onresult: ((event: SpeechRecognitionEvent) => void) | null
  onerror: ((event: Event & { error: string }) => void) | null
  onend: (() => void) | null
}

export interface VoiceCallbacks {
  getContext: () => VoiceContext
  onResult: (message: string, success: boolean, clientId?: string) => void
  onRefresh: () => void
}

let recognition: SpeechRecognitionInstance | null = null
let isListening = false
let callbacks: VoiceCallbacks | null = null

function getSpeechRecognition(): SpeechRecognitionInstance | null {
  const w = window as Window & {
    SpeechRecognition?: new () => SpeechRecognitionInstance
    webkitSpeechRecognition?: new () => SpeechRecognitionInstance
  }
  const Ctor = w.SpeechRecognition ?? w.webkitSpeechRecognition
  return Ctor ? new Ctor() : null
}

function speak(text: string) {
  if (!('speechSynthesis' in window)) return
  window.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.rate = 1
  utterance.pitch = 1
  window.speechSynthesis.speak(utterance)
}

function updatePanel(status: string, transcript = '') {
  const statusEl = document.querySelector('#voice-status')
  const transcriptEl = document.querySelector('#voice-transcript')
  const micBtn = document.querySelector('#voice-mic-btn')
  if (statusEl) statusEl.textContent = status
  if (transcriptEl) transcriptEl.textContent = transcript
  micBtn?.classList.toggle('listening', isListening)
}

async function handleTranscript(transcript: string) {
  if (!callbacks) return
  updatePanel('Processing...', `"${transcript}"`)

  try {
    const result = await processVoiceCommand(transcript, callbacks.getContext())
    callbacks.onResult(result.message, result.success, result.clientId)
    speak(result.message)
    if (result.success) {
      callbacks.onRefresh()
    }
  } catch {
    const msg = 'Something went wrong. Please try again.'
    callbacks.onResult(msg, false)
    speak(msg)
  }

  updatePanel('Tap mic to speak', '')
}

function startListening() {
  if (!recognition || isListening) return

  isListening = true
  updatePanel('Listening...', 'Say a command')

  recognition.onresult = (event: SpeechRecognitionEvent) => {
    const last = event.results[event.results.length - 1]
    const transcript = last[0].transcript.trim()
    if (last.isFinal && transcript) {
      recognition?.stop()
      void handleTranscript(transcript)
    } else if (transcript) {
      updatePanel('Listening...', transcript)
    }
  }

  recognition.onerror = (event) => {
    isListening = false
    const err = (event as Event & { error: string }).error
    if (err === 'not-allowed') {
      updatePanel('Microphone permission denied', '')
      callbacks?.onResult('Please allow microphone access to use voice commands.', false)
    } else if (err !== 'aborted') {
      updatePanel('Could not hear you. Tap to retry.', '')
    }
  }

  recognition.onend = () => {
    isListening = false
    document.querySelector('#voice-mic-btn')?.classList.remove('listening')
    const transcript = document.querySelector('#voice-transcript')?.textContent
    if (!transcript) {
      updatePanel('Tap mic to speak', '')
    }
  }

  try {
    recognition.start()
  } catch {
    isListening = false
    updatePanel('Tap mic to speak', '')
  }
}

function stopListening() {
  if (recognition && isListening) {
    recognition.stop()
    isListening = false
    updatePanel('Tap mic to speak', '')
  }
}

function renderVoiceUI(supported: boolean) {
  if (document.getElementById('voice-ui')) return

  const container = document.createElement('div')
  container.id = 'voice-ui'
  container.innerHTML = `
    <div id="voice-panel" class="voice-panel collapsed ${supported ? '' : 'unsupported'}">
      <div class="voice-panel-header">
        <span class="voice-panel-title">🎤 Voice Commands</span>
        <button id="voice-panel-toggle" class="voice-panel-toggle" aria-label="Toggle voice panel">▲</button>
      </div>
      <div id="voice-panel-body" class="voice-panel-body">
        ${
          supported
            ? `
          <p id="voice-status" class="voice-status">Tap mic to speak</p>
          <p id="voice-transcript" class="voice-transcript"></p>
          <ul class="voice-examples">
            ${getExampleCommands().map((ex) => `<li>${ex}</li>`).join('')}
          </ul>
        `
            : '<p class="voice-unsupported">Voice commands need Chrome or Edge on Android/desktop. Microphone required.</p>'
        }
      </div>
      ${
        supported
          ? '<button id="voice-mic-btn" class="voice-mic-btn" aria-label="Start voice command">🎤</button>'
          : ''
      }
    </div>
  `
  document.body.appendChild(container)

  document.getElementById('voice-panel-toggle')?.addEventListener('click', () => {
    const panel = document.getElementById('voice-panel')
    panel?.classList.toggle('collapsed')
    const btn = document.getElementById('voice-panel-toggle')
    if (btn) btn.textContent = panel?.classList.contains('collapsed') ? '▲' : '▼'
  })

  document.querySelector('.voice-panel-header')?.addEventListener('click', (e) => {
    if ((e.target as HTMLElement).closest('#voice-panel-toggle')) return
    document.getElementById('voice-panel')?.classList.toggle('collapsed')
    const panel = document.getElementById('voice-panel')
    const btn = document.getElementById('voice-panel-toggle')
    if (btn) btn.textContent = panel?.classList.contains('collapsed') ? '▲' : '▼'
  })

  document.getElementById('voice-mic-btn')?.addEventListener('click', () => {
    if (isListening) {
      stopListening()
    } else {
      startListening()
    }
  })
}

export function initVoice(cb: VoiceCallbacks) {
  callbacks = cb
  recognition = getSpeechRecognition()
  const supported = recognition !== null
  renderVoiceUI(supported)

  if (supported && recognition) {
    recognition.continuous = false
    recognition.interimResults = true
    recognition.lang = 'en-IN'
  }
}
