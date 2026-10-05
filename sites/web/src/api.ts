import type { ActionComment, AppUser, Bootstrap, CJMDocument, CJMReportData, DirectoryKind, DirectoryRecord, Revision } from './types'

export class ApiError extends Error {
  status: number

  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

let tokenProvider: (() => Promise<string | undefined>) | undefined

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const token = await tokenProvider?.()
  const response = await fetch(url, {
    ...options,
    headers: {
      ...(options?.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options?.headers,
    },
  })
  if (!response.ok) {
    const payload = await response.json().catch(() => ({ error: response.statusText }))
    throw new ApiError(payload.error || 'Ошибка запроса', response.status)
  }
  if (response.status === 204) return undefined as T
  return response.json() as Promise<T>
}

export const api = {
  setTokenProvider: (provider?: () => Promise<string | undefined>) => { tokenProvider = provider },
  me: () => request<AppUser>('/api/auth/me'),
  users: () => request<AppUser[]>('/api/admin/users'),
  updateUserAccess: (subject: string, companyIds: string[], cjmIds: string[]) =>
    request<AppUser>(`/api/admin/users/${encodeURIComponent(subject)}/access`, { method: 'PUT', body: JSON.stringify({ companyIds, cjmIds }) }),
  bootstrap: () => request<Bootstrap>('/api/bootstrap'),
  getCJM: (id: string) => request<CJMDocument>(`/api/cjms/${id}`),
  cjmReport: (id: string, history = false) => request<CJMReportData>(`/api/cjms/${encodeURIComponent(id)}/report${history ? '?history=1' : ''}`),
  reportImage: async (path: string) => {
    if (!/^\/api\/assets\/[^/?#]+$/.test(path)) throw new Error('Некорректный адрес изображения')
    const token = await tokenProvider?.()
    const response = await fetch(path, { headers: token ? { Authorization: `Bearer ${token}` } : {} })
    if (!response.ok) throw new Error(`Не удалось загрузить изображение (${response.status})`)
    return response.blob()
  },
  createCJM: (input: { name: string; companyId: string; actorId: string }) =>
    request<CJMDocument>('/api/cjms', { method: 'POST', body: JSON.stringify(input) }),
  saveCJM: (document: CJMDocument) =>
    request<CJMDocument>(`/api/cjms/${document.id}`, { method: 'PUT', body: JSON.stringify(document) }),
  deleteCJM: (id: string) => request<void>(`/api/cjms/${id}`, { method: 'DELETE' }),
  actionComments: (actionId: string) => request<ActionComment[]>(`/api/actions/${actionId}/comments`),
  createActionComment: (actionId: string, body: string) => request<ActionComment>(`/api/actions/${actionId}/comments`, { method: 'POST', body: JSON.stringify({ body }) }),
  updateActionComment: (actionId: string, commentId: string, body: string) => request<ActionComment>(`/api/actions/${actionId}/comments/${commentId}`, { method: 'PUT', body: JSON.stringify({ body }) }),
  deleteActionComment: (actionId: string, commentId: string) => request<void>(`/api/actions/${actionId}/comments/${commentId}`, { method: 'DELETE' }),
  listDirectory: (kind: DirectoryKind) => request<DirectoryRecord[]>(`/api/directories/${kind}`),
  createDirectory: (kind: DirectoryKind, record: Omit<DirectoryRecord, 'id'>) =>
    request<DirectoryRecord>(`/api/directories/${kind}`, { method: 'POST', body: JSON.stringify(record) }),
  updateDirectory: (kind: DirectoryKind, record: DirectoryRecord) =>
    request<DirectoryRecord>(`/api/directories/${kind}/${record.id}`, { method: 'PUT', body: JSON.stringify(record) }),
  deleteDirectory: (kind: DirectoryKind, id: string) => request<void>(`/api/directories/${kind}/${id}`, { method: 'DELETE' }),
  revisions: (id: string) => request<Revision[]>(`/api/cjms/${id}/revisions`),
  getRevision: (id: string, number: number) => request<Revision>(`/api/cjms/${id}/revisions/${number}`),
  createRevision: (id: string, comment: string) => request<Revision>(`/api/cjms/${id}/revisions`, { method: 'POST', body: JSON.stringify({ comment, kind: 'manual' }) }),
  restoreRevision: (id: string, number: number) => request<CJMDocument>(`/api/cjms/${id}/revisions/${number}/restore`, { method: 'POST' }),
  uploadAsset: async (file: File) => {
    const body = new FormData()
    body.append('file', file)
    return request<{ id: string; url: string; name: string; size: number }>('/api/assets', { method: 'POST', body })
  },
  restoreBackup: async (file: File) => {
    const body = new FormData()
    body.append('backup', file)
    return request<{ ok: boolean; message: string }>('/api/restore', { method: 'POST', body })
  },
}
