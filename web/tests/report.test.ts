import test from 'node:test'
import assert from 'node:assert/strict'
import ExcelJS from 'exceljs'
import { buildReportTables, emptyFilters, filterReportTables, reportMetadata, richText } from '../src/report'
import { createReportWorkbook } from '../src/reportExcel'
import type { CJMReportData, CJMAction } from '../src/types'

const rich = (text: string) => ({ type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text }] }] })
function fixture(): CJMReportData {
  const action = (id: string): CJMAction => ({ id, position: 0, name: id, description: '=1+2', goal: rich('Цель с ёлкой'), meaning: rich('Смысл'), pains: rich('Долгое ожидание'), openQuestions: 'Кто отвечает?', asIs: { participants: ['p1'], systems: ['s1'], sequence: rich('Первый шаг\nВторой шаг') }, toBe: { participants: ['p2'], systems: ['s2'], sequence: rich('Новая последовательность') } })
  const first = action('a1'), second = action('a2')
  second.pains = rich(''); second.openQuestions = ''
  const report: CJMReportData = {
    generatedAt: '2026-09-28T10:00:00Z',
    document: { id: 'cjm', name: 'Проверочная CJM', companyId: 'company', actorId: 'actor', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-09-28T09:00:00Z', createdBy: 'Автор', updatedBy: 'Редактор', rowVersion: 3, currentRevision: 1,
      stages: [{ id: 'stage1', position: 0, name: 'Подготовка', description: 'Описание стадии', steps: [{ id: 'step1', position: 0, name: 'Первый шаг', description: 'Описание шага', actions: [first, second] }, { id: 'empty-step', position: 1, name: 'Пустой шаг', description: 'Пустой, но важный', actions: [] }] }, { id: 'empty-stage', position: 1, name: 'Пустая стадия', description: 'Без шагов', steps: [] }],
      links: [{ id: 'path', sourceId: 'step1', targetId: 'empty-step', type: 'alternative' }],
      initiatives: [{ id: 'i1', companyId: 'company', type: 'Gap', name: 'Улучшение', description: 'Уникальное описание инициативы' }, { id: 'i2', companyId: 'company', type: 'Live', name: 'Без привязки', description: 'Независимая инициатива' }],
      initiativeLinks: [{ id: 'il1', initiativeId: 'i1', stepId: 'step1' }],
    },
    directories: { companies: [{ id: 'company', code: '01', name: 'Компания' }], actors: [{ id: 'actor', companyId: 'company', code: 'A01', name: 'Актор' }], participants: [{ id: 'p1', name: 'Иван', code: 'P1' }, { id: 'p2', name: 'Мария', code: 'P2' }], systems: [{ id: 's1', name: 'Старая система', code: 'S1' }, { id: 's2', name: 'Новая система', code: 'S2' }], cjms: [] },
    comments: [{ id: 'comment', actionId: 'a1', author: 'Пётр', body: 'Уникальный комментарий', createdAt: '2026-09-28T08:00:00Z', updatedAt: '2026-09-28T08:30:00Z' }], revisions: [],
  }
  report.revisions = [{ number: 1, comment: 'Первая редакция', kind: 'manual', createdAt: '2026-09-20T00:00:00Z', createdBy: 'Исторический автор', snapshot: structuredClone(report.document) }]
  return report
}

test('complete report retains empty hierarchy, all action fields, comments and unlinked initiatives', () => {
  const tables = buildReportTables(fixture())
  assert.equal(tables.find((t) => t.id === 'stages')!.rows.length, 2)
  assert.equal(tables.find((t) => t.id === 'steps')!.rows.length, 2)
  const action = tables[0].rows[0].cells
  assert.equal(action['Последовательность TO BE'], 'Новая последовательность')
  assert.equal(action['Участники AS IS'], 'Иван')
  assert.match(String(action['Инициативы']), /Уникальное описание инициативы/)
  assert.match(String(action['Комментарии']), /Уникальный комментарий/)
  assert.equal(action['Действие'], 'a1')
  assert.ok(tables.every((t) => t.columns.every((c) => !/^ID(?:\s|$)/.test(c))))
  assert.ok(Object.keys(reportMetadata(fixture())).every((c) => !/^ID(?:\s|$)/.test(c)))
  assert.match(String(tables.find((t) => t.id === 'initiatives')!.rows[1].cells['Привязка']), /Без привязки/)
})

test('search covers hidden fields, comments, initiatives and normalizes Cyrillic ё', () => {
  const tables = buildReportTables(fixture())
  for (const [query, expected] of [['уникальный комментарий', 1], ['елкой', 2], ['описание инициативы', 2], ['несуществующий', 0]] as const) {
    assert.equal(filterReportTables(tables, { ...emptyFilters, query })[0].rows.length, expected, query)
  }
})

test('state filters do not combine references from different states, and child filters preserve exact scope', () => {
  const tables = buildReportTables(fixture())
  assert.equal(filterReportTables(tables, { ...emptyFilters, participantId: 'p1', systemId: 's2' })[0].rows.length, 0)
  assert.equal(filterReportTables(tables, { ...emptyFilters, participantId: 'p2', state: 'asIs' })[0].rows.length, 0)
  assert.equal(filterReportTables(tables, { ...emptyFilters, participantId: 'p2', state: 'toBe' })[0].rows.length, 2)
  const filtered = filterReportTables(tables, { ...emptyFilters, stageId: 'stage1', content: 'comments', initiativeType: 'Gap' })
  assert.equal(filtered[0].rows.length, 1)
  assert.equal(filtered.find((t) => t.id === 'comments')!.rows.length, 1)
  assert.equal(filtered.find((t) => t.id === 'initiatives')!.rows.length, 1)
  assert.equal(filtered.find((t) => t.id === 'stages')!.rows.length, 1)
  assert.equal(filterReportTables(tables, { ...emptyFilters, stageId: 'empty-stage' }).find((t) => t.id === 'stages')!.rows.length, 1)
})

test('rich text preserves lists, line breaks, link targets and image references', () => {
  const value = { type: 'doc', content: [{ type: 'orderedList', attrs: { start: 3 }, content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Ссылка', marks: [{ type: 'link', attrs: { href: 'https://example.com' } }] }] }] }] }, { type: 'image', attrs: { src: '/api/assets/test', alt: 'Схема' } }] }
  const text = richText(value)
  assert.match(text, /3\. Ссылка \(https:\/\/example.com\)/)
  assert.match(text, /Изображение: Схема/)
  assert.ok(!text.includes('/api/assets/test'))
})

test('Excel round-trip preserves all pages, strings, long text, dates, filters, panes and history', async () => {
  const report = fixture()
  const sample = report.document.stages[0].steps[0].actions[0]
  report.document.stages[0].steps[0].actions = Array.from({ length: 61 }, (_, i) => ({ ...structuredClone(sample), id: `many-${i}`, position: i }))
  const long = 'Длинный текст 😀'.repeat(4000)
  report.document.stages[0].steps[0].actions[0].description = long
  const tables = buildReportTables(report)
  const workbook = await createReportWorkbook(report, tables, { full: true, filters: emptyFilters, includeHistory: true, includeImages: false })
  const bytes = await workbook.xlsx.writeBuffer()
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(bytes)
  const sheet = reopened.getWorksheet('Действия')!
  const headers = sheet.getRow(1).values as string[]
  const descriptionCol = headers.indexOf('Описание действия')
  const numberCol = headers.indexOf('№')
  const numbers = new Set<string>(), parts: string[] = []
  sheet.eachRow((row, index) => {
    if (index === 1) return
    const number = String(row.getCell(numberCol).value)
    numbers.add(number)
    if (number === '1.1.1') parts.push(String(row.getCell(descriptionCol).value))
    else { assert.equal(row.getCell(descriptionCol).value, '=1+2'); assert.equal(row.getCell(descriptionCol).type, ExcelJS.ValueType.String) }
  })
  assert.equal(numbers.size, 61)
  assert.equal(parts.join(''), long)
  assert.ok(sheet.autoFilter)
  assert.equal(sheet.views[0].state, 'frozen')
  assert.ok(reopened.getWorksheet('История действий'))
  assert.equal(reopened.getWorksheet('Комментарии')!.rowCount, 2)
  assert.ok(reopened.getWorksheet('Комментарии')!.getRow(2).getCell(5).value instanceof Date)
  for (const ws of reopened.worksheets) ws.eachRow((row) => row.eachCell((cell) => {
    assert.notEqual(cell.type, ExcelJS.ValueType.Formula)
    assert.ok(!/^ID(?:\s|$)/.test(String(cell.value ?? '')), `${ws.name}: ${cell.address}`)
  }))
})

test('filtered export excludes unmatched actions and embeds images without network calls', async () => {
  const report = fixture()
  report.document.stages[0].steps[0].actions[0].goal = { type: 'doc', content: [{ type: 'image', attrs: { src: '/api/assets/picture', alt: 'Схема' } }] }
  const filters = { ...emptyFilters, content: 'comments' as const }
  const tables = filterReportTables(buildReportTables(report), filters)
  let loaded = 0
  const workbook = await createReportWorkbook(report, tables, { full: false, filters, includeHistory: false, includeImages: true }, async () => {
    loaded++
    return { base64: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/hGQAAAAASUVORK5CYII=', width: 1, height: 1 }
  })
  assert.equal(workbook.getWorksheet('Действия')!.rowCount, 2)
  assert.equal(loaded, 1)
  assert.equal(workbook.getWorksheet('Изображения')!.getImages().length, 1)
  const reopened = new ExcelJS.Workbook()
  await reopened.xlsx.load(await workbook.xlsx.writeBuffer())
  assert.equal(reopened.getWorksheet('Изображения')!.getImages().length, 1)
  for (const ws of reopened.worksheets) ws.eachRow((row) => row.eachCell((cell) => assert.ok(!String(cell.value ?? '').includes('/api/assets/picture'))))
})
