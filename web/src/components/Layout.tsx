import type { ReactNode } from 'react'
import { Archive, BookOpen, Map, Route } from 'lucide-react'

export type AppSection = 'cjms' | 'directories' | 'backups'

interface LayoutProps {
  section: AppSection
  onSection: (section: AppSection) => void
  children: ReactNode
}

export function Layout({ section, onSection, children }: LayoutProps) {
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Route size={18} /></span><span>CJM Studio</span></div>
        <nav className="main-nav" aria-label="Основная навигация">
          <button className={section === 'cjms' ? 'active' : ''} onClick={() => onSection('cjms')}><Map size={17} /><span>CJM</span></button>
          <button className={section === 'directories' ? 'active' : ''} onClick={() => onSection('directories')}><BookOpen size={17} /><span>Справочники</span></button>
          <button className={section === 'backups' ? 'active' : ''} onClick={() => onSection('backups')}><Archive size={17} /><span>Резервные копии</span></button>
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-foot">Локальная версия<br />Данные на этом компьютере</div>
          <div className="sidebar-user" aria-label="Локальный пользователь" title="Локальный пользователь"><span className="avatar">ЛП</span></div>
        </div>
      </aside>
      <div className="app-main">
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}
