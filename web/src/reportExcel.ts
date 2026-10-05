import ExcelJS from 'exceljs'
import { api } from './api'
import { buildReportTables, historyReport, reportMetadata, type ReportFilters, type ReportRow, type ReportTable, type ReportValue } from './report'
import type { CJMReportData } from './types'

export interface ExportOptions {
  full: boolean
  filters: ReportFilters
  includeHistory: boolean
  includeImages: boolean
}
const green = 'FF245B48'
const isoDate = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/
function excelValue(value: ReportValue): string | number | Date {
  if (typeof value === 'string' && isoDate.test(value) && Number.isFinite(Date.parse(value))) return new Date(value)
  // ExcelJS stores strings as strings, including values beginning with =, +, - or @.
  return typeof value === 'string' ? value.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '') : value
}
function chunks(value: ReportValue): ReportValue[] {
  if (typeof value !== 'string' || value.length <= 30000) return [value]
  const parts: string[] = []
  let rest = value
  while (rest.length) {
    let end = Math.min(30000, rest.length)
    if (end < rest.length && /[\uD800-\uDBFF]/.test(rest[end - 1])) end--
    parts.push(rest.slice(0, end)); rest = rest.slice(end)
  }
  return parts
}
function addTable(workbook: ExcelJS.Workbook, name: string, columns: string[], rows: ReportRow[]) {
  const sheet = workbook.addWorksheet(name, { views: [{ state: 'frozen', xSplit: 1, ySplit: 1 }], properties: { defaultRowHeight: 32 } })
  const hasLongText = rows.some((r) => Object.values(r.cells).some((v) => typeof v === 'string' && v.length > 30000))
  const headers = hasLongText ? [...columns, 'Часть текста'] : columns
  sheet.columns = headers.map((header) => ({ header, width: header === '№' ? 12 : /описание|последовательность|боли|комментарий|смысл/i.test(header) ? 58 : 30 }))
  sheet.getRow(1).font = { name: 'Calibri', size: 11, bold: true, color: { argb: 'FFFFFFFF' } }
  sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } }
  sheet.getRow(1).height = 34
  sheet.getRow(1).alignment = { vertical: 'middle', wrapText: true }
  for (const r of rows) {
    const values = columns.map((column) => chunks(r.cells[column] ?? ''))
    const count = Math.max(1, ...values.map((v) => v.length))
    for (let part = 0; part < count; part++) {
      if (sheet.rowCount >= 1048576) throw new Error(`Лист «${name}» превышает лимит Excel. Уточните фильтры.`)
      const cells = values.map((v) => excelValue(v.length === 1 ? v[0] : v[part] ?? ''))
      if (hasLongText) cells.push(`${part + 1}/${count}`)
      const added = sheet.addRow(cells)
      added.font = { name: 'Calibri', size: 11, color: { argb: 'FF202B26' } }
      added.alignment = { vertical: 'top', wrapText: true }
      let lines = 1
      added.eachCell((cell, index) => {
        if (cell.value instanceof Date) cell.numFmt = 'dd.mm.yyyy hh:mm:ss'
        if (typeof cell.value === 'number') cell.numFmt = '0'
        if (headers[index - 1] === 'Адрес' && typeof cell.value === 'string' && /^https?:\/\//i.test(cell.value)) {
          cell.value = { text: cell.value, hyperlink: cell.value }
          cell.font = { color: { argb: 'FF245B48' }, underline: true }
        }
        const text = String(cell.value ?? '')
        lines = Math.max(lines, text.split('\n').reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / ((sheet.getColumn(index).width ?? 30) - 3))), 0))
        if (added.number % 2 === 0) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F6F3' } }
      })
      added.height = Math.min(409, Math.max(32, lines * 15 + 8))
    }
  }
  sheet.autoFilter = { from: { row: 1, column: 1 }, to: { row: Math.max(1, sheet.rowCount), column: headers.length } }
  sheet.pageSetup = { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0, printTitlesRow: '1:1' }
  return sheet
}

function filterDescription(report: CJMReportData, filters: ReportFilters): string {
  const d = report.directories
  const pairs = [
    ['Поиск', filters.query], ['Стадия', report.document.stages.find((s) => s.id === filters.stageId)?.name],
    ['Шаг', report.document.stages.flatMap((s) => s.steps).find((s) => s.id === filters.stepId)?.name],
    ['Участник', d.participants.find((p) => p.id === filters.participantId)?.name], ['Система', d.systems.find((s) => s.id === filters.systemId)?.name],
    ['Состояние для участников и систем', filters.state === 'asIs' ? 'AS IS' : filters.state === 'toBe' ? 'TO BE' : 'Любое'],
    ['Тип инициативы', filters.initiativeType], ['Содержимое', { pains: 'С болями и проблемами', questions: 'С открытыми вопросами', comments: 'С комментариями', '': '' }[filters.content]],
  ]
  return pairs.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join('\n')
}

export async function createReportWorkbook(report: CJMReportData, tables: ReportTable[], options: ExportOptions, imageLoader?: (path: string) => Promise<{ base64: string; width: number; height: number }>) {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'CJM Studio'
  workbook.created = new Date(report.generatedAt)
  const summary = { ...reportMetadata(report),
    'Объём выгрузки': options.full ? 'Полный отчёт' : 'Текущая выборка по всем разделам',
    'Фильтры': options.full ? 'Без фильтров' : filterDescription(report, options.filters),
    'Содержимое редакций': options.includeHistory ? 'Все сохранённые редакции, без фильтров текущей выборки' : 'Только перечень редакций',
    'Изображения': options.includeImages ? 'Встроены на лист Изображения' : 'Без встраивания; перечень на листе Изображения и ссылки',
    'Примечание': 'Данные на момент формирования. Справочники и перечень редакций не ограничиваются фильтрами структуры. Даты в UTC. Комментарии не версионируются. Длинные тексты продолжаются в строках с номером части. Высоту строк можно увеличить в Excel.',
  }
  addTable(workbook, 'Паспорт CJM', ['Параметр', 'Значение'], Object.entries(summary).map(([k, v]) => ({ key: k, cells: { 'Параметр': k, 'Значение': v }, contexts: [] })))
  workbook.getWorksheet('Паспорт CJM')!.getColumn(2).width = 100
  const resourceRows: ReportRow[] = []
  for (const table of tables) {
    addTable(workbook, table.title, table.columns, table.rows)
    if (table.id === 'resources') resourceRows.push(...table.rows)
  }
  if (options.includeHistory) {
    const historyTables = new Map<string, ReportTable>()
    for (const revision of report.revisions) {
      if (!revision.snapshot) throw new Error('Содержимое редакций не загружено. Обновите отчёт.')
      for (const table of buildReportTables(historyReport(report, revision.snapshot))) {
        if (['revisions', 'directories', 'comments'].includes(table.id)) continue
        const rows = table.rows.map((r) => ({ ...r, cells: { 'Редакция': revision.number, 'Название редакции': revision.comment, 'Дата редакции': revision.createdAt, ...r.cells } }))
        const existing = historyTables.get(table.id)
        if (existing) { existing.rows.push(...rows); existing.columns = [...new Set([...existing.columns, ...table.columns])] }
        else historyTables.set(table.id, { ...table, columns: ['Редакция', 'Название редакции', 'Дата редакции', ...table.columns], rows })
        if (table.id === 'resources') resourceRows.push(...rows)
      }
    }
    const historyNames: Record<string, string> = { actions: 'История действий', stages: 'История стадий', steps: 'История шагов', initiatives: 'История инициатив', links: 'История связей', resources: 'История ресурсов' }
    for (const table of historyTables.values()) addTable(workbook, historyNames[table.id], table.columns, table.rows)
    addTable(workbook, 'Паспорта редакций', ['Редакция', 'Параметр', 'Значение'], report.revisions.flatMap((r) => Object.entries(reportMetadata(historyReport(report, r.snapshot!))).filter(([key]) => key !== 'Дата формирования').map(([key, value]) => ({ key: `${r.number}:${key}`, cells: { 'Редакция': r.number, 'Параметр': key, 'Значение': value }, contexts: [] }))))
  }
  if (options.includeImages) {
    const images = resourceRows.filter((r) => r.image)
    if (images.length) {
      if (!imageLoader) throw new Error('Загрузка изображений недоступна')
      const sheet = workbook.addWorksheet('Изображения')
      sheet.columns = [{ header: 'Действие / поле / редакция', width: 48 }, { header: 'Изображение', width: 85 }]
      sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } }
      sheet.getRow(1).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: green } }
      sheet.getRow(1).height = 26
      const cache = new Map<string, { id: number; width: number; height: number }>()
      for (const r of images) {
        let cached = cache.get(r.image!)
        if (!cached) {
          const data = await imageLoader(r.image!)
          cached = { id: workbook.addImage({ base64: data.base64, extension: 'png' }), width: data.width, height: data.height }
          cache.set(r.image!, cached)
        }
        const scale = Math.min(1, 560 / cached.width, 480 / cached.height)
        const added = sheet.addRow([`${r.cells['Действие']}\n${r.cells['Поле']}\n${r.cells['Подпись']}\n${r.cells['Редакция'] ? `Редакция ${r.cells['Редакция']}` : 'Текущая версия'}`, ''])
        added.alignment = { vertical: 'top', wrapText: true }
        added.height = Math.max(100, cached.height * scale * 0.75 + 12)
        sheet.addImage(cached.id, { tl: { col: 1, row: added.number - 1 }, ext: { width: cached.width * scale, height: cached.height * scale }, editAs: 'oneCell' })
      }
      sheet.views = [{ state: 'frozen', ySplit: 1 }]
    }
  }
  return workbook
}

async function loadImage(path: string) {
  const blob = await api.reportImage(path)
  const url = URL.createObjectURL(blob)
  try {
    const image = new Image()
    image.src = url
    await image.decode()
    const canvas = document.createElement('canvas')
    canvas.width = image.naturalWidth; canvas.height = image.naturalHeight
    const context = canvas.getContext('2d')
    if (!context) throw new Error('Не удалось подготовить изображение')
    context.drawImage(image, 0, 0)
    return { base64: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
  } finally { URL.revokeObjectURL(url) }
}

export async function downloadReport(report: CJMReportData, tables: ReportTable[], options: ExportOptions) {
  const workbook = await createReportWorkbook(report, tables, options, loadImage)
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([new Uint8Array(buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  const link = document.createElement('a')
  const name = report.document.name.replace(/[<>:"/\\|?*\u0000-\u001F]/g, '_').slice(0, 100) || 'CJM'
  link.href = url; link.download = `${name}_${options.full ? 'полный_отчёт' : 'выборка'}_${new Date().toISOString().slice(0, 10)}.xlsx`
  document.body.append(link); link.click(); link.remove()
  // Keep an explicit link available when a browser blocks automatic downloads.
  return { url, filename: link.download }
}
