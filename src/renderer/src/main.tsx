import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import { RecordingPill } from './RecordingPill'
import { ResultPanel } from './ResultPanel'
import './styles.css'

const root = document.getElementById('root')

if (!root) {
  throw new Error('Missing #root element')
}

// The pill is a second window over the same bundle. It must never mount <App/>:
// App starts a capture controller and subscribes to session state, and a second
// one in the overlay would hold the microphone and fight the main window.
const params = new URLSearchParams(window.location.search)
const overlayMode = params.has('overlay')
const panelMode = params.has('panel')
if (overlayMode) document.documentElement.dataset.overlay = '1'
if (panelMode) document.documentElement.dataset.panel = '1'

createRoot(root).render(
  <React.StrictMode>
    {overlayMode ? <RecordingPill /> : panelMode ? <ResultPanel /> : <App />}
  </React.StrictMode>
)
