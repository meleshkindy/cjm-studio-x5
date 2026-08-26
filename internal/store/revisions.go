package store

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"

	"cjmstudio/internal/domain"
)

func (s *Store) CreateRevision(ctx context.Context, cjmID, comment, kind string) (domain.Revision, error) {
	if kind == "" {
		kind = "manual"
	}
	doc, err := s.GetCJM(ctx, cjmID)
	if err != nil {
		return domain.Revision{}, err
	}
	data, err := json.Marshal(doc)
	if err != nil {
		return domain.Revision{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.Revision{}, err
	}
	defer tx.Rollback()
	var number int
	if err := tx.QueryRowContext(ctx, `SELECT COALESCE(MAX(revision_number),0)+1 FROM cjm_revisions WHERE cjm_id=?`, cjmID).Scan(&number); err != nil {
		return domain.Revision{}, err
	}
	created := now()
	hash := checksum(data)
	if _, err := tx.ExecContext(ctx, `INSERT INTO cjm_revisions(cjm_id,revision_number,comment,revision_kind,snapshot_json,checksum,created_at,created_by) VALUES(?,?,?,?,?,?,?,?)`, cjmID, number, strings.TrimSpace(comment), kind, string(data), hash, created, localUser); err != nil {
		return domain.Revision{}, err
	}
	if _, err := tx.ExecContext(ctx, `UPDATE cjms SET current_revision=?,updated_at=?,updated_by=? WHERE id=?`, number, created, localUser, cjmID); err != nil {
		return domain.Revision{}, err
	}
	if err := tx.Commit(); err != nil {
		return domain.Revision{}, err
	}
	return domain.Revision{Number: number, Comment: comment, Kind: kind, CreatedAt: created, CreatedBy: localUser}, nil
}

func (s *Store) ListRevisions(ctx context.Context, cjmID string) ([]domain.Revision, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.QueryContext(ctx, `SELECT revision_number,comment,revision_kind,created_at,created_by FROM cjm_revisions WHERE cjm_id=? ORDER BY revision_number DESC`, cjmID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.Revision{}
	for rows.Next() {
		var item domain.Revision
		if err := rows.Scan(&item.Number, &item.Comment, &item.Kind, &item.CreatedAt, &item.CreatedBy); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) GetRevision(ctx context.Context, cjmID string, number int) (domain.Revision, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var item domain.Revision
	var snapshot string
	err := s.db.QueryRowContext(ctx, `SELECT revision_number,comment,revision_kind,created_at,created_by,snapshot_json FROM cjm_revisions WHERE cjm_id=? AND revision_number=?`, cjmID, number).Scan(&item.Number, &item.Comment, &item.Kind, &item.CreatedAt, &item.CreatedBy, &snapshot)
	if err != nil {
		return item, err
	}
	var doc domain.CJMDocument
	if err := json.Unmarshal([]byte(snapshot), &doc); err != nil {
		return item, err
	}
	item.Snapshot = &doc
	return item, nil
}

func (s *Store) RestoreRevision(ctx context.Context, cjmID string, number int) (*domain.CJMDocument, error) {
	if _, err := s.CreateRevision(ctx, cjmID, "Перед восстановлением редакции", "pre_restore"); err != nil {
		return nil, err
	}
	revision, err := s.GetRevision(ctx, cjmID, number)
	if err != nil {
		return nil, err
	}
	current, err := s.GetCJM(ctx, cjmID)
	if err != nil {
		return nil, err
	}
	revision.Snapshot.RowVersion = current.RowVersion
	revision.Snapshot.CurrentRevision = current.CurrentRevision
	if _, err := s.SaveCJM(ctx, revision.Snapshot); err != nil {
		return nil, err
	}
	if _, err := s.CreateRevision(ctx, cjmID, fmt.Sprintf("Восстановлено из v%d", number), "restore"); err != nil {
		return nil, err
	}
	return s.GetCJM(ctx, cjmID)
}

func (s *Store) SaveAsset(ctx context.Context, name string, r io.Reader) (domain.Asset, error) {
	data, err := readAllLimit(r, 5*1024*1024)
	if err != nil {
		return domain.Asset{}, err
	}
	kind, ok := detectImage(data)
	if !ok {
		return domain.Asset{}, &ValidationError{Message: "разрешены только PNG, JPEG и WebP"}
	}
	asset := domain.Asset{ID: newID(), Name: filepath.Base(name), ContentType: kind, Size: int64(len(data)), Data: data}
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, err = s.db.ExecContext(ctx, `INSERT INTO rich_text_assets(id,name,content_type,size,checksum,data,created_at) VALUES(?,?,?,?,?,?,?)`, asset.ID, asset.Name, asset.ContentType, asset.Size, checksum(data), asset.Data, now())
	return asset, err
}

func (s *Store) GetAsset(ctx context.Context, id string) (domain.Asset, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var a domain.Asset
	err := s.db.QueryRowContext(ctx, `SELECT id,name,content_type,size,data FROM rich_text_assets WHERE id=?`, id).Scan(&a.ID, &a.Name, &a.ContentType, &a.Size, &a.Data)
	return a, err
}

func (s *Store) CreateBackup(ctx context.Context) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	dir := filepath.Dir(s.path)
	file, err := os.CreateTemp(dir, "cjm-backup-*.sqlite")
	if err != nil {
		return "", err
	}
	path := file.Name()
	file.Close()
	os.Remove(path)
	quoted := strings.ReplaceAll(filepath.ToSlash(path), "'", "''")
	if _, err := s.db.ExecContext(ctx, `VACUUM INTO '`+quoted+`'`); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

func (s *Store) RestoreBackup(ctx context.Context, r io.Reader) error {
	data, err := readAllLimit(r, 500*1024*1024)
	if err != nil {
		return err
	}
	dir := filepath.Dir(s.path)
	tmp, err := os.CreateTemp(dir, "cjm-restore-*.sqlite")
	if err != nil {
		return err
	}
	tmpPath := tmp.Name()
	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmp.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	check, err := openDB(tmpPath)
	if err != nil {
		os.Remove(tmpPath)
		return &ValidationError{Message: "файл не является корректной базой CJM"}
	}
	var integrity string
	if err := check.QueryRowContext(ctx, `PRAGMA integrity_check`).Scan(&integrity); err != nil || integrity != "ok" {
		check.Close()
		os.Remove(tmpPath)
		return &ValidationError{Message: "резервная копия повреждена"}
	}
	var tables int
	if err := check.QueryRowContext(ctx, `SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='cjms'`).Scan(&tables); err != nil || tables != 1 {
		check.Close()
		os.Remove(tmpPath)
		return &ValidationError{Message: "в резервной копии нет структуры CJM"}
	}
	check.Close()

	s.mu.Lock()
	defer s.mu.Unlock()
	if err := s.db.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}
	previous := s.path + ".before-restore"
	os.Remove(previous)
	if err := os.Rename(s.path, previous); err != nil {
		os.Remove(tmpPath)
		return err
	}
	if err := os.Rename(tmpPath, s.path); err != nil {
		os.Rename(previous, s.path)
		s.db, _ = openDB(s.path)
		return err
	}
	newDB, err := openDB(s.path)
	if err != nil {
		os.Remove(s.path)
		os.Rename(previous, s.path)
		s.db, _ = openDB(s.path)
		return err
	}
	if _, err := newDB.Exec(schemaSQL); err != nil {
		newDB.Close()
		os.Remove(s.path)
		os.Rename(previous, s.path)
		s.db, _ = openDB(s.path)
		return fmt.Errorf("обновить структуру восстановленной базы: %w", err)
	}
	s.db = newDB
	os.Remove(previous)
	return nil
}

func RevisionChecksum(doc *domain.CJMDocument) (string, error) {
	data, err := json.Marshal(doc)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(data)
	return hex.EncodeToString(sum[:]), nil
}

func isNotFound(err error) bool { return err == sql.ErrNoRows }
