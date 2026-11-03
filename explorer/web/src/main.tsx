import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'

// the first side-by-side links (?split=a,b) open the one-window pair (?project=a&pair=b, pair.ts)
const q = new URLSearchParams(window.location.search)
const split = q.get('split')
if (split) {
  const [a, b] = split.split(',')
  q.delete('split')
  if (a) q.set('project', a)
  if (b) q.set('pair', b)
  window.history.replaceState(null, '', `${window.location.pathname}?${q.toString()}`)
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
