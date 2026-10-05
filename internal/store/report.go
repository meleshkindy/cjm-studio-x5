package store

import (
	"context"
	"database/sql"
	"encoding/json"

	"cjmstudio/internal/domain"
)

// Read every part of the report from the same database snapshot.
func (s *Store) GetCJMReport(ctx context.Context, id string, history bool) (*domain.CJMReport, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	opts := &sql.TxOptions{ReadOnly: true}
	if s.db.dialect == dialectPostgres {
		opts.Isolation = sql.LevelRepeatableRead
	}
	tx, err := s.db.BeginTx(ctx, opts)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	doc, err := getCJM(ctx, tx, id)
	if err != nil {
		return nil, err
	}
	report := &domain.CJMReport{
		GeneratedAt: now(), Document: doc,
		Comments: []domain.ActionComment{}, Revisions: []domain.Revision{},
		Directories: domain.Bootstrap{CJMs: []domain.CJMSummary{}},
	}
	for _, dir := range []struct {
		kind, condition string
		target          *[]domain.DirectoryRecord
	}{
		{"companies", "id=?", &report.Directories.Companies},
		{"actors", "company_id=?", &report.Directories.Actors},
		{"participants", "company_id=?", &report.Directories.Participants},
		{"systems", "company_id=?", &report.Directories.Systems},
	} {
		*dir.target = []domain.DirectoryRecord{}
		companyColumn, codeColumn, descriptionColumn := "company_id", "business_code", "description"
		if dir.kind == "companies" {
			companyColumn, codeColumn, descriptionColumn = "''", "be_number", "''"
		}
		rows, err := tx.QueryContext(ctx, "SELECT id,"+companyColumn+","+codeColumn+",name,"+descriptionColumn+" FROM "+dir.kind+" WHERE "+dir.condition+" ORDER BY name,id", doc.CompanyID)
		if err != nil {
			return nil, err
		}
		for rows.Next() {
			var item domain.DirectoryRecord
			if err := rows.Scan(&item.ID, &item.CompanyID, &item.Code, &item.Name, &item.Description); err != nil {
				rows.Close()
				return nil, err
			}
			*dir.target = append(*dir.target, item)
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return nil, err
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT id,action_id,author,body,created_at,updated_at FROM action_comments WHERE cjm_id=? ORDER BY created_at,id`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item domain.ActionComment
		if err := rows.Scan(&item.ID, &item.ActionID, &item.Author, &item.Body, &item.CreatedAt, &item.UpdatedAt); err != nil {
			rows.Close()
			return nil, err
		}
		report.Comments = append(report.Comments, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	snapshotColumn := "''"
	if history {
		snapshotColumn = "snapshot_json"
	}
	rows, err = tx.QueryContext(ctx, `SELECT revision_number,comment,revision_kind,created_at,created_by,`+snapshotColumn+` FROM cjm_revisions WHERE cjm_id=? ORDER BY revision_number DESC`, id)
	if err != nil {
		return nil, err
	}
	for rows.Next() {
		var item domain.Revision
		var snapshot string
		if err := rows.Scan(&item.Number, &item.Comment, &item.Kind, &item.CreatedAt, &item.CreatedBy, &snapshot); err != nil {
			rows.Close()
			return nil, err
		}
		if history {
			if err := json.Unmarshal([]byte(snapshot), &item.Snapshot); err != nil {
				rows.Close()
				return nil, err
			}
		}
		report.Revisions = append(report.Revisions, item)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return nil, err
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return report, nil
}
