package store

const sqliteSchemaSQL = `
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  be_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directory_counters (
  kind TEXT PRIMARY KEY CHECK(kind IN ('actors','participants','systems')),
  next_value INTEGER NOT NULL CHECK(next_value > 0)
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, business_code)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, business_code)
);

CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, business_code)
);

CREATE TABLE IF NOT EXISTS cjms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  current_revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(cjm_id, position)
);

CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(stage_id, position)
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  goal_doc TEXT NOT NULL,
  meaning_doc TEXT NOT NULL,
  pains_doc TEXT NOT NULL,
  open_questions TEXT NOT NULL DEFAULT '',
  UNIQUE(step_id, position)
);

CREATE TABLE IF NOT EXISTS action_states (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('as_is','to_be')),
  sequence_doc TEXT NOT NULL,
  PRIMARY KEY(action_id, state)
);

CREATE TABLE IF NOT EXISTS action_comments (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_state_participants (
  action_id TEXT NOT NULL,
  state TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  PRIMARY KEY(action_id, state, participant_id),
  FOREIGN KEY(action_id, state) REFERENCES action_states(action_id, state) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_state_systems (
  action_id TEXT NOT NULL,
  state TEXT NOT NULL,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE RESTRICT,
  PRIMARY KEY(action_id, state, system_id),
  FOREIGN KEY(action_id, state) REFERENCES action_states(action_id, state) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS step_links (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  source_step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK(link_type IN ('main','additional','alternative')),
  UNIQUE(cjm_id, source_step_id, target_step_id, link_type)
);

CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  initiative_type TEXT NOT NULL CHECK(initiative_type IN ('Live','Future','Gap','MVP1','MVP2','MVP3')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS initiative_links (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE RESTRICT,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES actions(id) ON DELETE CASCADE,
  UNIQUE(cjm_id, initiative_id, step_id, action_id)
);

CREATE TABLE IF NOT EXISTS rich_text_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  checksum TEXT NOT NULL,
  data BLOB NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cjm_revisions (
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  revision_kind TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(cjm_id, revision_number)
);

CREATE TABLE IF NOT EXISTS app_users (
  subject TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_company_access (
  user_subject TEXT NOT NULL REFERENCES app_users(subject) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY(user_subject, company_id)
);

CREATE TABLE IF NOT EXISTS user_cjm_access (
  user_subject TEXT NOT NULL REFERENCES app_users(subject) ON DELETE CASCADE,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  PRIMARY KEY(user_subject, cjm_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_hash TEXT PRIMARY KEY,
  user_subject TEXT NOT NULL REFERENCES app_users(subject) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actors_company ON actors(company_id);
CREATE INDEX IF NOT EXISTS idx_participants_company ON participants(company_id);
CREATE INDEX IF NOT EXISTS idx_systems_company ON systems(company_id);
CREATE INDEX IF NOT EXISTS idx_cjms_company ON cjms(company_id);
CREATE INDEX IF NOT EXISTS idx_stages_cjm ON stages(cjm_id, position);
CREATE INDEX IF NOT EXISTS idx_steps_stage ON steps(stage_id, position);
CREATE INDEX IF NOT EXISTS idx_actions_step ON actions(step_id, position);
CREATE INDEX IF NOT EXISTS idx_action_comments_action ON action_comments(action_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_links_cjm ON step_links(cjm_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_company ON initiatives(company_id);
CREATE INDEX IF NOT EXISTS idx_revisions_cjm ON cjm_revisions(cjm_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_user_company_access_company ON user_company_access(company_id, user_subject);
CREATE INDEX IF NOT EXISTS idx_user_cjm_access_cjm ON user_cjm_access(cjm_id, user_subject);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
`

const postgresSchemaSQL = `
CREATE TABLE IF NOT EXISTS companies (
  id TEXT PRIMARY KEY,
  be_number TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS directory_counters (
  kind TEXT PRIMARY KEY CHECK(kind IN ('actors','participants','systems')),
  next_value INTEGER NOT NULL CHECK(next_value > 0)
);

CREATE TABLE IF NOT EXISTS actors (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, business_code)
);

CREATE TABLE IF NOT EXISTS participants (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, business_code)
);

CREATE TABLE IF NOT EXISTS systems (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  business_code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(company_id, business_code)
);

CREATE TABLE IF NOT EXISTS cjms (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  actor_id TEXT NOT NULL REFERENCES actors(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  updated_by TEXT NOT NULL,
  row_version INTEGER NOT NULL DEFAULT 1,
  current_revision INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS stages (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(cjm_id, position)
);

CREATE TABLE IF NOT EXISTS steps (
  id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL REFERENCES stages(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  UNIQUE(stage_id, position)
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  goal_doc TEXT NOT NULL,
  meaning_doc TEXT NOT NULL,
  pains_doc TEXT NOT NULL,
  open_questions TEXT NOT NULL DEFAULT '',
  UNIQUE(step_id, position)
);

CREATE TABLE IF NOT EXISTS action_states (
  action_id TEXT NOT NULL REFERENCES actions(id) ON DELETE CASCADE,
  state TEXT NOT NULL CHECK(state IN ('as_is','to_be')),
  sequence_doc TEXT NOT NULL,
  PRIMARY KEY(action_id, state)
);

CREATE TABLE IF NOT EXISTS action_comments (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  action_id TEXT NOT NULL,
  author TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS action_state_participants (
  action_id TEXT NOT NULL,
  state TEXT NOT NULL,
  participant_id TEXT NOT NULL REFERENCES participants(id) ON DELETE RESTRICT,
  PRIMARY KEY(action_id, state, participant_id),
  FOREIGN KEY(action_id, state) REFERENCES action_states(action_id, state) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS action_state_systems (
  action_id TEXT NOT NULL,
  state TEXT NOT NULL,
  system_id TEXT NOT NULL REFERENCES systems(id) ON DELETE RESTRICT,
  PRIMARY KEY(action_id, state, system_id),
  FOREIGN KEY(action_id, state) REFERENCES action_states(action_id, state) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS step_links (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  source_step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  target_step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  link_type TEXT NOT NULL CHECK(link_type IN ('main','additional','alternative')),
  UNIQUE(cjm_id, source_step_id, target_step_id, link_type)
);

CREATE TABLE IF NOT EXISTS initiatives (
  id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE RESTRICT,
  initiative_type TEXT NOT NULL CHECK(initiative_type IN ('Live','Future','Gap','MVP1','MVP2','MVP3')),
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS initiative_links (
  id TEXT PRIMARY KEY,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  initiative_id TEXT NOT NULL REFERENCES initiatives(id) ON DELETE RESTRICT,
  step_id TEXT NOT NULL REFERENCES steps(id) ON DELETE CASCADE,
  action_id TEXT REFERENCES actions(id) ON DELETE CASCADE,
  UNIQUE(cjm_id, initiative_id, step_id, action_id)
);

CREATE TABLE IF NOT EXISTS rich_text_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size BIGINT NOT NULL,
  checksum TEXT NOT NULL,
  data BYTEA NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS cjm_revisions (
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  comment TEXT NOT NULL DEFAULT '',
  revision_kind TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  checksum TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL,
  PRIMARY KEY(cjm_id, revision_number)
);

CREATE TABLE IF NOT EXISTS app_users (
  subject TEXT PRIMARY KEY,
  username TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL,
  email TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL CHECK(role IN ('admin','editor','viewer')),
  last_seen_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS user_company_access (
  user_subject TEXT NOT NULL REFERENCES app_users(subject) ON DELETE CASCADE,
  company_id TEXT NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  PRIMARY KEY(user_subject, company_id)
);

CREATE TABLE IF NOT EXISTS user_cjm_access (
  user_subject TEXT NOT NULL REFERENCES app_users(subject) ON DELETE CASCADE,
  cjm_id TEXT NOT NULL REFERENCES cjms(id) ON DELETE CASCADE,
  PRIMARY KEY(user_subject, cjm_id)
);

CREATE TABLE IF NOT EXISTS auth_sessions (
  session_hash TEXT PRIMARY KEY,
  user_subject TEXT NOT NULL REFERENCES app_users(subject) ON DELETE CASCADE,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_actors_company ON actors(company_id);
CREATE INDEX IF NOT EXISTS idx_participants_company ON participants(company_id);
CREATE INDEX IF NOT EXISTS idx_systems_company ON systems(company_id);
CREATE INDEX IF NOT EXISTS idx_cjms_company ON cjms(company_id);
CREATE INDEX IF NOT EXISTS idx_stages_cjm ON stages(cjm_id, position);
CREATE INDEX IF NOT EXISTS idx_steps_stage ON steps(stage_id, position);
CREATE INDEX IF NOT EXISTS idx_actions_step ON actions(step_id, position);
CREATE INDEX IF NOT EXISTS idx_action_comments_action ON action_comments(action_id, created_at, id);
CREATE INDEX IF NOT EXISTS idx_links_cjm ON step_links(cjm_id);
CREATE INDEX IF NOT EXISTS idx_initiatives_company ON initiatives(company_id);
CREATE INDEX IF NOT EXISTS idx_revisions_cjm ON cjm_revisions(cjm_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_user_company_access_company ON user_company_access(company_id, user_subject);
CREATE INDEX IF NOT EXISTS idx_user_cjm_access_cjm ON user_cjm_access(cjm_id, user_subject);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);
`
