import { Download, HardDrive, RotateCcw, Upload } from 'lucide-react'
import { useRef, useState } from 'react'
import { api } from '../api'
import { exportBackup, exportHtml } from '../offline'

interface BackupsProps {
  onRestored: () => Promise<void>
}

export function Backups({ onRestored }: BackupsProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const download = async (html: boolean) => {
    setBusy(true); setMessage('')
    try {
      await (html ? exportHtml() : exportBackup())
      setMessage(html ? 'HTML с сохранёнными данными сформирован. Отправьте этот файл коллеге.' : 'Копия данных сформирована.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось создать файл')
    } finally { setBusy(false) }
  }

  const restore = async (file?: File) => {
    if (!file) return
    if (!confirm('Текущая база будет заменена. Перед восстановлением сохраните резервную копию. Продолжить?')) return
    setBusy(true)
    try {
      const result = await api.restoreBackup(file)
      setMessage(result.message)
      await onRestored()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Не удалось восстановить копию')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <>
      <div className="page-heading"><div><h1>Передача файла и резервные копии</h1><p>Правки сохраняются в этом браузере. Чтобы передать их коллеге, скачайте новый HTML с данными.</p></div></div>
      <div className="backup-grid">
        <section className="panel backup-card"><span className="feature-icon"><Download size={22} /></span><div><h2>Приложение одним файлом</h2><p>Создаёт HTML с редактором, отчётами, Excel и всеми сохранёнными данными. Исходный файл автоматически не изменяется.</p></div><button className="button primary" disabled={busy} onClick={() => void download(true)}><Download size={17} />Скачать HTML</button></section>
        <section className="panel backup-card"><span className="feature-icon"><HardDrive size={22} /></span><div><h2>Копия данных</h2><p>Выгружает справочники, CJM, редакции, комментарии и изображения в JSON. Сохраните копию перед очисткой данных браузера.</p></div><button className="button" disabled={busy} onClick={() => void download(false)}><HardDrive size={17} />Скачать JSON</button></section>
        <section className="panel backup-card"><span className="feature-icon"><Upload size={22} /></span><div><h2>Загрузить данные</h2><p>Заменяет данные этой офлайн-копии содержимым JSON из CJM Studio. Онлайн-база и файлы коллег не меняются.</p></div><input ref={inputRef} type="file" accept=".json" hidden onChange={(event) => restore(event.target.files?.[0])} /><button className="button" disabled={busy} onClick={() => inputRef.current?.click()}><RotateCcw size={17} />{busy ? 'Обработка…' : 'Выбрать копию'}</button></section>
      </div>
      {message && <div className="notice success">{message}</div>}
    </>
  )
}
