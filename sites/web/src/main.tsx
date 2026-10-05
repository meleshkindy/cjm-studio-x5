import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ListTree } from 'lucide-react'
import '@xyflow/react/dist/style.css'
import './styles.css'
import App from './App'
import { initializeAuth } from './auth'
import { api } from './api'

const root = createRoot(document.getElementById('root')!)

void initializeAuth().then((auth) => {
  if (!auth.user) {
    root.render(<div className="auth-screen"><section className="panel auth-card"><span className="brand-mark"><ListTree size={20} /></span><h1>CJM Studio</h1><p>Войдите с корпоративной учётной записью X5, чтобы продолжить работу.</p><button className="button primary" onClick={() => void auth.login()}>Войти через X5</button>{auth.config.restorePasswordUrl && <a className="button" href={auth.config.restorePasswordUrl} target="_blank" rel="noreferrer">Восстановить пароль</a>}</section></div>)
    return
  }
  api.setTokenProvider(auth.token)
  root.render(<StrictMode><App auth={{ ...auth, user: auth.user }} /></StrictMode>)
}).catch(async (reason: unknown) => {
  const message = reason instanceof Error ? reason.message : 'Не удалось запустить авторизацию'
  const config = await fetch('/api/auth/config').then((response) => response.json()).catch(() => undefined)
  root.render(<div className="boot-screen"><span className="brand-mark">!</span><h1>Не удалось войти</h1><p>{message}</p><button className="button primary" onClick={() => window.location.reload()}>Повторить</button>{config?.restorePasswordUrl && <a className="button" href={config.restorePasswordUrl} target="_blank" rel="noreferrer">Восстановить пароль</a>}</div>)
})
