import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import './styles.css'
import { applyDesign, recallDesign } from './theme/applyDesign.js'

// Vor dem ersten Rendern: Wer das Event schon einmal geöffnet hat, sieht sofort dessen Farben.
applyDesign(recallDesign())

const container = document.getElementById('root')
if (!container) throw new Error('#root fehlt in index.html')

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
