import { Pencil, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import type { Bootstrap, DirectoryKind, DirectoryRecord } from '../types'

const labels: Record<DirectoryKind, string> = {
  companies: 'Компании',
  actors: 'Акторы',
  participants: 'Участники процесса',
  systems: 'Информационные системы',
}

interface DirectoriesProps {
  data: Bootstrap
  onCreate: (kind: DirectoryKind, record: Omit<DirectoryRecord, 'id'>) => Promise<void>
  onUpdate: (kind: DirectoryKind, record: DirectoryRecord) => Promise<void>
  onDelete: (kind: DirectoryKind, record: DirectoryRecord) => Promise<void>
}

export function Directories({ data, onCreate, onUpdate, onDelete }: DirectoriesProps) {
  const [kind, setKind] = useState<DirectoryKind>('companies')
  const [editing, setEditing] = useState<DirectoryRecord | null>(null)
  const [open, setOpen] = useState(false)
  const items = data[kind]

  const begin = (item?: DirectoryRecord) => {
    setEditing(item ? { ...item } : { id: '', companyId: kind === 'companies' ? undefined : data.companies[0]?.id, code: '', name: '', description: '' })
    setOpen(true)
  }

  const submit = async () => {
    if (!editing) return
    if (editing.id) await onUpdate(kind, editing)
    else {
      await onCreate(kind, {
        companyId: editing.companyId,
        code: editing.code,
        name: editing.name,
        description: editing.description,
      })
    }
    setOpen(false)
  }

  return (
    <>
      <div className="page-heading"><div><h1>Справочники</h1><p>Данные компаний, акторов, участников и систем</p></div><button className="button primary" onClick={() => begin()}><Plus size={17} />Добавить</button></div>
      <div className="subtabs" role="tablist">{(Object.keys(labels) as DirectoryKind[]).map((item) => <button key={item} className={kind === item ? 'active' : ''} onClick={() => setKind(item)}>{labels[item]}</button>)}</div>
      <section className="panel table-panel"><table><thead><tr><th>{kind === 'companies' ? '№ БЕ' : 'ID'}</th>{kind !== 'companies' && <th>Компания</th>}<th>Наименование</th><th>Описание</th><th aria-label="Действия" /></tr></thead><tbody>
        {items.map((item) => <tr key={item.id}><td>{item.code}</td>{kind !== 'companies' && <td>{data.companies.find((company) => company.id === item.companyId)?.name}</td>}<td className="medium-text">{item.name}</td><td className="muted-cell">{item.description || '—'}</td><td><div className="row-actions"><button className="icon-button" aria-label="Редактировать" onClick={() => begin(item)}><Pencil size={16} /></button><button className="icon-button danger-ghost" aria-label="Удалить" onClick={() => onDelete(kind, item)}><Trash2 size={16} /></button></div></td></tr>)}
      </tbody></table></section>
      {open && editing && <div className="modal-backdrop"><section className="modal" role="dialog" aria-modal="true"><div className="modal-head"><h2>{editing.id ? 'Редактирование' : 'Новая запись'}</h2><button className="icon-button" onClick={() => setOpen(false)} aria-label="Закрыть">×</button></div><div className="modal-body">
        {kind !== 'companies' && <label className="field"><span>Компания</span><select value={editing.companyId} onChange={(event) => setEditing({ ...editing, companyId: event.target.value })}>{data.companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>}
        {kind === 'companies' && <label className="field"><span>№ БЕ</span><input value={editing.code} onChange={(event) => setEditing({ ...editing, code: event.target.value })} /></label>}
        {kind !== 'companies' && (editing.id
          ? <label className="field"><span>ID</span><input value={editing.code} readOnly aria-readonly="true" /></label>
          : <div className="auto-id-note"><strong>ID</strong><span>Будет сформирован автоматически после сохранения</span></div>)}
        <label className="field"><span>Наименование</span><input value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></label>
        {kind !== 'companies' && <label className="field"><span>Описание</span><textarea value={editing.description} onChange={(event) => setEditing({ ...editing, description: event.target.value })} /></label>}
      </div><div className="modal-actions"><button className="button" onClick={() => setOpen(false)}>Отмена</button><button className="button primary" disabled={!editing.name.trim() || (kind === 'companies' && !editing.code.trim())} onClick={submit}>Сохранить</button></div></section></div>}
    </>
  )
}
