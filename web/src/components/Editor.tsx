import { ChevronDown, ChevronRight, FolderTree, MousePointerClick, Plus, Route, Trash2, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Bootstrap, CJMAction, CJMDocument, CJMStage, CJMStep, InitiativeType, LinkType, NodeSelection } from '../types'
import { newAction, uid } from '../types'
import { RichTextEditor } from './RichTextEditor'

interface EditorProps {
  document: CJMDocument
  bootstrap: Bootstrap
  onChange: (document: CJMDocument) => void
}

interface FlatStep { stageIndex: number; stepIndex: number; stage: CJMStage; step: CJMStep; number: string }
interface ChoiceItem { id: string; label: string; toneClass?: string }

const flattenSteps = (document: CJMDocument): FlatStep[] => document.stages.flatMap((stage, stageIndex) => stage.steps.map((step, stepIndex) => ({ stageIndex, stepIndex, stage, step, number: `${stageIndex + 1}.${stepIndex + 1}` })))

function validLinkOrder(document: CJMDocument) {
  const order = new Map(flattenSteps(document).map((item, index) => [item.step.id, index]))
  return document.links.every((link) => (order.get(link.sourceId) ?? -1) < (order.get(link.targetId) ?? -1))
}

export function StructureEditor({ document, bootstrap, onChange }: EditorProps) {
  const [selected, setSelected] = useState<NodeSelection>(() => ({ kind: 'stage', stageId: document.stages[0]?.id ?? '' }))
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [dragged, setDragged] = useState<NodeSelection | null>(null)
  const [newSource, setNewSource] = useState('')
  const [newLinkType, setNewLinkType] = useState<LinkType>('main')
  const [initiativeName, setInitiativeName] = useState('')
  const [initiativeType, setInitiativeType] = useState<InitiativeType>('Gap')
  const [treeWidth, setTreeWidth] = useState(300)
  const [resizingTree, setResizingTree] = useState(false)
  const editorRef = useRef<HTMLDivElement>(null)
  const steps = useMemo(() => flattenSteps(document), [document])

  useEffect(() => {
    if (!resizingTree) return
    const previousCursor = globalThis.document.body.style.cursor
    const previousUserSelect = globalThis.document.body.style.userSelect
    globalThis.document.body.style.cursor = 'col-resize'
    globalThis.document.body.style.userSelect = 'none'
    const move = (event: PointerEvent) => {
      const rect = editorRef.current?.getBoundingClientRect()
      if (!rect) return
      const maximum = Math.max(260, Math.min(560, rect.width - 430))
      setTreeWidth(Math.max(240, Math.min(maximum, event.clientX - rect.left)))
    }
    const stop = () => setResizingTree(false)
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop, { once: true })
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      globalThis.document.body.style.cursor = previousCursor
      globalThis.document.body.style.userSelect = previousUserSelect
    }
  }, [resizingTree])

  const commit = (mutate: (draft: CJMDocument) => void) => {
    const draft = structuredClone(document)
    mutate(draft)
    draft.stages.forEach((stage, stageIndex) => {
      stage.position = stageIndex
      stage.steps.forEach((step, stepIndex) => {
        step.position = stepIndex
        step.actions.forEach((action, actionIndex) => { action.position = actionIndex })
      })
    })
    onChange(draft)
  }

  const selectionData = useMemo(() => {
    const stageIndex = document.stages.findIndex((stage) => stage.id === selected.stageId)
    const stage = document.stages[stageIndex]
    if (!stage) return null
    if (selected.kind === 'stage') return { kind: 'stage' as const, stageIndex, stage }
    const stepIndex = stage.steps.findIndex((step) => step.id === selected.stepId)
    const step = stage.steps[stepIndex]
    if (!step) return null
    if (selected.kind === 'step') return { kind: 'step' as const, stageIndex, stage, stepIndex, step }
    const actionIndex = step.actions.findIndex((action) => action.id === selected.actionId)
    const action = step.actions[actionIndex]
    if (!action) return null
    return { kind: 'action' as const, stageIndex, stage, stepIndex, step, actionIndex, action }
  }, [document.stages, selected])

  const addStage = () => commit((draft) => {
    const stage: CJMStage = { id: uid(), position: draft.stages.length, name: 'Новая стадия', description: '', steps: [] }
    draft.stages.push(stage)
    setSelected({ kind: 'stage', stageId: stage.id })
  })

  const addStep = (stageId: string) => commit((draft) => {
    const stage = draft.stages.find((item) => item.id === stageId)
    if (!stage) return
    const step: CJMStep = { id: uid(), position: stage.steps.length, name: 'Новый шаг', description: '', actions: [] }
    stage.steps.push(step)
    setCollapsed((value) => { const next = new Set(value); next.delete(stageId); return next })
    setSelected({ kind: 'step', stageId, stepId: step.id })
  })

  const addAction = (stageId: string, stepId: string) => commit((draft) => {
    const step = draft.stages.find((stage) => stage.id === stageId)?.steps.find((item) => item.id === stepId)
    if (!step) return
    const action = newAction()
    action.position = step.actions.length
    step.actions.push(action)
    setCollapsed((value) => { const next = new Set(value); next.delete(stepId); return next })
    setSelected({ kind: 'action', stageId, stepId, actionId: action.id })
  })

  const removeSelected = () => {
    if (!selectionData || !confirm('Удалить выбранный узел и его вложенные данные?')) return
    commit((draft) => {
      if (selected.kind === 'stage') {
        const stage = draft.stages.find((item) => item.id === selected.stageId)
        const stepIds = new Set(stage?.steps.map((item) => item.id) ?? [])
        const actionIds = new Set(stage?.steps.flatMap((item) => item.actions.map((action) => action.id)) ?? [])
        draft.stages = draft.stages.filter((item) => item.id !== selected.stageId)
        draft.links = draft.links.filter((link) => !stepIds.has(link.sourceId) && !stepIds.has(link.targetId))
        draft.initiativeLinks = draft.initiativeLinks.filter((link) => !stepIds.has(link.stepId) && !actionIds.has(link.actionId ?? ''))
      } else if (selected.kind === 'step') {
        const stage = draft.stages.find((item) => item.id === selected.stageId)
        const step = stage?.steps.find((item) => item.id === selected.stepId)
        const actionIds = new Set(step?.actions.map((item) => item.id) ?? [])
        if (stage) stage.steps = stage.steps.filter((item) => item.id !== selected.stepId)
        draft.links = draft.links.filter((link) => link.sourceId !== selected.stepId && link.targetId !== selected.stepId)
        draft.initiativeLinks = draft.initiativeLinks.filter((link) => link.stepId !== selected.stepId && !actionIds.has(link.actionId ?? ''))
      } else {
        const step = draft.stages.find((item) => item.id === selected.stageId)?.steps.find((item) => item.id === selected.stepId)
        if (step) step.actions = step.actions.filter((item) => item.id !== selected.actionId)
        draft.initiativeLinks = draft.initiativeLinks.filter((link) => link.actionId !== selected.actionId)
      }
    })
    const first = document.stages[0]
    if (first) setSelected({ kind: 'stage', stageId: first.id })
  }

  const reorder = (target: NodeSelection) => {
    if (!dragged || dragged.kind !== target.kind) return
    const draft = structuredClone(document)
    if (dragged.kind === 'stage' && target.kind === 'stage') {
      const from = draft.stages.findIndex((item) => item.id === dragged.stageId)
      const to = draft.stages.findIndex((item) => item.id === target.stageId)
      const [item] = draft.stages.splice(from, 1); draft.stages.splice(to, 0, item)
    } else if (dragged.kind === 'step' && target.kind === 'step' && dragged.stageId === target.stageId) {
      const stage = draft.stages.find((item) => item.id === dragged.stageId)!
      const from = stage.steps.findIndex((item) => item.id === dragged.stepId)
      const to = stage.steps.findIndex((item) => item.id === target.stepId)
      const [item] = stage.steps.splice(from, 1); stage.steps.splice(to, 0, item)
    } else if (dragged.kind === 'action' && target.kind === 'action' && dragged.stepId === target.stepId) {
      const step = draft.stages.find((item) => item.id === dragged.stageId)!.steps.find((item) => item.id === dragged.stepId)!
      const from = step.actions.findIndex((item) => item.id === dragged.actionId)
      const to = step.actions.findIndex((item) => item.id === target.actionId)
      const [item] = step.actions.splice(from, 1); step.actions.splice(to, 0, item)
    } else return
    if (!validLinkOrder(draft)) { alert('Перестановка создаёт обратную связь. Сначала измените связи между шагами.'); return }
    onChange(draft)
    setDragged(null)
  }

  return (
    <div ref={editorRef} className={`editor-grid ${resizingTree ? 'resizing' : ''}`} style={{ '--tree-panel-width': `${treeWidth}px` } as React.CSSProperties}>
      <section className="panel tree-panel">
        <div className="panel-head"><div><h2>Структура</h2><span>{document.stages.length} стадий · {steps.length} шагов</span></div><button className="icon-button" onClick={addStage} aria-label="Добавить стадию"><Plus size={17} /></button></div>
        <div className="tree" role="tree">
          {document.stages.map((stage, stageIndex) => {
            const stageCollapsed = collapsed.has(stage.id)
            const stageSelection: NodeSelection = { kind: 'stage', stageId: stage.id }
            return <div key={stage.id}>
              <TreeRow level={1} selected={selected.kind === 'stage' && selected.stageId === stage.id} draggable selection={stageSelection} onDrag={setDragged} onDrop={reorder} onSelect={() => setSelected(stageSelection)} icon={<FolderTree size={16} />} number={`${stageIndex + 1}`} label={stage.name} expander={stageCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />} onExpand={() => setCollapsed((value) => toggleSet(value, stage.id))} onAdd={() => addStep(stage.id)} />
              {!stageCollapsed && stage.steps.map((step, stepIndex) => {
                const stepCollapsed = collapsed.has(step.id)
                const stepSelection: NodeSelection = { kind: 'step', stageId: stage.id, stepId: step.id }
                return <div key={step.id}>
                  <TreeRow level={2} selected={selected.kind === 'step' && selected.stepId === step.id} draggable selection={stepSelection} onDrag={setDragged} onDrop={reorder} onSelect={() => setSelected(stepSelection)} icon={<Route size={16} />} number={`${stageIndex + 1}.${stepIndex + 1}`} label={step.name} expander={stepCollapsed ? <ChevronRight size={14} /> : <ChevronDown size={14} />} onExpand={() => setCollapsed((value) => toggleSet(value, step.id))} onAdd={() => addAction(stage.id, step.id)} />
                  {!stepCollapsed && step.actions.map((action, actionIndex) => {
                    const actionSelection: NodeSelection = { kind: 'action', stageId: stage.id, stepId: step.id, actionId: action.id }
                    return <TreeRow key={action.id} level={3} selected={selected.kind === 'action' && selected.actionId === action.id} draggable selection={actionSelection} onDrag={setDragged} onDrop={reorder} onSelect={() => setSelected(actionSelection)} icon={<MousePointerClick size={16} />} number={`${stageIndex + 1}.${stepIndex + 1}.${actionIndex + 1}`} label={action.name} />
                  })}
                </div>
              })}
            </div>
          })}
        </div>
      </section>

      <button
        type="button"
        className="editor-splitter"
        role="separator"
        aria-label="Изменить ширину панели структуры"
        aria-orientation="vertical"
        aria-valuemin={240}
        aria-valuemax={560}
        aria-valuenow={Math.round(treeWidth)}
        onPointerDown={(event) => { event.preventDefault(); setResizingTree(true) }}
        onKeyDown={(event) => {
          if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
          event.preventDefault()
          setTreeWidth((width) => Math.max(240, Math.min(560, width + (event.key === 'ArrowLeft' ? -16 : 16))))
        }}
      ><span aria-hidden="true" /></button>

      <section className="panel form-panel">
        <div className="panel-head"><div><h2>{selectionTitle(selected, document)}</h2><span>Изменения сохраняются в рабочую версию</span></div><button className="button ghost danger" onClick={removeSelected}><Trash2 size={16} />Удалить</button></div>
        <div className="form-body">
          {!selectionData && <div className="empty-state">Выберите узел дерева</div>}
          {selectionData?.kind === 'stage' && <StageForm stage={selectionData.stage} onPatch={(patch) => commit((draft) => Object.assign(draft.stages[selectionData.stageIndex], patch))} />}
          {selectionData?.kind === 'step' && <StepForm document={document} step={selectionData.step} newSource={newSource} setNewSource={setNewSource} newLinkType={newLinkType} setNewLinkType={setNewLinkType} onPatch={(patch) => commit((draft) => Object.assign(draft.stages[selectionData.stageIndex].steps[selectionData.stepIndex], patch))} onChange={commit} />}
          {selectionData?.kind === 'action' && <ActionForm document={document} bootstrap={bootstrap} action={selectionData.action} step={selectionData.step} stageIndex={selectionData.stageIndex} stepIndex={selectionData.stepIndex} actionIndex={selectionData.actionIndex} initiativeName={initiativeName} setInitiativeName={setInitiativeName} initiativeType={initiativeType} setInitiativeType={setInitiativeType} onChange={commit} />}
        </div>
      </section>
    </div>
  )
}

function TreeRow({ level, selected, selection, onSelect, icon, number, label, expander, onExpand, onAdd, draggable, onDrag, onDrop }: { level: number; selected: boolean; selection: NodeSelection; onSelect: () => void; icon: React.ReactNode; number: string; label: string; expander?: React.ReactNode; onExpand?: () => void; onAdd?: () => void; draggable?: boolean; onDrag: (value: NodeSelection) => void; onDrop: (value: NodeSelection) => void }) {
  return <div className={`tree-row level-${level} ${selected ? 'selected' : ''}`} role="treeitem" aria-selected={selected} draggable={draggable} onDragStart={() => onDrag(selection)} onDragOver={(event) => event.preventDefault()} onDrop={() => onDrop(selection)}>
    <button className="tree-expander" aria-label="Свернуть или развернуть" disabled={!onExpand} onClick={(event) => { event.stopPropagation(); onExpand?.() }}>{expander}</button><button className="tree-main" onClick={onSelect}>{icon}<span className="tree-number">{number}</span><span className="tree-label">{label}</span></button>{onAdd && <button className="tree-add" aria-label="Добавить вложенный узел" onClick={onAdd}><Plus size={14} /></button>}
  </div>
}

function StageForm({ stage, onPatch }: { stage: CJMStage; onPatch: (patch: Partial<CJMStage>) => void }) {
  return <div className="form-grid"><label className="field"><span>Наименование стадии</span><input value={stage.name} onChange={(event) => onPatch({ name: event.target.value })} /></label><label className="field full"><span>Описание</span><textarea value={stage.description} onChange={(event) => onPatch({ description: event.target.value })} /></label></div>
}

function StepForm({ document, step, newSource, setNewSource, newLinkType, setNewLinkType, onPatch, onChange }: { document: CJMDocument; step: CJMStep; newSource: string; setNewSource: (value: string) => void; newLinkType: LinkType; setNewLinkType: (value: LinkType) => void; onPatch: (patch: Partial<CJMStep>) => void; onChange: (mutate: (draft: CJMDocument) => void) => void }) {
  const order = flattenSteps(document)
  const currentIndex = order.findIndex((item) => item.step.id === step.id)
  const previous = order.slice(0, currentIndex)
  const incoming = document.links.filter((link) => link.targetId === step.id)
  const addLink = () => {
    if (!newSource) return
    onChange((draft) => draft.links.push({ id: uid(), sourceId: newSource, targetId: step.id, type: newLinkType }))
    setNewSource('')
  }
  return <div className="form-grid"><label className="field"><span>Наименование шага</span><input value={step.name} onChange={(event) => onPatch({ name: event.target.value })} /></label><label className="field full"><span>Описание</span><textarea value={step.description} onChange={(event) => onPatch({ description: event.target.value })} /></label><section className="form-section full"><div className="section-title"><div><h3>Предыдущие шаги</h3><p>Разрешены только связи от более ранних шагов</p></div></div><div className="link-list">{incoming.map((link) => <div className="link-row" key={link.id}><span>{order.find((item) => item.step.id === link.sourceId)?.number} · {order.find((item) => item.step.id === link.sourceId)?.step.name}</span><select value={link.type} onChange={(event) => onChange((draft) => { const target = draft.links.find((item) => item.id === link.id); if (target) target.type = event.target.value as LinkType })}><option value="main">Основной путь</option><option value="additional">Дополнительный путь</option><option value="alternative">Альтернативный путь</option></select><button className="icon-button" aria-label="Удалить связь" onClick={() => onChange((draft) => { draft.links = draft.links.filter((item) => item.id !== link.id) })}><X size={15} /></button></div>)}{incoming.length === 0 && <span className="subtext">Предыдущие шаги не указаны</span>}</div>{previous.length > 0 && <div className="add-link-row"><select value={newSource} onChange={(event) => setNewSource(event.target.value)}><option value="">Выберите шаг</option>{previous.map((item) => <option key={item.step.id} value={item.step.id}>{item.number} · {item.step.name}</option>)}</select><select value={newLinkType} onChange={(event) => setNewLinkType(event.target.value as LinkType)}><option value="main">Основной</option><option value="additional">Дополнительный</option><option value="alternative">Альтернативный</option></select><button className="button" disabled={!newSource} onClick={addLink}><Plus size={15} />Добавить связь</button></div>}</section><InitiativePicker document={document} stepId={step.id} onChange={onChange} /></div>
}

function ActionForm({ document, bootstrap, action, step, stageIndex, stepIndex, actionIndex, initiativeName, setInitiativeName, initiativeType, setInitiativeType, onChange }: { document: CJMDocument; bootstrap: Bootstrap; action: CJMAction; step: CJMStep; stageIndex: number; stepIndex: number; actionIndex: number; initiativeName: string; setInitiativeName: (value: string) => void; initiativeType: InitiativeType; setInitiativeType: (value: InitiativeType) => void; onChange: (mutate: (draft: CJMDocument) => void) => void }) {
  const patch = (update: Partial<CJMAction>) => onChange((draft) => Object.assign(draft.stages[stageIndex].steps[stepIndex].actions[actionIndex], update))
  const patchState = (kind: 'asIs' | 'toBe', update: Partial<CJMAction['asIs']>) => onChange((draft) => Object.assign(draft.stages[stageIndex].steps[stepIndex].actions[actionIndex][kind], update))
  const participants = bootstrap.participants.filter((item) => item.companyId === document.companyId)
  const systems = bootstrap.systems.filter((item) => item.companyId === document.companyId)
  const createInitiative = () => {
    if (!initiativeName.trim()) return
    onChange((draft) => {
      const initiative = { id: uid(), companyId: draft.companyId, type: initiativeType, name: initiativeName.trim(), description: '' }
      draft.initiatives.push(initiative)
      draft.initiativeLinks.push({ id: uid(), initiativeId: initiative.id, stepId: step.id, actionId: action.id })
    })
    setInitiativeName('')
  }
  return <div className="form-grid"><label className="field"><span>Наименование действия</span><input value={action.name} onChange={(event) => patch({ name: event.target.value })} /></label>
    <div className="field full"><span>Смысл действия</span><RichTextEditor label="Смысл действия" value={action.meaning} onCommit={(meaning) => patch({ meaning })} /></div>
    <div className="field full"><span>Цель</span><RichTextEditor label="Цель" value={action.goal} onCommit={(goal) => patch({ goal })} /></div>
    <div className="field full"><span>Боли и проблемы</span><RichTextEditor label="Боли и проблемы" value={action.pains} onCommit={(pains) => patch({ pains })} /></div>
    <label className="field full"><span>Открытые вопросы</span><textarea value={action.openQuestions} onChange={(event) => patch({ openQuestions: event.target.value })} /></label>
    <InitiativePicker document={document} stepId={step.id} actionId={action.id} onChange={onChange}>
      <div className="initiative-create"><input value={initiativeName} onChange={(event) => setInitiativeName(event.target.value)} placeholder="Новая инициатива" /><select value={initiativeType} onChange={(event) => setInitiativeType(event.target.value as InitiativeType)}>{(['Live','Future','Gap','MVP1','MVP2','MVP3'] as InitiativeType[]).map((item) => <option key={item}>{item}</option>)}</select><button className="button" disabled={!initiativeName.trim()} onClick={createInitiative}><Plus size={15} />Создать и связать</button></div>
    </InitiativePicker>
    <StateSection title="AS IS" state={action.asIs} participants={participants} systems={systems} onPatch={(update) => patchState('asIs', update)} />
    <StateSection title="TO BE" state={action.toBe} participants={participants} systems={systems} onPatch={(update) => patchState('toBe', update)} />
  </div>
}

function StateSection({ title, state, participants, systems, onPatch }: { title: string; state: CJMAction['asIs']; participants: Bootstrap['participants']; systems: Bootstrap['systems']; onPatch: (update: Partial<CJMAction['asIs']>) => void }) {
  return <section className="form-section full"><div className="section-title"><h3>{title}</h3></div><div className="reference-grid"><ReferencePicker label="Основные участники" values={state.participants} items={participants} onChange={(participants) => onPatch({ participants })} /><ReferencePicker label="Информационные системы" values={state.systems} items={systems} onChange={(systems) => onPatch({ systems })} /></div><div className="field"><span>Последовательность выполнения</span><RichTextEditor label={`Последовательность выполнения ${title}`} value={state.sequence} onCommit={(sequence) => onPatch({ sequence })} /></div></section>
}

function MultiSelectField({ label, values, items, onChange }: { label: string; values: string[]; items: ChoiceItem[]; onChange: (values: string[]) => void }) {
  const [open, setOpen] = useState(false)
  const [draftValues, setDraftValues] = useState<string[]>(values)
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (!open) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [open])

  const openPicker = () => { setDraftValues(values); setQuery(''); setOpen(true) }
  const selectedItems = values.map((id) => items.find((item) => item.id === id) ?? { id, label: 'Недоступная запись' })
  const filteredItems = items.filter((item) => item.label.toLocaleLowerCase('ru-RU').includes(query.trim().toLocaleLowerCase('ru-RU')))
  const toggleDraft = (id: string) => setDraftValues((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id])

  return <div className="multi-select-field">
    <span className="multi-select-label">{label}</span>
    <div className="multi-select-control" onClick={openPicker}>
      <div className="multi-select-values">
        {selectedItems.map((item) => <span className={`multi-select-chip ${item.toneClass ?? ''}`} key={item.id}><span>{item.label}</span><button type="button" aria-label={`Удалить ${item.label}`} onClick={(event) => { event.stopPropagation(); onChange(values.filter((id) => id !== item.id)) }}><X size={14} /></button></span>)}
        {selectedItems.length === 0 && <span className="multi-select-placeholder">Ничего не выбрано</span>}
      </div>
      <button type="button" className="button multi-select-open" aria-label={`Добавить: ${label}`} title="Добавить значения" aria-haspopup="dialog" aria-expanded={open} onClick={(event) => { event.stopPropagation(); openPicker() }}><Plus size={17} /></button>
    </div>
    {open && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setOpen(false) }}><section className="modal multi-select-modal" role="dialog" aria-modal="true" aria-label={`Выбор: ${label}`}>
      <div className="modal-head"><div><h2>{label}</h2><span className="subtext">Выберите значения из справочника</span></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setOpen(false)}><X size={17} /></button></div>
      <div className="modal-body"><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Поиск по наименованию" aria-label="Поиск по справочнику" /><div className="choice-list">
        {filteredItems.map((item) => <label className={`choice-option ${draftValues.includes(item.id) ? 'selected' : ''}`} key={item.id}><input type="checkbox" checked={draftValues.includes(item.id)} onChange={() => toggleDraft(item.id)} /><span>{item.label}</span></label>)}
        {filteredItems.length === 0 && <span className="empty-state">Подходящих записей нет</span>}
      </div></div>
      <div className="modal-actions"><span className="multi-select-count">Выбрано: {draftValues.length}</span><button type="button" className="button" onClick={() => setOpen(false)}>Отмена</button><button type="button" className="button primary" onClick={() => { onChange(draftValues); setOpen(false) }}>Применить</button></div>
    </section></div>}
  </div>
}

function ReferencePicker({ label, values, items, onChange }: { label: string; values: string[]; items: Bootstrap['participants']; onChange: (values: string[]) => void }) {
  return <MultiSelectField label={label} values={values} items={items.map((item) => ({ id: item.id, label: item.name }))} onChange={onChange} />
}

function InitiativePicker({ document, stepId, actionId, onChange, children }: { document: CJMDocument; stepId: string; actionId?: string; onChange: (mutate: (draft: CJMDocument) => void) => void; children?: ReactNode }) {
  const linked = new Set(document.initiativeLinks.filter((link) => link.stepId === stepId && (actionId ? link.actionId === actionId : !link.actionId)).map((link) => link.initiativeId))
  const updateLinks = (values: string[]) => onChange((draft) => {
    const selectedIds = new Set(values)
    const matchesTarget = (link: CJMDocument['initiativeLinks'][number]) => link.stepId === stepId && (actionId ? link.actionId === actionId : !link.actionId)
    const existingIds = new Set(draft.initiativeLinks.filter(matchesTarget).map((link) => link.initiativeId))
    draft.initiativeLinks = draft.initiativeLinks.filter((link) => !matchesTarget(link) || selectedIds.has(link.initiativeId))
    values.forEach((initiativeId) => { if (!existingIds.has(initiativeId)) draft.initiativeLinks.push({ id: uid(), initiativeId, stepId, actionId }) })
  })
  const items = document.initiatives.map((initiative) => ({ id: initiative.id, label: `${initiative.type} · ${initiative.name}`, toneClass: `type-${initiative.type.toLowerCase()}` }))
  return <section className="form-section full"><div className="section-title"><div><h3>Инициативы</h3><p>{actionId ? 'Связаны с действием' : 'Связаны непосредственно с шагом'}</p></div></div><MultiSelectField label="Связанные инициативы" values={[...linked]} items={items} onChange={updateLinks} />{children}</section>
}

function selectionTitle(selection: NodeSelection, document: CJMDocument) {
  const stageIndex = document.stages.findIndex((stage) => stage.id === selection.stageId)
  const stage = document.stages[stageIndex]
  if (!stage) return 'Выбранный узел'
  if (selection.kind === 'stage') return `Стадия ${stageIndex + 1} · ${stage.name}`
  const stepIndex = stage.steps.findIndex((step) => step.id === selection.stepId)
  const step = stage.steps[stepIndex]
  if (selection.kind === 'step') return `Шаг ${stageIndex + 1}.${stepIndex + 1} · ${step?.name}`
  const actionIndex = step?.actions.findIndex((action) => action.id === selection.actionId) ?? -1
  return `Действие ${stageIndex + 1}.${stepIndex + 1}.${actionIndex + 1} · ${step?.actions[actionIndex]?.name}`
}

function toggleSet(current: Set<string>, id: string) { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next }
