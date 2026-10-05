import type { ReactNode } from 'react'
import { Archive, BookOpen, KeyRound, LogOut, Map, Route } from 'lucide-react'
import type { AppUser } from '../types'

export type AppSection = 'cjms' | 'directories' | 'backups' | 'users'

interface LayoutProps {
  section: AppSection
  onSection: (section: AppSection) => void
  user: AppUser
  authenticationEnabled: boolean
  restorePasswordUrl?: string
  onLogout: () => void
  children: ReactNode
}

export function Layout({ section, onSection, user, authenticationEnabled, restorePasswordUrl, onLogout, children }: LayoutProps) {
  const isAdmin = user.role === 'admin'
  const initials = user.displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'П'
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><Route size={18} /></span><span>CJM Studio</span></div>
        <nav className="main-nav" aria-label="Основная навигация">
          <button className={section === 'cjms' ? 'active' : ''} onClick={() => onSection('cjms')}><Map size={17} /><span>CJM</span></button>
          {isAdmin && <button className={section === 'directories' ? 'active' : ''} onClick={() => onSection('directories')}><BookOpen size={17} /><span>Справочники</span></button>}
          {isAdmin && <button className={section === 'backups' ? 'active' : ''} onClick={() => onSection('backups')}><Archive size={17} /><span>Резервные копии</span></button>}
        </nav>
        <div className="sidebar-bottom">
          <div className="sidebar-foot">Офлайн-копия · HTML<br />Данные сохраняются в этом браузере. Передать правки: «Резервные копии» → «Скачать HTML».</div>
          <div className="sidebar-user"><span className="avatar" aria-label={user.displayName} title={`${user.displayName} · ${roleLabel(user.role)}`}>{initials}</span>{authenticationEnabled && restorePasswordUrl && <a href={restorePasswordUrl} target="_blank" rel="noreferrer" aria-label="Изменить пароль" title="Изменить пароль"><KeyRound size={16} /></a>}{authenticationEnabled && <button type="button" aria-label="Выйти" title="Выйти" onClick={onLogout}><LogOut size={16} /></button>}</div>
        </div>
      </aside>
      <div className="app-main">
        <main className="page-content">{children}</main>
      </div>
    </div>
  )
}

function roleLabel(role: AppUser['role']) {
  return ({ admin: 'Администратор', editor: 'Редактор', viewer: 'Просмотр' } as const)[role]
}
