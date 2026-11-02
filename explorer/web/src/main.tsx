import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import SideBySide from './SideBySide'
import './index.css'

// ?split=a,b shows two projects side by side, each a full explorer in its own frame
const split = new URLSearchParams(window.location.search).has('split')

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {split ? <SideBySide /> : <App />}
  </StrictMode>,
)
