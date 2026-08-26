import { ArrowLeft, GitCompareArrows, Lightbulb, ListTree, Map, Redo2, Save, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { ApiError, api } from './api'
import { Backups } from './components/Backups'
import { CjmMap } from './components/CjmMap'
import { Directories } from './components/Directories'
import { StructureEditor } from './components/Editor'
import { InitiativesTable } from './components/InitiativesTable'
import { Layout, type AppSection } from './components/Layout'
import { Registry } from './components/Registry'
import { Versions } from './components/Versions'
import { UsersAdmin } from './components/UsersAdmin'
import type { AuthController } from './auth'
import type { Bootstrap, CJMDocument, CJMSummary, DirectoryKind, DirectoryRecord } from './types'

type CJMTab = 'structure' | 'map' | 'initiatives' | 'versions'

export default function App({ auth }: { auth: AuthController & { user: NonNullable<AuthController['user']> } }) {
  const [section, setSection] = useState<AppSection>('cjms')
  const [bootstrap, setBootstrap] = useState<Bootstrap | null>(null)
  const [document, setDocument] = useState<CJMDocument | null>(null)
  const [tab, setTab] = useState<CJMTab>('map')
  const [undoStack, setUndoStack] = useState<CJMDocument[]>([])
  const [redoStack, setRedoStack] = useState<CJMDocument[]>([])
  const [dirty, setDirty] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const canEdit = auth.user.role === 'admin' || auth.user.role === 'editor'
  const isAdmin = auth.user.role === 'admin'
  const canCreateCJM = isAdmin || (auth.user.role === 'editor' && auth.user.companyIds.length > 0)

  const loadBootstrap = async () => {
    const data = await api.bootstrap()
    setBootstrap(data)
  }

  useEffect(() => { void loadBootstrap().catch(handleError) }, [])

  const handleError = (reason: unknown) => {
    const message = reason instanceof ApiError || reason instanceof Error ? reason.message : 'Неизвестная ошибка'
    setError(message)
    setBusy(false)
  }

  const run = async (operation: () => Promise<void>) => {
    setError(''); setNotice(''); setBusy(true)
    try { await operation() } catch (reason) { handleError(reason) } finally { setBusy(false) }
  }

  const openCJM = async (id: string) => run(async () => {
    const loaded = await api.getCJM(id)
    setDocument(loaded); setTab('map'); setUndoStack([]); setRedoStack([]); setDirty(false)
  })

  const commit = (next: CJMDocument) => {
    if (!document || !canEdit) return
    setUndoStack((items) => [...items.slice(-49), structuredClone(document)])
    setRedoStack([])
    setDocument(next)
    setDirty(true)
  }

  const undo = () => {
    if (!document || undoStack.length === 0) return
    const previous = undoStack[undoStack.length - 1]
    setUndoStack((items) => items.slice(0, -1)); setRedoStack((items) => [...items, structuredClone(document)]); setDocument(previous); setDirty(true)
  }

  const redo = () => {
    if (!document || redoStack.length === 0) return
    const next = redoStack[redoStack.length - 1]
    setRedoStack((items) => items.slice(0, -1)); setUndoStack((items) => [...items, structuredClone(document)]); setDocument(next); setDirty(true)
  }

  const save = async () => {
    if (!document) return
    await run(async () => {
      const saved = await api.saveCJM(document)
      setDocument(saved); setDirty(false); setNotice('Изменения сохранены'); await loadBootstrap()
    })
  }

  const closeCJM = () => {
    if (dirty && !confirm('Есть несохранённые изменения. Выйти без сохранения?')) return
    setDocument(null); setUndoStack([]); setRedoStack([]); setDirty(false); void loadBootstrap()
  }

  if (!bootstrap) return <div className="boot-screen"><span className="brand-mark"><ListTree size={22} /></span><p>{error || 'Загрузка CJM Studio…'}</p></div>

  return <Layout section={section} user={auth.user} authenticationEnabled={auth.config.enabled} restorePasswordUrl={auth.config.restorePasswordUrl} onLogout={() => { void auth.logout() }} onSection={(next) => { if (document && dirty && !confirm('Есть несохранённые изменения. Перейти без сохранения?')) return; setSection(next); setDocument(null); setDirty(false) }}>
    {error && <div className="notice error"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть">×</button></div>}
    {notice && <div className="notice success"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Закрыть">×</button></div>}

    {section === 'cjms' && !document && <Registry data={bootstrap} canCreate={canCreateCJM} canDelete={isAdmin} onOpen={openCJM} onCreate={async (input) => run(async () => { const created = await api.createCJM(input); await loadBootstrap(); setDocument(created); setTab('map'); setDirty(false) })} onDelete={async (item: CJMSummary) => { if (!confirm(`Удалить CJM «${item.name}»?`)) return; await run(async () => { await api.deleteCJM(item.id); await loadBootstrap() }) }} />}

    {section === 'cjms' && document && <div className="workspace">
      <div className="workspace-head"><button className="button ghost" onClick={closeCJM}><ArrowLeft size={16} />К реестру</button><div className="workspace-title"><input aria-label="Название CJM" readOnly={!canEdit} size={Math.min(Math.max(document.name.length + 1, 18), 55)} value={document.name} onChange={(event) => commit({ ...document, name: event.target.value })} /><span>— {bootstrap.companies.find((item) => item.id === document.companyId)?.name} · {bootstrap.actors.find((item) => item.id === document.actorId)?.name ?? 'Актор не указан'}</span></div>{canEdit && <div className="workspace-actions"><button className="icon-button" disabled={!undoStack.length || busy} onClick={undo} aria-label="Отменить"><Undo2 size={17} /></button><button className="icon-button" disabled={!redoStack.length || busy} onClick={redo} aria-label="Повторить"><Redo2 size={17} /></button><span className={dirty ? 'save-state dirty' : 'save-state'}>{dirty ? 'Есть изменения' : 'Сохранено'}</span><button className="button primary" disabled={!dirty || busy || !document.name.trim()} onClick={save}><Save size={16} />{busy ? 'Сохранение…' : 'Сохранить'}</button></div>}</div>
      <div className="workspace-tabs" role="tablist"><button className={tab === 'map' ? 'active' : ''} onClick={() => setTab('map')}><Map size={16} />Карта CJM</button>{canEdit && <button className={tab === 'structure' ? 'active' : ''} onClick={() => setTab('structure')}><ListTree size={16} />Структура</button>}{canEdit && <button className={tab === 'initiatives' ? 'active' : ''} onClick={() => setTab('initiatives')}><Lightbulb size={16} />Инициативы</button>}<button className={tab === 'versions' ? 'active' : ''} onClick={() => setTab('versions')}><GitCompareArrows size={16} />Версии</button></div>
      {tab === 'structure' && <StructureEditor document={document} bootstrap={bootstrap} onChange={commit} />}
      {tab === 'map' && <CjmMap document={document} bootstrap={bootstrap} canComment={canEdit} />}
      {tab === 'initiatives' && <InitiativesTable document={document} companyName={bootstrap.companies.find((item) => item.id === document.companyId)?.name ?? document.companyId} onChange={commit} />}
      {tab === 'versions' && <Versions document={document} canEdit={canEdit} onRestored={(restored) => { setDocument(restored); setDirty(false); setUndoStack([]); setRedoStack([]); setNotice('Редакция восстановлена') }} onRevisionCreated={() => { void api.getCJM(document.id).then(setDocument); void loadBootstrap() }} />}
    </div>}

    {section === 'directories' && isAdmin && <Directories data={bootstrap} onCreate={async (kind: DirectoryKind, record: Omit<DirectoryRecord, 'id'>) => run(async () => { await api.createDirectory(kind, record); await loadBootstrap() })} onUpdate={async (kind, record) => run(async () => { await api.updateDirectory(kind, record); await loadBootstrap() })} onDelete={async (kind, record) => { if (!confirm(`Удалить «${record.name}»?`)) return; await run(async () => { await api.deleteDirectory(kind, record.id); await loadBootstrap() }) }} />}
    {section === 'users' && isAdmin && <UsersAdmin data={bootstrap} />}
    {section === 'backups' && isAdmin && <Backups onRestored={loadBootstrap} />}
  </Layout>
}
