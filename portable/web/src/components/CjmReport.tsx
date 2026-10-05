import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Download, FileSpreadsheet, RefreshCw, Search, X } from 'lucide-react'
import { api } from '../api'
import { buildReportTables, emptyFilters, filterReportTables, reportMetadata, type ReportFilters, type ReportRow, type ReportValue } from '../report'
import type { CJMReportData } from '../types'
import './CjmReport.css'
import { imageSource } from '../offline'

const display = (value: ReportValue) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value) && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleString('ru-RU') : String(value)
const errorText = (reason: unknown) => reason instanceof Error ? reason.message : 'Не удалось сформировать отчёт'

export function CjmReport({ cjmId, rowVersion, dirty, onSave, canSave }: { cjmId: string; rowVersion: number; dirty: boolean; onSave: () => Promise<void>; canSave: boolean }) {
  const [report, setReport] = useState<CJMReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [refresh, setRefresh] = useState(0)
  const [filters, setFilters] = useState<ReportFilters>({ ...emptyFilters })
  const [section, setSection] = useState('actions')
  const [page, setPage] = useState(0)
  const [allColumns, setAllColumns] = useState(true)
  const [sort, setSort] = useState<{ column: string; direction: number } | null>(null)
  const [selected, setSelected] = useState<ReportRow | null>(null)
  const [exporting, setExporting] = useState(false)
  const [includeHistory, setIncludeHistory] = useState(true)
  const [includeImages, setIncludeImages] = useState(true)
  const [download, setDownload] = useState<{ url: string; filename: string } | null>(null)
  const dialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    setLoading(true); setError(''); setSelected(null)
    api.cjmReport(cjmId).then((data) => { if (active) setReport(data) }).catch((reason) => { if (active) setError(errorText(reason)) }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [cjmId, rowVersion, refresh])
  useEffect(() => { setPage(0); setSelected(null) }, [filters, section, sort, report])
  useEffect(() => {
    if (selected) dialog.current?.showModal()
    else dialog.current?.close()
  }, [selected])
  useEffect(() => () => { if (download) URL.revokeObjectURL(download.url) }, [download])

  const tables = useMemo(() => report ? buildReportTables(report) : [], [report])
  const filtered = useMemo(() => filterReportTables(tables, filters), [tables, filters])
  const current = filtered.find((t) => t.id === section)
  const sortedRows = useMemo(() => {
    if (!current) return []
    if (!sort) return current.rows
    const collator = new Intl.Collator('ru', { numeric: true, sensitivity: 'base' })
    return [...current.rows].sort((a, b) => collator.compare(String(a.cells[sort.column] ?? ''), String(b.cells[sort.column] ?? '')) * sort.direction)
  }, [current, sort])
  const pages = Math.max(1, Math.ceil(sortedRows.length / 50))
  const currentPage = Math.min(page, pages - 1)
  const shown = sortedRows.slice(currentPage * 50, (currentPage + 1) * 50)
  const setFilter = <K extends keyof ReportFilters>(key: K, value: ReportFilters[K]) => setFilters((prev) => ({ ...prev, [key]: value, ...(key === 'stageId' ? { stepId: '' } : {}) }))
  const hasFilters = Object.values(filters).some(Boolean)
  const changeSection = (id: string) => { setSection(id); setSort(null) }

  const exportExcel = async (full: boolean) => {
    if (!report) return
    setExporting(true); setError(''); setNotice('')
    try {
      // Refresh the whole snapshot once, so history and current rows cannot come from different saves.
      const data = await api.cjmReport(cjmId, includeHistory)
      const all = buildReportTables(data)
      const selectedTables = full ? all : filterReportTables(all, filters)
      if (!full && !selectedTables.some((t) => t.rows.length)) throw new Error('В текущей выборке нет строк для выгрузки')
      const { downloadReport } = await import('../reportExcel')
      setDownload(await downloadReport(data, selectedTables, { full, filters, includeHistory, includeImages }))
      setReport(data)
      setNotice(full ? 'Полный отчёт Excel сформирован. Файл передан в загрузки браузера.' : 'Выборка по всем разделам выгружена в Excel, включая строки на остальных страницах.')
    } catch (reason) { setError(errorText(reason)) } finally { setExporting(false) }
  }

  if (loading && !report) return <section className="panel empty-state" role="status">Загрузка полного отчёта…</section>
  if (!report) return <section className="panel empty-state"><p role="alert">{error}</p><button className="button" onClick={() => setRefresh((n) => n + 1)}>Повторить загрузку</button></section>
  const columns = allColumns ? current?.columns ?? [] : current?.preview ?? []
  const dirs = report.directories
  return <section className="cjm-report" aria-label="Полный отчёт CJM">
    <header className="report-heading"><div><h2><FileSpreadsheet size={22} />Полный отчёт</h2><p>Сохранённые данные на {display(report.generatedAt)} · v{report.document.currentRevision}</p></div><div className="report-buttons">
      <button className="button" disabled={loading || exporting} onClick={() => setRefresh((n) => n + 1)}><RefreshCw size={16} />{loading ? 'Обновление…' : 'Обновить'}</button>
      <button className="button" disabled={loading || exporting || !filtered.some((t) => t.rows.length)} onClick={() => void exportExcel(false)}><Download size={16} />Excel: выборка</button>
      <button className="button primary" disabled={loading || exporting} onClick={() => void exportExcel(true)}><Download size={16} />{exporting ? 'Формирование Excel…' : 'Excel: полный отчёт'}</button>
    </div></header>
    {dirty && <div className="notice report-warning"><span>Есть несохранённые изменения. Отчёт использует последнюю сохранённую версию CJM.</span>{canSave && <button className="button" onClick={() => void onSave()}>Сохранить изменения</button>}</div>}
    {error && <div className="notice error" role="alert"><span>{error}</span><button onClick={() => setError('')} aria-label="Закрыть ошибку">×</button></div>}
    {notice && <div className="notice success" role="status">{notice}</div>}
    {download && <div className="report-download"><a className="button" href={download.url} download={download.filename}><Download size={16} />Скачать файл .xlsx</a><span>{download.filename}</span></div>}
    <div className="report-options"><label><input type="checkbox" checked={includeHistory} disabled={exporting} onChange={(e) => setIncludeHistory(e.target.checked)} />Добавлять содержимое всех редакций в Excel</label><label><input type="checkbox" checked={includeImages} disabled={exporting} onChange={(e) => setIncludeImages(e.target.checked)} />Встраивать изображения в Excel</label></div>
    <details className="panel report-passport"><summary>Паспорт CJM <span>{report.document.name}</span></summary><dl>{Object.entries(reportMetadata(report)).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value) || '—'}</dd></div>)}</dl></details>
    <section className="panel report-filter-panel" aria-label="Фильтры отчёта">
      <label className="field report-search"><span>Поиск по всем полям и разделам</span><span className="input-with-icon"><Search size={16} /><input type="search" value={filters.query} onChange={(e) => setFilter('query', e.target.value)} placeholder="Название, описание, боль, вопрос, комментарий…" /></span></label>
      <label className="field"><span>Стадия</span><select value={filters.stageId} onChange={(e) => setFilter('stageId', e.target.value)}><option value="">Все стадии</option>{report.document.stages.map((s, i) => <option key={s.id} value={s.id}>{i + 1}. {s.name}</option>)}</select></label>
      <label className="field"><span>Шаг</span><select value={filters.stepId} onChange={(e) => setFilter('stepId', e.target.value)}><option value="">Все шаги</option>{report.document.stages.filter((s) => !filters.stageId || s.id === filters.stageId).flatMap((s) => s.steps.map((p) => <option key={p.id} value={p.id}>{s.name} / {p.name}</option>))}</select></label>
      <label className="field"><span>Участник</span><select value={filters.participantId} onChange={(e) => setFilter('participantId', e.target.value)}><option value="">Все участники</option>{dirs.participants.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
      <label className="field"><span>Система</span><select value={filters.systemId} onChange={(e) => setFilter('systemId', e.target.value)}><option value="">Все системы</option>{dirs.systems.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
      <label className="field"><span>Искать участника и систему в</span><select value={filters.state} onChange={(e) => setFilter('state', e.target.value as ReportFilters['state'])}><option value="">AS IS или TO BE</option><option value="asIs">AS IS</option><option value="toBe">TO BE</option></select></label>
      <label className="field"><span>Тип инициативы</span><select value={filters.initiativeType} onChange={(e) => setFilter('initiativeType', e.target.value)}><option value="">Все типы</option>{['Live', 'Future', 'Gap', 'MVP1', 'MVP2', 'MVP3'].map((type) => <option key={type}>{type}</option>)}</select></label>
      <label className="field"><span>Содержимое действия</span><select value={filters.content} onChange={(e) => setFilter('content', e.target.value as ReportFilters['content'])}><option value="">Все действия</option><option value="pains">С болями и проблемами</option><option value="questions">С открытыми вопросами</option><option value="comments">С комментариями</option></select></label>
      <div className="report-filter-foot"><span>Фильтры структуры действуют на стадии, шаги и связанные сведения. Поиск — на все разделы. Содержимое прошлых редакций добавляется в Excel целиком.</span><button className="button ghost" disabled={!hasFilters} onClick={() => setFilters({ ...emptyFilters })}><X size={15} />Сбросить фильтры</button></div>
    </section>
    <nav className="report-sections" aria-label="Разделы отчёта">{filtered.map((t) => <button key={t.id} className={section === t.id ? 'active' : ''} aria-pressed={section === t.id} onClick={() => changeSection(t.id)}>{t.title}<span>{t.rows.length}</span></button>)}</nav>
    <section className="panel report-results" aria-busy={loading}>
      <div className="report-results-head"><span role="status">{current?.title}: <strong>{current?.rows.length ?? 0}</strong> из {tables.find((t) => t.id === section)?.rows.length ?? 0}</span><label><input type="checkbox" checked={allColumns} onChange={(e) => setAllColumns(e.target.checked)} />Все столбцы</label></div>
      <div className="report-scroll"><table><caption className="report-sr-only">{current?.title}. Нажмите заголовок для сортировки или «Подробнее» для всех полей.</caption><thead><tr><th>Карточка</th>{columns.map((col) => <th key={col} aria-sort={sort?.column === col ? sort.direction === 1 ? 'ascending' : 'descending' : 'none'}><button onClick={() => setSort({ column: col, direction: sort?.column === col ? -sort.direction : 1 })}>{col}{sort?.column === col && <span>{sort.direction === 1 ? ' ↑' : ' ↓'}</span>}</button></th>)}</tr></thead><tbody>{shown.map((r) => <tr key={r.key}><td><button className="button ghost" onClick={() => setSelected(r)}>Подробнее<ChevronDown size={13} /></button></td>{columns.map((col) => <td key={col}><div className="report-cell">{display(r.cells[col] ?? '') || '—'}</div></td>)}</tr>)}{!shown.length && <tr><td colSpan={columns.length + 1} className="empty-cell">По заданным условиям ничего не найдено.{hasFilters && <button className="button ghost" onClick={() => setFilters({ ...emptyFilters })}>Сбросить фильтры</button>}</td></tr>}</tbody></table></div>
      <footer className="report-pagination"><span>Страница {currentPage + 1} из {pages} · по 50 строк. В Excel попадут все найденные строки.</span><div><button className="button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Назад</button><button className="button" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}>Далее</button></div></footer>
    </section>
    <dialog ref={dialog} className="report-dialog" aria-labelledby="report-detail-title" onCancel={() => setSelected(null)} onClose={() => setSelected(null)}><div className="report-dialog-head"><h2 id="report-detail-title">Все сведения</h2><button className="icon-button" onClick={() => setSelected(null)} aria-label="Закрыть карточку"><X size={20} /></button></div>{selected && <><dl>{Object.entries(selected.cells).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{display(value) || '—'}</dd></div>)}</dl>{selected.image && <img src={imageSource(selected.image)} alt={String(selected.cells['Подпись'] || 'Изображение из CJM')} />}</>}</dialog>
  </section>
}
