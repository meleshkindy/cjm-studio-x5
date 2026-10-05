import type { CJMAction, CJMDocument, CJMReportData, CJMStage, CJMStep, RichDoc } from './types'

export type ReportValue = string | number
export interface ReportContext {
  stageId: string; stepId: string; actionId: string
  asParticipants: string[]; toParticipants: string[]; asSystems: string[]; toSystems: string[]
  initiativeTypes: string[]; pains: boolean; questions: boolean; comments: boolean
}
export interface ReportRow {
  key: string
  cells: Record<string, ReportValue>
  contexts: ReportContext[]
  image?: string
}
export interface ReportTable {
  id: string; title: string; preview: string[]; columns: string[]; rows: ReportRow[]
  structural: boolean
}
export interface ReportFilters {
  query: string; stageId: string; stepId: string; participantId: string; systemId: string
  state: '' | 'asIs' | 'toBe'; initiativeType: string; content: '' | 'pains' | 'questions' | 'comments'
}
export const emptyFilters: ReportFilters = {
  query: '', stageId: '', stepId: '', participantId: '', systemId: '', state: '', initiativeType: '', content: '',
}
interface RichNode {
  type?: string; text?: string; attrs?: { src?: string; alt?: string; title?: string; href?: string; start?: number }
  marks?: { type?: string; attrs?: { href?: string } }[]; content?: RichNode[]
}
export function richText(value: RichDoc): string {
  const visit = (node: RichNode): string => {
    if (node.type === 'text') {
      const links = (node.marks ?? []).filter((m) => m.type === 'link' && m.attrs?.href).map((m) => m.attrs!.href)
      return (node.text ?? '') + links.map((href) => ` (${href})`).join('')
    }
    if (node.type === 'image') return `[${node.attrs?.alt || node.attrs?.title ? `Изображение: ${node.attrs.alt || node.attrs.title}` : 'Изображение'}]\n`
    if (node.type === 'hardBreak') return '\n'
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      return (node.content ?? []).map((n, i) => `${node.type === 'bulletList' ? '•' : `${(node.attrs?.start ?? 1) + i}.`} ${visit(n).trim()}\n`).join('')
    }
    const result = (node.content ?? []).map(visit).join('')
    return result + (['paragraph', 'heading', 'blockquote'].includes(node.type ?? '') ? '\n' : '')
  }
  return visit(value as RichNode).trim()
}
const normalize = (value: string) => value.toLocaleLowerCase('ru-RU').replaceAll('ё', 'е')
export const pathTypes: Record<string, string> = { main: 'Основной', additional: 'Дополнительный', alternative: 'Альтернативный' }
export const revisionKinds: Record<string, string> = { manual: 'Именованная', pre_restore: 'Перед восстановлением', restore: 'Восстановление' }

export function buildReportTables(report: CJMReportData): ReportTable[] {
  const doc = report.document
  const dirs = report.directories
  const nameOf = (items: typeof dirs.companies, id: string) => items.find((v) => v.id === id)?.name ?? (id ? 'Запись недоступна' : '')
  const names = (items: typeof dirs.companies, ids: string[]) => ids.map((id) => nameOf(items, id)).join('\n')
  const company = nameOf(dirs.companies, doc.companyId)
  const actor = nameOf(dirs.actors, doc.actorId)
  const contexts = new Map<string, ReportContext>()
  const actionLocations = new Map<string, { stage: CJMStage; step: CJMStep; action: CJMAction; number: string }>()
  const stepLocations = new Map<string, { stage: CJMStage; step: CJMStep; number: string }>()
  const emptyContext = (stageId: string, stepId = ''): ReportContext => ({ stageId, stepId, actionId: '', asParticipants: [], toParticipants: [], asSystems: [], toSystems: [], initiativeTypes: [], pains: false, questions: false, comments: false })
  const stageRows: ReportRow[] = [], stepRows: ReportRow[] = [], actionRows: ReportRow[] = [], resources: ReportRow[] = []
  const common = { 'CJM': doc.name, 'Компания': company, 'Актор': actor }
  const row = (key: string, cells: ReportRow['cells'], ctx: ReportContext[] = []): ReportRow => ({ key, cells, contexts: ctx })
  const stageContext = (id: string) => [...contexts.values()].filter((c) => c.stageId === id)
  const stepContext = (id: string) => [...contexts.values()].filter((c) => c.stepId === id)
  const actionComments = new Map<string, CJMReportData['comments']>()
  for (const comment of report.comments) actionComments.set(comment.actionId, [...(actionComments.get(comment.actionId) ?? []), comment])

  doc.stages.forEach((stage, si) => stage.steps.forEach((step, pi) => {
    stepLocations.set(step.id, { stage, step, number: `${si + 1}.${pi + 1}` })
    step.actions.forEach((action, ai) => {
      const initiatives = doc.initiativeLinks.filter((l) => l.stepId === step.id && (!l.actionId || l.actionId === action.id)).map((l) => doc.initiatives.find((i) => i.id === l.initiativeId)).filter((i) => i !== undefined)
      contexts.set(action.id, { stageId: stage.id, stepId: step.id, actionId: action.id,
        asParticipants: action.asIs.participants, toParticipants: action.toBe.participants,
        asSystems: action.asIs.systems, toSystems: action.toBe.systems,
        initiativeTypes: initiatives.map((i) => i.type), pains: !!richText(action.pains), questions: !!action.openQuestions.trim(), comments: !!actionComments.get(action.id)?.length })
      actionLocations.set(action.id, { stage, step, action, number: `${si + 1}.${pi + 1}.${ai + 1}` })
    })
    if (!step.actions.length) {
      const context = emptyContext(stage.id, step.id)
      context.initiativeTypes = doc.initiativeLinks.filter((l) => l.stepId === step.id && !l.actionId).map((l) => doc.initiatives.find((i) => i.id === l.initiativeId)?.type ?? '')
      contexts.set(step.id, context)
    }
  }))
  for (const stage of doc.stages) if (!stage.steps.length) contexts.set(stage.id, emptyContext(stage.id))

  const collectResources = (value: RichDoc, field: string, actionId: string, cells: ReportRow['cells']) => {
    const visit = (node: RichNode) => {
      const refs = (node.marks ?? []).filter((m) => m.type === 'link' && m.attrs?.href).map((m) => ({ url: m.attrs!.href!, label: node.text ?? '', image: false }))
      if (node.type === 'image' && node.attrs?.src) refs.push({ url: node.attrs.src, label: node.attrs.alt || node.attrs.title || 'Изображение', image: true })
      for (const ref of refs) {
        resources.push({ ...row(`${actionId}:${resources.length}`, { ...cells, 'Поле': field, 'Тип': ref.image ? 'Изображение' : 'Ссылка', 'Подпись': ref.label, 'Адрес': ref.image ? '' : ref.url }, [contexts.get(actionId)!]), image: ref.image ? ref.url : undefined })
      }
      node.content?.forEach(visit)
    }
    visit(value as RichNode)
  }
  for (const [si, stage] of doc.stages.entries()) {
    stageRows.push(row(stage.id, { '№': si + 1, 'Стадия': stage.name, 'Описание': stage.description, 'Шагов': stage.steps.length, 'Действий': stage.steps.reduce((n, s) => n + s.actions.length, 0), ...common }, stageContext(stage.id)))
    for (const step of stage.steps) {
      const location = stepLocations.get(step.id)!
      const incoming = doc.links.filter((l) => l.targetId === step.id).map((l) => `${pathTypes[l.type] ?? l.type}: ${stepLocations.get(l.sourceId)?.step.name ?? 'Шаг недоступен'}`).join('\n')
      const outgoing = doc.links.filter((l) => l.sourceId === step.id).map((l) => `${pathTypes[l.type] ?? l.type}: ${stepLocations.get(l.targetId)?.step.name ?? 'Шаг недоступен'}`).join('\n')
      stepRows.push(row(step.id, { '№': location.number, 'Стадия': stage.name, 'Шаг': step.name, 'Описание': step.description, 'Действий': step.actions.length, 'Входящие связи': incoming, 'Исходящие связи': outgoing, ...common }, stepContext(step.id)))
      for (const action of step.actions) {
        const comments = actionComments.get(action.id) ?? []
        const linkedInitiatives = doc.initiativeLinks.filter((l) => l.stepId === step.id && (!l.actionId || l.actionId === action.id)).map((l) => {
          const i = doc.initiatives.find((v) => v.id === l.initiativeId)
          return i ? `${i.type}: ${i.name}${i.description ? ` — ${i.description}` : ''} (${l.actionId ? 'действие' : 'шаг'})` : 'Инициатива недоступна'
        })
        const contextCells = { '№': actionLocations.get(action.id)!.number, 'Стадия': stage.name, 'Шаг': step.name, 'Действие': action.name }
        actionRows.push(row(action.id, { ...contextCells, 'Описание действия': action.description,
          'Цель': richText(action.goal), 'Смысл действия': richText(action.meaning), 'Боли и проблемы': richText(action.pains), 'Открытые вопросы': action.openQuestions,
          'Участники AS IS': names(dirs.participants, action.asIs.participants), 'Системы AS IS': names(dirs.systems, action.asIs.systems), 'Последовательность AS IS': richText(action.asIs.sequence),
          'Участники TO BE': names(dirs.participants, action.toBe.participants), 'Системы TO BE': names(dirs.systems, action.toBe.systems), 'Последовательность TO BE': richText(action.toBe.sequence),
          'Инициативы': linkedInitiatives.join('\n'), 'Комментарии': comments.map((c) => `${c.createdAt} · ${c.author}\n${c.body}`).join('\n\n'), 'Комментариев': comments.length,
          'Описание стадии': stage.description, 'Описание шага': step.description, 'Входящие связи': incoming, 'Исходящие связи': outgoing, ...common,
        }, [contexts.get(action.id)!]))
        for (const [field, value] of [['Цель', action.goal], ['Смысл действия', action.meaning], ['Боли и проблемы', action.pains], ['Последовательность AS IS', action.asIs.sequence], ['Последовательность TO BE', action.toBe.sequence]] as const) collectResources(value, field, action.id, contextCells)
      }
    }
  }
  const commentRows = report.comments.map((c) => {
    const loc = actionLocations.get(c.actionId)
    return row(c.id, { '№': loc?.number ?? '', 'Стадия': loc?.stage.name ?? '', 'Шаг': loc?.step.name ?? '', 'Действие': loc?.action.name ?? 'Действие недоступно', 'Автор': c.author, 'Комментарий': c.body, 'Создан': c.createdAt, 'Обновлён': c.updatedAt }, contexts.has(c.actionId) ? [contexts.get(c.actionId)!] : [])
  })
  const linkRows = doc.links.map((l) => row(l.id, { 'Тип пути': pathTypes[l.type] ?? l.type, 'Из стадии': stepLocations.get(l.sourceId)?.stage.name ?? '', 'Из шага': stepLocations.get(l.sourceId)?.step.name ?? 'Шаг недоступен', 'В стадию': stepLocations.get(l.targetId)?.stage.name ?? '', 'В шаг': stepLocations.get(l.targetId)?.step.name ?? 'Шаг недоступен' }, [...stepContext(l.sourceId), ...stepContext(l.targetId)]))
  const initiativeRows = doc.initiatives.flatMap((i) => {
    const links = doc.initiativeLinks.filter((l) => l.initiativeId === i.id)
    return (links.length ? links : [undefined]).map((l) => row(l?.id ?? i.id, {
      'Тип': i.type, 'Инициатива': i.name, 'Описание': i.description, 'Привязка': l ? (l.actionId ? 'Действие' : 'Шаг') : 'Без привязки к этой CJM',
      'Стадия': l ? stepLocations.get(l.stepId)?.stage.name ?? '' : '', 'Шаг': l ? stepLocations.get(l.stepId)?.step.name ?? 'Шаг недоступен' : '', 'Действие': l?.actionId ? actionLocations.get(l.actionId)?.action.name ?? 'Действие недоступно' : '',
    }, (l ? (l.actionId && contexts.has(l.actionId) ? [contexts.get(l.actionId)!] : stepContext(l.stepId)) : [emptyContext('')]).map((c) => ({ ...c, initiativeTypes: [i.type] }))))
  })
  const directoryRows = (['companies', 'actors', 'participants', 'systems'] as const).flatMap((kind) => dirs[kind].map((d) => row(`${kind}:${d.id}`, {
    'Справочник': { companies: 'Компания', actors: 'Акторы компании', participants: 'Участники компании', systems: 'Системы компании' }[kind], 'Код': d.code, 'Название': d.name, 'Описание': d.description ?? '',
  })))
  const revisionRows = report.revisions.map((r) => row(String(r.number), { 'Редакция': r.number, 'Название / комментарий': r.comment, 'Тип': revisionKinds[r.kind] ?? r.kind, 'Создана': r.createdAt, 'Автор': r.createdBy }))
  const make = (id: string, title: string, preview: string[], rows: ReportRow[], structural = true): ReportTable => ({ id, title, preview, columns: [...new Set([...preview, ...rows.flatMap((r) => Object.keys(r.cells))])], rows, structural })
  return [
    make('actions', 'Действия', ['№', 'Стадия', 'Шаг', 'Действие', 'Участники AS IS', 'Системы AS IS', 'Боли и проблемы', 'Инициативы', 'Комментариев'], actionRows),
    make('stages', 'Стадии', ['№', 'Стадия', 'Описание', 'Шагов', 'Действий'], stageRows),
    make('steps', 'Шаги', ['№', 'Стадия', 'Шаг', 'Описание', 'Действий', 'Входящие связи', 'Исходящие связи'], stepRows),
    make('initiatives', 'Инициативы', ['Тип', 'Инициатива', 'Описание', 'Привязка', 'Стадия', 'Шаг', 'Действие'], initiativeRows),
    make('links', 'Связи шагов', ['Тип пути', 'Из стадии', 'Из шага', 'В стадию', 'В шаг'], linkRows),
    make('comments', 'Комментарии', ['№', 'Действие', 'Автор', 'Комментарий', 'Создан', 'Обновлён'], commentRows),
    make('resources', 'Изображения и ссылки', ['№', 'Действие', 'Поле', 'Тип', 'Подпись', 'Адрес'], resources),
    make('revisions', 'Редакции', ['Редакция', 'Название / комментарий', 'Тип', 'Создана', 'Автор'], revisionRows, false),
    make('directories', 'Справочники', ['Справочник', 'Код', 'Название', 'Описание'], directoryRows, false),
  ]
}

export function filterReportTables(tables: ReportTable[], filters: ReportFilters): ReportTable[] {
  const terms = normalize(filters.query.trim()).split(/\s+/).filter(Boolean)
  const hasStructural = !!(filters.stageId || filters.stepId || filters.participantId || filters.systemId || filters.initiativeType || filters.content)
  const matchesContext = (c: ReportContext) => {
    if (filters.stageId && c.stageId !== filters.stageId || filters.stepId && c.stepId !== filters.stepId) return false
    const matchesState = (participants: string[], systems: string[]) => (!filters.participantId || participants.includes(filters.participantId)) && (!filters.systemId || systems.includes(filters.systemId))
    // Both references must occur in the same state, rather than mixing AS IS with TO BE.
    if (filters.state === 'asIs' ? !matchesState(c.asParticipants, c.asSystems) : filters.state === 'toBe' ? !matchesState(c.toParticipants, c.toSystems) : !matchesState(c.asParticipants, c.asSystems) && !matchesState(c.toParticipants, c.toSystems)) return false
    return (!filters.initiativeType || c.initiativeTypes.includes(filters.initiativeType)) && (!filters.content || c[filters.content])
  }
  return tables.map((table) => ({ ...table, rows: table.rows.filter((r) => {
    if (table.structural && hasStructural && !r.contexts.some(matchesContext)) return false
    const text = normalize(Object.values(r.cells).join('\n'))
    return terms.every((term) => text.includes(term))
  }) }))
}

export function reportMetadata(report: CJMReportData): Record<string, ReportValue> {
  const doc = report.document, d = report.directories
  return {
    'CJM': doc.name, 'Компания': d.companies.find((c) => c.id === doc.companyId)?.name ?? 'Запись недоступна',
    'Актор': d.actors.find((a) => a.id === doc.actorId)?.name ?? 'Запись недоступна',
    'Дата формирования': report.generatedAt, 'Создана': doc.createdAt, 'Автор создания': doc.createdBy,
    'Обновлена': doc.updatedAt, 'Автор изменения': doc.updatedBy, 'Текущая редакция': doc.currentRevision,
    'Версия записи': doc.rowVersion,
  }
}

export function historyReport(report: CJMReportData, snapshot: CJMDocument): CJMReportData {
  // Comments are not versioned by the application; never attribute current comments to past revisions.
  return { ...report, document: snapshot, comments: [], revisions: [] }
}
