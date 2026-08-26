import { ArrowRight, Plus, Search, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { Bootstrap, CJMSummary } from '../types'

interface RegistryProps {
  data: Bootstrap
  onOpen: (id: string) => void
  onCreate: (input: { name: string; companyId: string; actorId: string }) => Promise<void>
  onDelete: (item: CJMSummary) => Promise<void>
}

export function Registry({ data, onOpen, onCreate, onDelete }: RegistryProps) {
  const [query, setQuery] = useState('')
  const [companyId, setCompanyId] = useState('')
  const [actorId, setActorId] = useState('')
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [newCompany, setNewCompany] = useState(data.companies[0]?.id ?? '')
  const actors = data.actors.filter((item) => !newCompany || item.companyId === newCompany)
  const [newActor, setNewActor] = useState(actors[0]?.id ?? '')
  const companyNames = useMemo(() => new Map(data.companies.map((item) => [item.id, item.name])), [data.companies])

  const filtered = useMemo(() => data.cjms.filter((item) => {
    return (!query || item.name.toLocaleLowerCase().includes(query.toLocaleLowerCase()))
      && (!companyId || item.companyId === companyId)
      && (!actorId || item.actorId === actorId)
  }), [actorId, companyId, data.cjms, query])

  const startCreate = () => {
    const company = data.companies[0]?.id ?? ''
    const actor = data.actors.find((item) => item.companyId === company)?.id ?? ''
    setNewCompany(company)
    setNewActor(actor)
    setName('')
    setCreating(true)
  }

  const submit = async () => {
    await onCreate({ name, companyId: newCompany, actorId: newActor })
    setCreating(false)
  }

  return (
    <>
      <div className="page-heading"><div><h1>Карты клиентских путей</h1><p>Все CJM компаний и акторов</p></div><button className="button primary" onClick={startCreate}><Plus size={17} />Новая CJM</button></div>
      <section className="panel filter-panel">
        <label className="field search-field"><span>Поиск</span><span className="input-with-icon"><Search size={16} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Название CJM" /></span></label>
        <label className="field"><span>Компания</span><select value={companyId} onChange={(event) => { setCompanyId(event.target.value); setActorId('') }}><option value="">Все компании</option>{data.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Актор</span><select value={actorId} onChange={(event) => setActorId(event.target.value)}><option value="">Все акторы</option>{data.actors.filter((item) => !companyId || item.companyId === companyId).map((item) => <option key={item.id} value={item.id}>{item.name} — {companyNames.get(item.companyId ?? '') ?? 'Компания не указана'}</option>)}</select></label>
      </section>
      <section className="panel table-panel">
        <table><thead><tr><th>Название</th><th>Компания</th><th>Актор</th><th>Редакция</th><th>Обновлено</th><th aria-label="Действия" /></tr></thead><tbody>
          {filtered.map((item) => <tr key={item.id}><td><button className="name-link" onClick={() => onOpen(item.id)}>{item.name}</button><span className="subtext">{item.stageCount} стадий · {item.stepCount} шагов</span></td><td>{item.companyName}</td><td>{item.actorName}</td><td><span className="badge">v{item.revision}</span></td><td>{new Date(item.updatedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</td><td><div className="row-actions"><button className="icon-button danger-ghost" aria-label="Удалить CJM" onClick={() => onDelete(item)}><Trash2 size={16} /></button><button className="icon-button" aria-label="Открыть CJM" onClick={() => onOpen(item.id)}><ArrowRight size={16} /></button></div></td></tr>)}
          {filtered.length === 0 && <tr><td colSpan={6} className="empty-cell">CJM не найдены</td></tr>}
        </tbody></table>
      </section>

      {creating && <div className="modal-backdrop" role="presentation"><section className="modal" role="dialog" aria-modal="true" aria-labelledby="new-cjm-title"><div className="modal-head"><h2 id="new-cjm-title">Новая CJM</h2><button className="icon-button" aria-label="Закрыть" onClick={() => setCreating(false)}>×</button></div><div className="modal-body">
        <label className="field"><span>Название</span><input autoFocus value={name} onChange={(event) => setName(event.target.value)} placeholder="Например, открытие нового магазина" /></label>
        <label className="field"><span>Компания</span><select value={newCompany} onChange={(event) => { const company = event.target.value; setNewCompany(company); setNewActor(data.actors.find((item) => item.companyId === company)?.id ?? '') }}>{data.companies.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
        <label className="field"><span>Актор</span><select value={newActor} onChange={(event) => setNewActor(event.target.value)}>{data.actors.filter((item) => item.companyId === newCompany).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
      </div><div className="modal-actions"><button className="button" onClick={() => setCreating(false)}>Отмена</button><button className="button primary" disabled={!name.trim() || !newCompany || !newActor} onClick={submit}>Создать</button></div></section></div>}
    </>
  )
}
