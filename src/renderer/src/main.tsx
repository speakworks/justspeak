import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RecordingPill } from './RecordingPill'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing #root element')
}

// The pill is a second window over the same bundle. It must never mount <App/>:
// App starts a capture controller and subscribes to session state, and a second
// one in the overlay would hold the microphone and fight the main window.
const overlayMode = new URLSearchParams(window.location.search).has('overlay')
if (overlayMode) document.documentElement.dataset.overlay = '1'

createRoot(root).render(
  <React.StrictMode>{overlayMode ? <RecordingPill /> : <App />}</React.StrictMode>
)
