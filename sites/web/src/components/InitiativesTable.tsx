import { Plus, Trash2 } from 'lucide-react'
import type { CJMDocument, Initiative, InitiativeType } from '../types'
import { uid } from '../types'

type Binding = { id: string; label: string }
const initiativeTypes: InitiativeType[] = ['Live', 'Future', 'Gap', 'MVP1', 'MVP2', 'MVP3']

export function InitiativesTable({ document, companyName, onChange }: { document: CJMDocument; companyName: string; onChange: (document: CJMDocument) => void }) {
  const steps = new Map<string, Binding>()
  const actions = new Map<string, Binding>()

  const updateInitiative = (id: string, update: Partial<Pick<Initiative, 'type' | 'name' | 'description'>>) => {
    const draft = structuredClone(document)
    const initiative = draft.initiatives.find((item) => item.id === id)
    if (!initiative) return
    Object.assign(initiative, update)
    onChange(draft)
  }

  const addInitiative = () => {
    const draft = structuredClone(document)
    draft.initiatives.push({ id: uid(), companyId: draft.companyId, type: 'Live', name: 'Новая инициатива', description: '' })
    onChange(draft)
  }

  const deleteInitiative = (id: string, name: string) => {
    if (!confirm(`Удалить инициативу «${name}»? Все её привязки также будут удалены.`)) return
    const draft = structuredClone(document)
    draft.initiatives = draft.initiatives.filter((item) => item.id !== id)
    draft.initiativeLinks = draft.initiativeLinks.filter((link) => link.initiativeId !== id)
    draft.deletedInitiativeIds = [...new Set([...(draft.deletedInitiativeIds ?? []), id])]
    onChange(draft)
  }

  document.stages.forEach((stage, stageIndex) => {
    stage.steps.forEach((step, stepIndex) => {
      const stepNumber = `${stageIndex + 1}.${stepIndex + 1}`
      steps.set(step.id, { id: step.id, label: `${stepNumber} · ${step.name}` })
      step.actions.forEach((action, actionIndex) => actions.set(action.id, {
        id: action.id,
        label: `${stepNumber}.${actionIndex + 1} · ${action.name}`,
      }))
    })
  })

  return <section className="panel initiatives-panel">
    <div className="panel-head"><div><h2>Инициативы</h2><span className="subtext">Все инициативы текущего CJM и их привязки · {document.initiatives.length}</span></div><button className="button" type="button" onClick={addInitiative}><Plus size={16} />Добавить инициативу</button></div>
    <div className="initiatives-table-wrap">
      <table className="initiatives-table">
        <thead><tr><th>Тип</th><th>Наименование</th><th>Описание</th><th>Компания</th><th>Связанные шаги</th><th>Связанные действия</th><th aria-label="Действия" /></tr></thead>
        <tbody>{document.initiatives.map((initiative) => {
          const links = document.initiativeLinks.filter((link) => link.initiativeId === initiative.id)
          const linkedSteps = uniqueBindings(links.map((link) => steps.get(link.stepId)).filter((item): item is Binding => Boolean(item)))
          const linkedActions = uniqueBindings(links.map((link) => link.actionId ? actions.get(link.actionId) : undefined).filter((item): item is Binding => Boolean(item)))
          return <tr key={initiative.id}>
            <td><select className={`initiative-type-select type-${initiative.type.toLowerCase()}`} aria-label={`Тип инициативы ${initiative.name}`} value={initiative.type} onChange={(event) => updateInitiative(initiative.id, { type: event.target.value as InitiativeType })}>{initiativeTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></td>
            <td><input className="initiative-name-edit" aria-label={`Наименование инициативы ${initiative.name}`} value={initiative.name} onChange={(event) => updateInitiative(initiative.id, { name: event.target.value })} /></td>
            <td><textarea className="initiative-description-edit" aria-label={`Описание инициативы ${initiative.name}`} value={initiative.description} placeholder="Описание не указано" onChange={(event) => updateInitiative(initiative.id, { description: event.target.value })} /></td>
            <td>{companyName}</td>
            <td><BindingList items={linkedSteps} empty="Не привязана к шагу" /></td>
            <td><BindingList items={linkedActions} empty="Не привязана к действию" /></td>
            <td><button type="button" className="icon-button danger-ghost" aria-label={`Удалить инициативу ${initiative.name}`} onClick={() => deleteInitiative(initiative.id, initiative.name)}><Trash2 size={16} /></button></td>
          </tr>
        })}</tbody>
      </table>
      {document.initiatives.length === 0 && <div className="empty-state">В этом CJM пока нет инициатив</div>}
    </div>
  </section>
}

function BindingList({ items, empty }: { items: Binding[]; empty: string }) {
  if (items.length === 0) return <span className="muted-cell">{empty}</span>
  return <div className="binding-tags">{items.map((item) => <span className="binding-tag" key={item.id}>{item.label}</span>)}</div>
}

function uniqueBindings(items: Binding[]) {
  return [...new Map(items.map((item) => [item.id, item])).values()]
}
