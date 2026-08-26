package store

import (
	"context"
	"database/sql"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

type portableTable struct {
	name    string
	columns []string
}

var portableTables = []portableTable{
	{"companies", []string{"id", "be_number", "name", "created_at", "updated_at"}},
	{"directory_counters", []string{"kind", "next_value"}},
	{"actors", []string{"id", "company_id", "business_code", "name", "description", "created_at", "updated_at"}},
	{"participants", []string{"id", "company_id", "business_code", "name", "description", "created_at", "updated_at"}},
	{"systems", []string{"id", "company_id", "business_code", "name", "description", "created_at", "updated_at"}},
	{"cjms", []string{"id", "name", "company_id", "actor_id", "created_at", "updated_at", "created_by", "updated_by", "row_version", "current_revision"}},
	{"stages", []string{"id", "cjm_id", "position", "name", "description"}},
	{"steps", []string{"id", "stage_id", "position", "name", "description"}},
	{"actions", []string{"id", "step_id", "position", "name", "description", "goal_doc", "meaning_doc", "pains_doc", "open_questions"}},
	{"action_states", []string{"action_id", "state", "sequence_doc"}},
	{"action_comments", []string{"id", "cjm_id", "action_id", "author", "body", "created_at", "updated_at"}},
	{"action_state_participants", []string{"action_id", "state", "participant_id"}},
	{"action_state_systems", []string{"action_id", "state", "system_id"}},
	{"step_links", []string{"id", "cjm_id", "source_step_id", "target_step_id", "link_type"}},
	{"initiatives", []string{"id", "company_id", "initiative_type", "name", "description", "created_at", "updated_at"}},
	{"initiative_links", []string{"id", "cjm_id", "initiative_id", "step_id", "action_id"}},
	{"rich_text_assets", []string{"id", "name", "content_type", "size", "checksum", "data", "created_at"}},
	{"cjm_revisions", []string{"cjm_id", "revision_number", "comment", "revision_kind", "snapshot_json", "checksum", "created_at", "created_by"}},
	{"app_users", []string{"subject", "username", "display_name", "email", "role", "last_seen_at", "created_at", "updated_at"}},
	{"user_company_access", []string{"user_subject", "company_id"}},
	{"user_cjm_access", []string{"user_subject", "cjm_id"}},
}

type rowQueryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

type rowExecer interface {
	ExecContext(context.Context, string, ...any) (sql.Result, error)
}

func copyPortableTable(ctx context.Context, source rowQueryer, destination rowExecer, table portableTable) error {
	columnList := strings.Join(table.columns, ",")
	rows, err := source.QueryContext(ctx, fmt.Sprintf("SELECT %s FROM %s", columnList, table.name))
	if err != nil {
		return fmt.Errorf("read %s: %w", table.name, err)
	}
	defer rows.Close()
	placeholders := strings.TrimSuffix(strings.Repeat("?,", len(table.columns)), ",")
	insert := fmt.Sprintf("INSERT INTO %s(%s) VALUES(%s)", table.name, columnList, placeholders)
	for rows.Next() {
		values := make([]any, len(table.columns))
		destinations := make([]any, len(table.columns))
		for i := range values {
			destinations[i] = &values[i]
		}
		if err := rows.Scan(destinations...); err != nil {
			return fmt.Errorf("scan %s: %w", table.name, err)
		}
		if _, err := destination.ExecContext(ctx, insert, values...); err != nil {
			return fmt.Errorf("write %s: %w", table.name, err)
		}
	}
	return rows.Err()
}

func (s *Store) createPortableBackup(ctx context.Context) (path string, err error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	file, err := os.CreateTemp(s.backupDir, "cjm-backup-*.sqlite")
	if err != nil {
		return "", err
	}
	path = file.Name()
	cleanupPath := path
	if err := file.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	defer func() {
		if err != nil {
			os.Remove(cleanupPath)
		}
	}()

	backup, err := openSQLiteDB(path)
	if err != nil {
		return "", err
	}
	defer backup.Close()
	if err := executeSchema(ctx, backup, sqliteSchemaSQL); err != nil {
		return "", fmt.Errorf("initialize backup: %w", err)
	}
	tx, err := backup.BeginTx(ctx, nil)
	if err != nil {
		return "", err
	}
	defer tx.Rollback()
	for _, table := range portableTables {
		if err := copyPortableTable(ctx, s.db, tx, table); err != nil {
			return "", err
		}
	}
	if err := tx.Commit(); err != nil {
		return "", err
	}
	if err := backup.Close(); err != nil {
		return "", err
	}
	return path, nil
}

func (s *Store) restorePortableBackup(ctx context.Context, r io.Reader) error {
	data, err := readAllLimit(r, 500*1024*1024)
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(s.backupDir, "cjm-restore-*.sqlite")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	defer func() {
		os.Remove(tmpPath)
		os.Remove(tmpPath + "-wal")
		os.Remove(tmpPath + "-shm")
	}()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}

	backup, err := openSQLiteDB(tmpPath)
	if err != nil {
		return &ValidationError{Message: "файл не является корректной базой CJM"}
	}
	var integrity string
	if err := backup.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		backup.Close()
		return &ValidationError{Message: "резервная копия повреждена"}
	}
	var tables int
	if err := backup.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='cjms'`).Scan(&tables); err != nil || tables != 1 {
		backup.Close()
		return &ValidationError{Message: "в резервной копии нет структуры CJM"}
	}
	if err := executeSchema(ctx, backup, sqliteSchemaSQL); err != nil {
		backup.Close()
		return fmt.Errorf("update backup schema: %w", err)
	}

	if s.db.dialect == dialectSQLite {
		backup.Close()
		return s.replaceSQLiteDatabase(tmpPath)
	}
	defer backup.Close()

	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.ExecContext(ctx, `TRUNCATE TABLE directory_counters, rich_text_assets, app_users, companies CASCADE`); err != nil {
		return fmt.Errorf("clear PostgreSQL database: %w", err)
	}
	for _, table := range portableTables {
		if err := copyPortableTable(ctx, backup, tx, table); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) replaceSQLiteDatabase(sourcePath string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.db.Close(); err != nil {
		return err
	}
	os.Remove(s.path + "-wal")
	os.Remove(s.path + "-shm")
	previous := s.path + ".before-restore"
	os.Remove(previous)
	if err := os.Rename(s.path, previous); err != nil {
		s.db, _ = openSQLiteDB(s.path)
		return err
	}
	if err := os.Rename(sourcePath, s.path); err != nil {
		os.Rename(previous, s.path)
		s.db, _ = openSQLiteDB(s.path)
		return err
	}
	newDB, err := openSQLiteDB(s.path)
	if err != nil {
		os.Remove(s.path)
		os.Rename(previous, s.path)
		s.db, _ = openSQLiteDB(s.path)
		return err
	}
	if err := executeSchema(context.Background(), newDB, sqliteSchemaSQL); err != nil {
		newDB.Close()
		os.Remove(s.path)
		os.Rename(previous, s.path)
		s.db, _ = openSQLiteDB(s.path)
		return fmt.Errorf("update restored database: %w", err)
	}
	s.db = newDB
	os.Remove(previous)
	return nil
}

func (s *Store) ImportSQLiteIfEmpty(ctx context.Context, path string) (bool, error) {
	s.mu.RLock()
	var count int
	err := s.db.QueryRowContext(ctx, `SELECT COUNT(*) FROM companies`).Scan(&count)
	s.mu.RUnlock()
	if err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}
	file, err := os.Open(filepath.Clean(path))
	if err != nil {
		return false, err
	}
	defer file.Close()
	if err := s.RestoreBackup(ctx, file); err != nil {
		return false, err
	}
	return true, nil
}
