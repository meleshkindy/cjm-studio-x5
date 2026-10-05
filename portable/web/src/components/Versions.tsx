import { ArrowRight, BookmarkPlus, CirclePlus, History, RotateCcw } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { api } from '../api'
import type { CJMDocument, Revision } from '../types'

interface VersionsProps {
  document: CJMDocument
  canEdit: boolean
  onRestored: (document: CJMDocument) => void
  onRevisionCreated: () => void
}

interface DiffItem { kind: 'added' | 'removed' | 'changed'; title: string; before?: string; after?: string }

export function Versions({ document, canEdit, onRestored, onRevisionCreated }: VersionsProps) {
  const [revisions, setRevisions] = useState<Revision[]>([])
  const [beforeNumber, setBeforeNumber] = useState(0)
  const [afterNumber, setAfterNumber] = useState(0)
  const [before, setBefore] = useState<CJMDocument | null>(null)
  const [after, setAfter] = useState<CJMDocument | null>(null)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)

  const load = async () => {
    const items = await api.revisions(document.id)
    setRevisions(items)
    if (items.length) {
      setAfterNumber((value) => value || items[0].number)
      setBeforeNumber((value) => value || items[1]?.number || items[0].number)
    }
  }

  useEffect(() => { void load() }, [document.id])
  useEffect(() => { if (beforeNumber) void api.getRevision(document.id, beforeNumber).then((item) => setBefore(item.snapshot ?? null)) }, [beforeNumber, document.id])
  useEffect(() => { if (afterNumber) void api.getRevision(document.id, afterNumber).then((item) => setAfter(item.snapshot ?? null)) }, [afterNumber, document.id])

  const diff = useMemo(() => before && after ? compareDocuments(before, after) : [], [after, before])

  const create = async () => {
    setBusy(true)
    try {
      await api.createRevision(document.id, comment || `Редакция ${document.currentRevision + 1}`)
      setComment('')
      await load()
      onRevisionCreated()
    } finally { setBusy(false) }
  }

  const restore = async (number: number) => {
    if (!confirm(`Восстановить редакцию v${number}? Текущее состояние будет предварительно сохранено.`)) return
    setBusy(true)
    try {
      const restored = await api.restoreRevision(document.id, number)
      onRestored(restored)
      await load()
    } finally { setBusy(false) }
  }

  return <div className="versions-layout">
    <section className="panel versions-list"><div className="panel-head"><div><h2>Редакции</h2><span>{revisions.length} сохранённых версий</span></div></div>{canEdit && <div className="revision-create"><input value={comment} onChange={(event) => setComment(event.target.value)} placeholder="Комментарий к версии" /><button className="button primary" disabled={busy} onClick={create}><BookmarkPlus size={16} />Сохранить</button></div>}<div className="revision-items">{revisions.map((revision) => <button key={revision.number} className={afterNumber === revision.number ? 'revision-item active' : 'revision-item'} onClick={() => setAfterNumber(revision.number)}><span className="revision-number">v{revision.number}</span><strong>{revision.comment || revision.kind}</strong><span>{new Date(revision.createdAt).toLocaleString('ru-RU')}</span><span className="revision-kind">{kindLabel(revision.kind)}</span></button>)}{revisions.length === 0 && <div className="empty-state"><History size={30} /><p>Сохранённых редакций пока нет</p></div>}</div></section>
    <section className="panel comparison-panel"><div className="comparison-controls"><label className="field"><span>Было</span><select value={beforeNumber} onChange={(event) => setBeforeNumber(Number(event.target.value))}>{revisions.map((item) => <option key={item.number} value={item.number}>v{item.number} · {item.comment || item.kind}</option>)}</select></label><ArrowRight className="comparison-arrow" size={20} /><label className="field"><span>Стало</span><select value={afterNumber} onChange={(event) => setAfterNumber(Number(event.target.value))}>{revisions.map((item) => <option key={item.number} value={item.number}>v{item.number} · {item.comment || item.kind}</option>)}</select></label>{canEdit && <button className="button" disabled={!beforeNumber || busy} onClick={() => restore(beforeNumber)}><RotateCcw size={16} />Восстановить «Было»</button>}</div><div className="diff-list">{diff.map((item, index) => <div className={`diff-item ${item.kind}`} key={`${item.title}-${index}`}><div className="diff-title"><CirclePlus size={16} /><strong>{item.title}</strong></div>{(item.before !== undefined || item.after !== undefined) && <div className="diff-columns"><div><span>Было</span><p>{item.before || '—'}</p></div><div><span>Стало</span><p>{item.after || '—'}</p></div></div>}</div>)}{before && after && diff.length === 0 && <div className="empty-state">Различий между редакциями нет</div>}{!before && <div className="empty-state">Создайте минимум одну редакцию для сравнения</div>}</div></section>
  </div>
}

function kindLabel(kind: string) { return ({ manual: 'Ручная', pre_restore: 'Перед восстановлением', restore: 'Восстановление', automatic: 'Автоматическая' } as Record<string, string>)[kind] || kind }

function compareDocuments(before: CJMDocument, after: CJMDocument): DiffItem[] {
  const result: DiffItem[] = []
  if (before.name !== after.name) result.push({ kind: 'changed', title: 'Изменено название CJM', before: before.name, after: after.name })
  const oldNodes = flatten(before)
  const newNodes = flatten(after)
  for (const [id, node] of oldNodes) {
    const next = newNodes.get(id)
    if (!next) result.push({ kind: 'removed', title: `Удалено: ${node.kind} «${node.name}»`, before: node.path })
    else {
      if (node.path !== next.path) result.push({ kind: 'changed', title: `Перемещено: ${next.kind} «${next.name}»`, before: node.path, after: next.path })
      if (node.content !== next.content) result.push({ kind: 'changed', title: `Изменено: ${next.kind} «${next.name}»`, before: node.summary, after: next.summary })
    }
  }
  for (const [id, node] of newNodes) if (!oldNodes.has(id)) result.push({ kind: 'added', title: `Добавлено: ${node.kind} «${node.name}»`, after: node.path })
  const oldLinks = new Set(before.links.map((link) => `${link.sourceId}|${link.targetId}|${link.type}`))
  const newLinks = new Set(after.links.map((link) => `${link.sourceId}|${link.targetId}|${link.type}`))
  for (const link of oldLinks) if (!newLinks.has(link)) result.push({ kind: 'removed', title: 'Удалена связь между шагами', before: link.split('|')[2] })
  for (const link of newLinks) if (!oldLinks.has(link)) result.push({ kind: 'added', title: 'Добавлена связь между шагами', after: link.split('|')[2] })
  return result.slice(0, 60)
}

function flatten(document: CJMDocument) {
  const map = new Map<string, { kind: string; name: string; path: string; content: string; summary: string }>()
  document.stages.forEach((stage, stageIndex) => {
    map.set(stage.id, { kind: 'стадия', name: stage.name, path: `${stageIndex + 1}`, content: JSON.stringify(stage.description), summary: stage.description })
    stage.steps.forEach((step, stepIndex) => {
      map.set(step.id, { kind: 'шаг', name: step.name, path: `${stageIndex + 1}.${stepIndex + 1}`, content: JSON.stringify([step.name, step.description]), summary: step.description })
      step.actions.forEach((action, actionIndex) => map.set(action.id, { kind: 'действие', name: action.name, path: `${stageIndex + 1}.${stepIndex + 1}.${actionIndex + 1}`, content: JSON.stringify(action), summary: action.description || 'Изменены атрибуты и Rich Text' }))
    })
  })
  return map
}
