import { Save, ShieldCheck, UserRound } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { AppUser, Bootstrap } from '../types'

export function UsersAdmin({ data }: { data: Bootstrap }) {
  const [users, setUsers] = useState<AppUser[]>([])
  const [selectedSubject, setSelectedSubject] = useState('')
  const [companyIds, setCompanyIds] = useState<string[]>([])
  const [cjmIds, setCjmIds] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')

  const load = async () => {
    const items = await api.users()
    setUsers(items)
    setSelectedSubject((current) => current || items[0]?.subject || '')
  }
  useEffect(() => { void load().catch((reason: unknown) => setError(reason instanceof Error ? reason.message : 'Не удалось загрузить пользователей')) }, [])

  const selected = useMemo(() => users.find((item) => item.subject === selectedSubject), [selectedSubject, users])
  useEffect(() => {
    setCompanyIds(selected?.companyIds ?? [])
    setCjmIds(selected?.cjmIds ?? [])
    setMessage('')
  }, [selected])

  const toggle = (values: string[], id: string, checked: boolean) => checked ? [...new Set([...values, id])] : values.filter((item) => item !== id)
  const save = async () => {
    if (!selected) return
    setBusy(true); setError(''); setMessage('')
    try {
      const updated = await api.updateUserAccess(selected.subject, companyIds, cjmIds)
      setUsers((items) => items.map((item) => item.subject === updated.subject ? updated : item))
      setMessage('Доступ пользователя сохранён')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось сохранить доступ')
    } finally { setBusy(false) }
  }

  return <>
    <div className="page-heading"><div><h1>Пользователи</h1><p>Роли поступают из Keycloak; здесь назначается доступ к данным</p></div></div>
    {error && <div className="notice error"><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
    {message && <div className="notice success"><span>{message}</span><button onClick={() => setMessage('')}>×</button></div>}
    <div className="users-layout">
      <section className="panel users-list"><div className="panel-head"><div><h2>Учетные записи</h2><span>Появляются после первого входа</span></div></div>{users.map((user) => <button type="button" key={user.subject} className={user.subject === selectedSubject ? 'user-row active' : 'user-row'} onClick={() => setSelectedSubject(user.subject)}><span className="user-row-icon"><UserRound size={18} /></span><span><strong>{user.displayName}</strong><small>{user.email || user.username || user.subject}</small></span><span className={`role-badge role-${user.role}`}>{roleLabel(user.role)}</span></button>)}{users.length === 0 && <div className="empty-state">Пользователи ещё не входили в приложение</div>}</section>
      <section className="panel access-editor"><div className="panel-head"><div><h2>Область доступа</h2><span>{selected ? selected.displayName : 'Выберите пользователя'}</span></div>{selected && <span className={`role-badge role-${selected.role}`}><ShieldCheck size={14} />{roleLabel(selected.role)}</span>}</div>{selected && <div className="access-body">{selected.role === 'admin' && <p className="access-note">Администратор имеет доступ ко всем данным независимо от назначений ниже.</p>}<fieldset className="access-group"><legend>Компании</legend><p>Доступ ко всем текущим и будущим CJM выбранной компании.</p>{data.companies.map((company) => <label key={company.id}><input type="checkbox" checked={companyIds.includes(company.id)} onChange={(event) => setCompanyIds((items) => toggle(items, company.id, event.target.checked))} /><span>{company.name}</span></label>)}</fieldset><fieldset className="access-group"><legend>Отдельные CJM</legend><p>Можно назначить карту без предоставления доступа ко всей компании.</p>{data.cjms.map((cjm) => <label key={cjm.id}><input type="checkbox" checked={cjmIds.includes(cjm.id)} onChange={(event) => setCjmIds((items) => toggle(items, cjm.id, event.target.checked))} /><span>{cjm.name}<small>{cjm.companyName}</small></span></label>)}</fieldset><div className="access-actions"><button className="button primary" disabled={busy} onClick={() => void save()}><Save size={16} />{busy ? 'Сохранение…' : 'Сохранить доступ'}</button></div></div>}</section>
    </div>
  </>
}

function roleLabel(role: AppUser['role']) {
  return ({ admin: 'Администратор', editor: 'Редактор', viewer: 'Просмотр' } as const)[role]
}
