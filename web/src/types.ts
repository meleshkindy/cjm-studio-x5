export type RichDoc = Record<string, unknown>

export const emptyRichDoc: RichDoc = {
  type: 'doc',
  content: [{ type: 'paragraph' }],
}

export type DirectoryKind = 'companies' | 'actors' | 'participants' | 'systems'

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface AuthConfig {
  enabled: boolean
  url?: string
  realm?: string
  clientId?: string
  restorePasswordUrl?: string
}

export interface AppUser {
  subject: string
  username: string
  displayName: string
  email?: string
  role: UserRole
  companyIds: string[]
  cjmIds: string[]
  lastSeenAt?: string
  createdAt?: string
  updatedAt?: string
}

export interface DirectoryRecord {
  id: string
  companyId?: string
  code: string
  name: string
  description?: string
}

export interface ActionState {
  participants: string[]
  systems: string[]
  sequence: RichDoc
}

export interface CJMAction {
  id: string
  position: number
  name: string
  description: string
  goal: RichDoc
  meaning: RichDoc
  pains: RichDoc
  openQuestions: string
  asIs: ActionState
  toBe: ActionState
}

export interface ActionComment {
  id: string
  actionId: string
  author: string
  body: string
  createdAt: string
  updatedAt: string
}

export interface CJMStep {
  id: string
  position: number
  name: string
  description: string
  actions: CJMAction[]
}

export interface CJMStage {
  id: string
  position: number
  name: string
  description: string
  steps: CJMStep[]
}

export type LinkType = 'main' | 'additional' | 'alternative'

export interface StepLink {
  id: string
  sourceId: string
  targetId: string
  type: LinkType
}

export type InitiativeType = 'Live' | 'Future' | 'Gap' | 'MVP1' | 'MVP2' | 'MVP3'

export interface Initiative {
  id: string
  companyId: string
  type: InitiativeType
  name: string
  description: string
}

export interface InitiativeLink {
  id: string
  initiativeId: string
  stepId: string
  actionId?: string
}

export interface CJMDocument {
  id: string
  name: string
  companyId: string
  actorId: string
  createdAt: string
  updatedAt: string
  createdBy: string
  updatedBy: string
  rowVersion: number
  currentRevision: number
  stages: CJMStage[]
  links: StepLink[]
  initiatives: Initiative[]
  initiativeLinks: InitiativeLink[]
  deletedInitiativeIds?: string[]
}

export interface CJMSummary {
  id: string
  name: string
  companyId: string
  companyName: string
  actorId: string
  actorName: string
  stageCount: number
  stepCount: number
  revision: number
  updatedAt: string
}

export interface Bootstrap {
  companies: DirectoryRecord[]
  actors: DirectoryRecord[]
  participants: DirectoryRecord[]
  systems: DirectoryRecord[]
  cjms: CJMSummary[]
}

export interface Revision {
  number: number
  comment: string
  kind: string
  createdAt: string
  createdBy: string
  snapshot?: CJMDocument
}

export type NodeSelection =
  | { kind: 'stage'; stageId: string }
  | { kind: 'step'; stageId: string; stepId: string }
  | { kind: 'action'; stageId: string; stepId: string; actionId: string }

export const uid = () => crypto.randomUUID()

export const newAction = (name = 'Новое действие'): CJMAction => ({
  id: uid(),
  position: 0,
  name,
  description: '',
  goal: structuredClone(emptyRichDoc),
  meaning: structuredClone(emptyRichDoc),
  pains: structuredClone(emptyRichDoc),
  openQuestions: '',
  asIs: { participants: [], systems: [], sequence: structuredClone(emptyRichDoc) },
  toBe: { participants: [], systems: [], sequence: structuredClone(emptyRichDoc) },
})
