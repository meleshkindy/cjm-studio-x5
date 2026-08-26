import { Background, Controls, Handle, MiniMap, Position, ReactFlow, type Edge, type Node, type NodeProps } from '@xyflow/react'
import { Check, Flag, MessageSquare, Pencil, Send, Sparkles, Trash2, TriangleAlert, X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { ActionComment, Bootstrap, CJMAction, CJMDocument, CJMStep, DirectoryRecord, Initiative } from '../types'
import { RichTextView } from './RichTextView'

interface MapProps {
  document: CJMDocument
  bootstrap: Pick<Bootstrap, 'participants' | 'systems'>
}

interface ProcessStepData extends Record<string, unknown> {
  number: string
  name: string
  actions: CJMAction[]
  initiatives: Initiative[]
  labelPosition: 'above' | 'below'
  selectedActionId: string
  onActionSelect: (actionId: string) => void
  onInitiativeOpen: (initiative: Initiative) => void
}

interface StageSeparatorData extends Record<string, unknown> {
  height: number
}

const initiativeIcon = (type: Initiative['type']) => {
  if (type === 'Live') return <Check size={13} />
  if (type === 'Gap') return <TriangleAlert size={13} />
  if (type === 'Future') return <Sparkles size={13} />
  return <Flag size={13} />
}

const initiativeTypeOrder: Record<Initiative['type'], number> = { Live: 0, MVP1: 1, MVP2: 2, MVP3: 3, Gap: 4, Future: 5 }

const sortInitiatives = (initiatives: Initiative[]) => [...initiatives].sort((left, right) => initiativeTypeOrder[left.type] - initiativeTypeOrder[right.type] || left.name.localeCompare(right.name, 'ru'))

const estimateWrappedRows = (labels: string[], lineCapacity = 42) => {
  let rows = 0
  let occupied = 0
  labels.forEach((label) => {
    const width = Math.min(lineCapacity, Math.max(12, label.length + 5))
    if (occupied > 0 && occupied + width > lineCapacity) { rows += 1; occupied = 0 }
    occupied += width
  })
  return rows + (occupied > 0 ? 1 : 0)
}

const estimateStepGap = (step: CJMStep, initiatives: Initiative[]) => {
  const actionRows = Math.max(1, estimateWrappedRows(step.actions.map((action) => action.name)))
  const initiativeRows = initiatives.reduce((rows, initiative) => rows + Math.max(1, Math.ceil(`${initiative.type} · ${initiative.name}`.length / 42)), 0)
  return Math.max(220, 115 + actionRows * 34 + initiativeRows * 32)
}

const estimateStepCopyHeight = (step: CJMStep, initiatives: Initiative[]) => {
  const actionRows = Math.max(1, estimateWrappedRows(step.actions.map((action) => action.name)))
  const initiativeRows = initiatives.reduce((rows, initiative) => rows + Math.max(1, Math.ceil(`${initiative.type} · ${initiative.name}`.length / 42)), 0)
  return 46 + actionRows * 34 + initiativeRows * 32
}

function ProcessStepNode({ data, selected }: NodeProps) {
  const step = data as ProcessStepData
  return <div className={selected ? 'flow-step selected' : 'flow-step'}>
    <span className="flow-step-dot" aria-hidden="true" />
    <Handle type="target" position={Position.Left} />
    <Handle type="source" position={Position.Right} />
    <div className={`flow-step-copy ${step.labelPosition}`}>
      <strong>{step.number} · {step.name}</strong>
      <div className="flow-action-list">{step.actions.length > 0
        ? step.actions.map((action) => <button type="button" key={action.id} className={step.selectedActionId === action.id ? 'flow-action-chip nodrag nopan active' : 'flow-action-chip nodrag nopan'} onClick={(event) => { event.stopPropagation(); step.onActionSelect(action.id) }}>{action.name}</button>)
        : <span className="flow-action-chip empty">Действия не добавлены</span>}
      </div>
      <div className="flow-initiative-list">{step.initiatives.map((initiative) => <button type="button" key={initiative.id} className={`initiative-chip nodrag nopan type-${initiative.type.toLowerCase()}`} onClick={(event) => { event.stopPropagation(); step.onInitiativeOpen(initiative) }}>{initiativeIcon(initiative.type)}{initiative.type} · {initiative.name}</button>)}</div>
    </div>
  </div>
}

function StageSeparatorNode({ data }: NodeProps) {
  const separator = data as StageSeparatorData
  return <div className="flow-stage-separator" style={{ height: separator.height }} aria-hidden="true" />
}

const nodeTypes = { processStep: ProcessStepNode, stageSeparator: StageSeparatorNode }

export function CjmMap({ document, bootstrap }: MapProps) {
  const flatSteps = useMemo(() => document.stages.flatMap((stage, stageIndex) => stage.steps.map((step, stepIndex) => ({ stage, stageIndex, step, stepIndex }))), [document.stages])
  const [selectedStepId, setSelectedStepId] = useState(flatSteps[0]?.step.id ?? '')
  const [selectedActionId, setSelectedActionId] = useState('')
  const [selectedInitiative, setSelectedInitiative] = useState<Initiative | null>(null)
  const [commentsOpen, setCommentsOpen] = useState(false)
  const [comments, setComments] = useState<ActionComment[]>([])
  const [commentsLoading, setCommentsLoading] = useState(false)
  const [commentsBusy, setCommentsBusy] = useState(false)
  const [commentError, setCommentError] = useState('')

  const { nodes, edges } = useMemo(() => {
    const flowNodes: Node[] = []
    const stepSpacing = Math.round(529 * 1.15 * 1.1)
    const waveCenterY = 300
    const waveAmplitude = 112
    const stepDepths = new Map<string, number>()
    let maxDepth = -1
    let fallbackStageDepth = 0
    document.stages.forEach((stage) => {
      const stageBaseDepth = fallbackStageDepth
      stage.steps.forEach((step) => {
        const incomingDepths = document.links
          .filter((link) => link.targetId === step.id)
          .map((link) => stepDepths.get(link.sourceId))
          .filter((depth): depth is number => depth !== undefined)
        const depth = incomingDepths.length > 0 ? Math.max(...incomingDepths) + 1 : stageBaseDepth
        stepDepths.set(step.id, depth)
        maxDepth = Math.max(maxDepth, depth)
      })
      fallbackStageDepth = maxDepth + 1
    })
    const stepIdsByDepth = new Map<number, string[]>()
    flatSteps.forEach(({ step }) => {
      const depth = stepDepths.get(step.id) ?? 0
      stepIdsByDepth.set(depth, [...(stepIdsByDepth.get(depth) ?? []), step.id])
    })
    const initiativesByStep = new Map<string, Initiative[]>()
    flatSteps.forEach(({ step }) => {
      const initiativeIds = new Set(document.initiativeLinks.filter((link) => link.stepId === step.id).map((link) => link.initiativeId))
      initiativesByStep.set(step.id, sortInitiatives(document.initiatives.filter((initiative) => initiativeIds.has(initiative.id))))
    })
    const stepById = new Map(flatSteps.map(({ step }) => [step.id, step]))
    const stepYById = new Map<string, number>()
    let layoutHeight = 680
    stepIdsByDepth.forEach((stepIds, depth) => {
      const mainStepY = waveCenterY + Math.sin(depth * Math.PI / 2) * waveAmplitude
      if (stepIds.length === 1) {
        stepYById.set(stepIds[0], mainStepY)
        return
      }
      const totalSpan = stepIds.slice(0, -1).reduce((sum, stepId) => {
        const step = stepById.get(stepId)
        return sum + (step ? estimateStepGap(step, initiativesByStep.get(stepId) ?? []) : 220)
      }, 0)
      let nextY = Math.max(130, mainStepY - totalSpan / 2)
      stepIds.forEach((stepId) => {
        stepYById.set(stepId, nextY)
        const step = stepById.get(stepId)
        nextY += step ? estimateStepGap(step, initiativesByStep.get(stepId) ?? []) : 220
      })
      layoutHeight = Math.max(layoutHeight, nextY + 240)
    })
    fallbackStageDepth = 0
    document.stages.forEach((stage, stageIndex) => {
      const stageDepths = stage.steps.map((step) => stepDepths.get(step.id)).filter((depth): depth is number => depth !== undefined)
      const stageStartDepth = stageDepths.length > 0 ? Math.min(...stageDepths) : fallbackStageDepth
      const stageStartX = stageStartDepth * stepSpacing
      const stageLabelX = stageIndex > 0 ? stageStartX - stepSpacing * 3 / 8 : stageStartX
      if (stageIndex > 0) {
        flowNodes.push({
          id: `separator-${stage.id}`,
          type: 'stageSeparator',
          draggable: false,
          selectable: false,
          focusable: false,
          position: { x: stageStartX - stepSpacing / 2, y: -40 },
          width: 1,
          height: layoutHeight,
          data: { height: layoutHeight },
          className: 'flow-stage-separator-node',
        })
      }
      flowNodes.push({ id: `stage-${stage.id}`, type: 'input', draggable: false, selectable: false, position: { x: stageLabelX, y: 0 }, width: 300, height: 40, data: { label: <div className="flow-stage-label"><strong>{stageIndex + 1}</strong><span>{stage.name}</span></div> }, className: 'flow-stage-node' })
      stage.steps.forEach((step, stepIndex) => {
        const stepDepth = stepDepths.get(step.id) ?? stageStartDepth + stepIndex
        const depthStepIds = stepIdsByDepth.get(stepDepth) ?? [step.id]
        const isStacked = depthStepIds.length > 1
        const mainStepY = waveCenterY + Math.sin(stepDepth * Math.PI / 2) * waveAmplitude
        const stepY = stepYById.get(step.id) ?? mainStepY
        const nextStepY = waveCenterY + Math.sin((stepDepth + 1) * Math.PI / 2) * waveAmplitude
        const initiatives = initiativesByStep.get(step.id) ?? []
        const preferredLabelPosition = nextStepY > stepY ? 'above' : 'below'
        const overlapsStageLabel = preferredLabelPosition === 'above' && stepY - estimateStepCopyHeight(step, initiatives) < 120
        const labelPosition = isStacked || overlapsStageLabel ? 'below' : preferredLabelPosition
        flowNodes.push({
          id: step.id,
          type: 'processStep',
          draggable: false,
          position: { x: stepDepth * stepSpacing, y: stepY },
          width: 360,
          height: 150,
          data: {
            number: `${stageIndex + 1}.${stepIndex + 1}`,
            name: step.name,
            actions: step.actions,
            initiatives,
            labelPosition,
            selectedActionId: selectedStepId === step.id ? (selectedActionId || step.actions[0]?.id || '') : '',
            onActionSelect: (actionId: string) => { setSelectedStepId(step.id); setSelectedActionId(actionId) },
            onInitiativeOpen: (initiative: Initiative) => { setSelectedStepId(step.id); setSelectedInitiative(initiative) },
          },
          className: 'flow-step-node',
          selected: selectedStepId === step.id,
        })
      })
      fallbackStageDepth = stageDepths.length > 0 ? Math.max(...stageDepths) + 1 : fallbackStageDepth + 1
    })
    const flowEdges: Edge[] = document.links.map((link) => ({
      id: link.id,
      source: link.sourceId,
      target: link.targetId,
      type: 'bezier',
      animated: false,
      pathOptions: { curvature: 0.46 },
      style: { stroke: link.type === 'additional' ? 'var(--primary)' : 'var(--danger)', strokeWidth: 6.5, strokeDasharray: link.type === 'alternative' ? '12 9' : undefined, strokeLinecap: 'round', strokeLinejoin: 'round' },
    }))
    return { nodes: flowNodes, edges: flowEdges }
  }, [document, flatSteps, selectedActionId, selectedStepId])

  const selected = flatSteps.find((item) => item.step.id === selectedStepId) ?? flatSteps[0]
  const action = selected?.step.actions.find((item) => item.id === selectedActionId) ?? selected?.step.actions[0]

  useEffect(() => {
    const actionId = action?.id
    if (!actionId) { setComments([]); return }
    let ignored = false
    setCommentsLoading(true)
    setCommentError('')
    void api.actionComments(actionId).then((items) => {
      if (!ignored) setComments(items)
    }).catch((reason: unknown) => {
      if (!ignored) setCommentError(reason instanceof Error ? reason.message : 'Не удалось загрузить комментарии')
    }).finally(() => {
      if (!ignored) setCommentsLoading(false)
    })
    return () => { ignored = true }
  }, [action?.id])

  const createComment = async (body: string) => {
    if (!action) return false
    setCommentsBusy(true); setCommentError('')
    try {
      const created = await api.createActionComment(action.id, body)
      setComments((items) => [...items, created])
      return true
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : 'Не удалось добавить комментарий')
      return false
    } finally { setCommentsBusy(false) }
  }

  const updateComment = async (commentId: string, body: string) => {
    if (!action) return false
    setCommentsBusy(true); setCommentError('')
    try {
      const updated = await api.updateActionComment(action.id, commentId, body)
      setComments((items) => items.map((item) => item.id === updated.id ? updated : item))
      return true
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : 'Не удалось изменить комментарий')
      return false
    } finally { setCommentsBusy(false) }
  }

  const deleteComment = async (commentId: string) => {
    if (!action) return false
    setCommentsBusy(true); setCommentError('')
    try {
      await api.deleteActionComment(action.id, commentId)
      setComments((items) => items.filter((item) => item.id !== commentId))
      return true
    } catch (reason) {
      setCommentError(reason instanceof Error ? reason.message : 'Не удалось удалить комментарий')
      return false
    } finally { setCommentsBusy(false) }
  }

  return (
    <div className="map-layout">
      <div className="map-toolbar"><div className="route-legend"><span><i className="line-main" />Основной путь</span><span><i className="line-additional" />Дополнительный путь</span><span><i className="line-alternative" />Альтернативный путь</span></div></div>
      <section className="map-canvas panel">
        <ReactFlow nodeTypes={nodeTypes} nodes={nodes} edges={edges} defaultViewport={{ x: 110, y: 90, zoom: 0.62 }} minZoom={0.25} maxZoom={1.5} nodesConnectable={false} onNodeClick={(_, node) => { if (!node.id.startsWith('stage-')) { setSelectedStepId(node.id); setSelectedActionId('') } }}>
          <Background gap={24} size={1} color="var(--flow-grid)" />
          <MiniMap pannable zoomable nodeColor={(node) => node.id.startsWith('separator-') ? 'transparent' : node.id.startsWith('stage-') ? '#147d52' : '#d44b43'} nodeStrokeColor={(node) => node.id.startsWith('separator-') ? 'transparent' : '#ffffff'} nodeStrokeWidth={2} maskColor="rgba(18, 59, 46, 0.10)" />
          <Controls showInteractive={false} />
        </ReactFlow>
      </section>
      {selected && <section className="panel map-detail"><div className="step-summary"><span className="eyebrow">Шаг {selected.stageIndex + 1}.{selected.stepIndex + 1}</span><h2>{selected.step.name}</h2><p>{selected.step.description}</p><div className="flow-initiative-list">{stepInitiatives(document, selected.step).map((initiative) => <button type="button" key={initiative.id} className={`initiative-chip type-${initiative.type.toLowerCase()}`} onClick={() => setSelectedInitiative(initiative)}>{initiativeIcon(initiative.type)}{initiative.type} · {initiative.name}</button>)}</div></div><div className="step-actions"><h3>Действия шага</h3>{selected.step.actions.map((item, index) => <button key={item.id} className={action?.id === item.id ? 'action-select active' : 'action-select'} onClick={() => setSelectedActionId(item.id)}><span>{selected.stageIndex + 1}.{selected.stepIndex + 1}.{index + 1}</span>{item.name}</button>)}</div></section>}
      {action && <ActionDetails action={action} document={document} step={selected.step} bootstrap={bootstrap} commentCount={comments.length} onCommentsOpen={() => setCommentsOpen(true)} onInitiativeOpen={setSelectedInitiative} />}
      {commentsOpen && action && <ActionCommentsDrawer action={action} comments={comments} loading={commentsLoading} busy={commentsBusy} error={commentError} onClose={() => setCommentsOpen(false)} onCreate={createComment} onUpdate={updateComment} onDelete={deleteComment} />}
      {selectedInitiative && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSelectedInitiative(null) }}><section className="modal initiative-modal" role="dialog" aria-modal="true" aria-labelledby="initiative-modal-title"><div className="modal-head"><div className="initiative-modal-title"><span className={`initiative-type-badge type-${selectedInitiative.type.toLowerCase()}`}>{initiativeIcon(selectedInitiative.type)}{selectedInitiative.type}</span><h2 id="initiative-modal-title">{selectedInitiative.name}</h2></div><button type="button" className="icon-button" aria-label="Закрыть" onClick={() => setSelectedInitiative(null)}><X size={17} /></button></div><div className="modal-body"><p className="initiative-modal-description">{selectedInitiative.description || 'Описание инициативы не заполнено'}</p></div></section></div>}
    </div>
  )
}

function stepInitiatives(document: CJMDocument, step: CJMStep) {
  const ids = new Set(document.initiativeLinks.filter((link) => link.stepId === step.id).map((link) => link.initiativeId))
  return sortInitiatives(document.initiatives.filter((item) => ids.has(item.id)))
}

function ActionDetails({ action, document, step, bootstrap, commentCount, onCommentsOpen, onInitiativeOpen }: { action: CJMAction; document: CJMDocument; step: CJMStep; bootstrap: Pick<Bootstrap, 'participants' | 'systems'>; commentCount: number; onCommentsOpen: () => void; onInitiativeOpen: (initiative: Initiative) => void }) {
  const initiatives = sortInitiatives(document.initiativeLinks.filter((link) => link.stepId === step.id && link.actionId === action.id).map((link) => document.initiatives.find((item) => item.id === link.initiativeId)).filter(Boolean) as Initiative[])
  return <section className="panel action-detail"><div className="action-detail-head"><div><span className="eyebrow">Выбранное действие</span><h2>{action.name}</h2></div><div className="action-detail-controls"><div className="flow-initiative-list">{initiatives.map((initiative) => <button type="button" key={initiative.id} className={`initiative-chip type-${initiative.type.toLowerCase()}`} onClick={() => onInitiativeOpen(initiative)}>{initiativeIcon(initiative.type)}{initiative.type} · {initiative.name}</button>)}</div><button type="button" className="button comments-button" onClick={onCommentsOpen}><MessageSquare size={16} />Комментарии<span className="comment-count">{commentCount}</span></button></div></div><div className="action-detail-grid"><DetailBlock title="Смысл действия"><RichTextView value={action.meaning} /></DetailBlock><DetailBlock title="Цель"><RichTextView value={action.goal} /></DetailBlock><DetailBlock title="Боли и проблемы"><RichTextView value={action.pains} /></DetailBlock><DetailBlock title="Открытые вопросы"><p>{action.openQuestions || 'Не указаны'}</p></DetailBlock><ActionStateDetails title="AS IS" state={action.asIs} bootstrap={bootstrap} /><ActionStateDetails title="TO BE" state={action.toBe} bootstrap={bootstrap} /></div></section>
}

function DetailBlock({ title, children }: { title: string; children: React.ReactNode }) { return <div className="detail-block"><h3>{title}</h3>{children}</div> }

function ActionStateDetails({ title, state, bootstrap }: { title: string; state: CJMAction['asIs']; bootstrap: Pick<Bootstrap, 'participants' | 'systems'> }) {
  const participants = resolveReferences(state.participants, bootstrap.participants)
  const systems = resolveReferences(state.systems, bootstrap.systems)
  return <div className="detail-block action-state-detail"><h3>{title}</h3><RichTextView value={state.sequence} /><div className="state-reference-sections"><StateReferenceList title="Участники процесса" items={participants} /><StateReferenceList title="Информационные системы" items={systems} /></div></div>
}

function resolveReferences(ids: string[], items: DirectoryRecord[]) {
  const byId = new Map(items.map((item) => [item.id, item]))
  return ids.map((id) => byId.get(id)).filter((item): item is DirectoryRecord => Boolean(item))
}

function StateReferenceList({ title, items }: { title: string; items: DirectoryRecord[] }) {
  return <div className="state-reference-list"><h4>{title}</h4>{items.length > 0 ? <div className="state-reference-tags">{items.map((item) => <span key={item.id}>{item.name}</span>)}</div> : <p>Не указаны</p>}</div>
}

function ActionCommentsDrawer({ action, comments, loading, busy, error, onClose, onCreate, onUpdate, onDelete }: { action: CJMAction; comments: ActionComment[]; loading: boolean; busy: boolean; error: string; onClose: () => void; onCreate: (body: string) => Promise<boolean>; onUpdate: (commentId: string, body: string) => Promise<boolean>; onDelete: (commentId: string) => Promise<boolean> }) {
  const [draft, setDraft] = useState('')
  const [editingId, setEditingId] = useState('')
  const [editingBody, setEditingBody] = useState('')

  useEffect(() => { setDraft(''); setEditingId(''); setEditingBody('') }, [action.id])

  const submitComment = async (event: React.FormEvent) => {
    event.preventDefault()
    if (await onCreate(draft)) setDraft('')
  }

  const submitEdit = async (event: React.FormEvent, commentId: string) => {
    event.preventDefault()
    if (await onUpdate(commentId, editingBody)) { setEditingId(''); setEditingBody('') }
  }

  return <div className="comment-drawer-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}><aside className="comment-drawer" role="dialog" aria-modal="true" aria-labelledby="comment-drawer-title"><header className="comment-drawer-head"><div><span className="eyebrow">Комментарии к действию</span><h2 id="comment-drawer-title">{action.name}</h2></div><button type="button" className="icon-button" aria-label="Закрыть комментарии" onClick={onClose}><X size={18} /></button></header><div className="comment-feed">{loading && <p className="comment-feed-status">Загрузка комментариев…</p>}{!loading && comments.length === 0 && <div className="comment-empty"><MessageSquare size={28} /><strong>Комментариев пока нет</strong><span>Начните обсуждение этого действия.</span></div>}{comments.map((comment) => <article className="comment-item" key={comment.id}><div className="comment-avatar" aria-hidden="true">{commentInitials(comment.author)}</div><div className="comment-content"><header><strong>{comment.author}</strong><time dateTime={comment.createdAt}>{formatCommentDate(comment.createdAt)}{comment.updatedAt !== comment.createdAt ? ' · изменено' : ''}</time></header>{editingId === comment.id ? <form className="comment-edit" onSubmit={(event) => void submitEdit(event, comment.id)}><textarea aria-label="Изменить комментарий" maxLength={4000} value={editingBody} onChange={(event) => setEditingBody(event.target.value)} /><div><button type="button" className="button" disabled={busy} onClick={() => { setEditingId(''); setEditingBody('') }}>Отмена</button><button type="submit" className="button primary" disabled={busy || !editingBody.trim()}>Сохранить</button></div></form> : <><p>{comment.body}</p><div className="comment-actions"><button type="button" aria-label="Редактировать комментарий" disabled={busy} onClick={() => { setEditingId(comment.id); setEditingBody(comment.body) }}><Pencil size={14} />Изменить</button><button type="button" className="danger-ghost" aria-label="Удалить комментарий" disabled={busy} onClick={() => { if (confirm('Удалить комментарий?')) void onDelete(comment.id) }}><Trash2 size={14} />Удалить</button></div></>}</div></article>)}</div>{error && <div className="comment-error" role="alert">{error}</div>}<form className="comment-composer" onSubmit={(event) => void submitComment(event)}><textarea aria-label="Новый комментарий" placeholder="Напишите комментарий…" maxLength={4000} value={draft} onChange={(event) => setDraft(event.target.value)} /><div><span>{draft.length}/4000</span><button type="submit" className="button primary" disabled={busy || !draft.trim()}><Send size={16} />Отправить</button></div></form></aside></div>
}

function commentInitials(author: string) {
  return author.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'ЛП'
}

function formatCommentDate(value: string) {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(date)
}
