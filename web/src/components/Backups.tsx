import { Download, HardDrive, RotateCcw, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../api'

interface BackupsProps {
  onRestored: () => Promise<void>
}

export function Backups({ onRestored }: BackupsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  const restore = async (file?: File) => {
    if (!file) return
    if (!confirm('Текущая база будет заменена. Перед восстановлением сохраните резервную копию. Продолжить?')) return
    setBusy(true)
    try {
      const result = await api.restoreBackup(file)
      setMessage(result.message)
      await onRestored()
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <div className="page-heading"><div><h1>Резервные копии</h1><p>Перенос локальной базы между Windows и macOS</p></div></div>
      <div className="backup-grid">
        <section className="panel backup-card"><span className="feature-icon"><Download size={22} /></span><div><h2>Создать копию</h2><p>Сохраняет справочники, CJM, версии и изображения Rich Text в одном файле SQLite.</p></div><a className="button primary" href="/api/backup"><HardDrive size={17} />Скачать копию</a></section>
        <section className="panel backup-card"><span className="feature-icon"><Upload size={22} /></span><div><h2>Восстановить</h2><p>Проверяет целостность файла и заменяет текущую локальную базу.</p></div><input ref={inputRef} type="file" accept=".sqlite,.db" hidden onChange={(event) => restore(event.target.files?.[0])} /><button className="button" disabled={busy} onClick={() => inputRef.current?.click()}><RotateCcw size={17} />{busy ? 'Восстановление…' : 'Выбрать копию'}</button></section>
      </div>
      {message && <div className="notice success">{message}</div>}
    </>
  )
}

