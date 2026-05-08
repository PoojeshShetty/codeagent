import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { TauriProvider } from './context/TauriContext.tsx'
import { ModelProvider } from './context/ModelContext.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TauriProvider>
      <ModelProvider>
        <App />
      </ModelProvider>
    </TauriProvider>
  </StrictMode>,
)
