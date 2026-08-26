package store

import (
	"context"
	"database/sql"
	"strings"

	"cjmstudio/internal/domain"
)

func normalizeCommentBody(body string) (string, error) {
	body = strings.TrimSpace(body)
	if body == "" {
		return "", &ValidationError{Message: "текст комментария обязателен"}
	}
	if len([]rune(body)) > 4000 {
		return "", &ValidationError{Message: "комментарий не должен превышать 4000 символов"}
	}
	return body, nil
}

func actionCJMID(ctx context.Context, db *database, actionID string) (string, error) {
	var cjmID string
	err := db.QueryRowContext(ctx, `
		SELECT s.cjm_id
		FROM actions a
		JOIN steps st ON st.id=a.step_id
		JOIN stages s ON s.id=st.stage_id
		WHERE a.id=?`, actionID).Scan(&cjmID)
	return cjmID, err
}

func (s *Store) ListActionComments(ctx context.Context, actionID string) ([]domain.ActionComment, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if _, err := actionCJMID(ctx, s.db, actionID); err != nil {
		return nil, err
	}
	rows, err := s.db.QueryContext(ctx, `SELECT id,action_id,author,body,created_at,updated_at FROM action_comments WHERE action_id=? ORDER BY created_at,id`, actionID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.ActionComment{}
	for rows.Next() {
		var item domain.ActionComment
		if err := rows.Scan(&item.ID, &item.ActionID, &item.Author, &item.Body, &item.CreatedAt, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func (s *Store) CreateActionComment(ctx context.Context, actionID, body string) (domain.ActionComment, error) {
	return s.CreateActionCommentAs(ctx, actionID, body, localUser)
}

func (s *Store) CreateActionCommentAs(ctx context.Context, actionID, body, author string) (domain.ActionComment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var item domain.ActionComment
	body, err := normalizeCommentBody(body)
	if err != nil {
		return item, err
	}
	cjmID, err := actionCJMID(ctx, s.db, actionID)
	if err != nil {
		return item, err
	}
	t := now()
	item = domain.ActionComment{ID: newID(), ActionID: actionID, Author: auditName(author), Body: body, CreatedAt: t, UpdatedAt: t}
	_, err = s.db.ExecContext(ctx, `INSERT INTO action_comments(id,cjm_id,action_id,author,body,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, item.ID, cjmID, item.ActionID, item.Author, item.Body, item.CreatedAt, item.UpdatedAt)
	return item, err
}

func (s *Store) UpdateActionComment(ctx context.Context, actionID, commentID, body string) (domain.ActionComment, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	var item domain.ActionComment
	body, err := normalizeCommentBody(body)
	if err != nil {
		return item, err
	}
	t := now()
	result, err := s.db.ExecContext(ctx, `UPDATE action_comments SET body=?,updated_at=? WHERE id=? AND action_id=?`, body, t, commentID, actionID)
	if err != nil {
		return item, err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return item, err
	}
	if affected == 0 {
		return item, sql.ErrNoRows
	}
	err = s.db.QueryRowContext(ctx, `SELECT id,action_id,author,body,created_at,updated_at FROM action_comments WHERE id=?`, commentID).Scan(&item.ID, &item.ActionID, &item.Author, &item.Body, &item.CreatedAt, &item.UpdatedAt)
	return item, err
}

func (s *Store) DeleteActionComment(ctx context.Context, actionID, commentID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	result, err := s.db.ExecContext(ctx, `DELETE FROM action_comments WHERE id=? AND action_id=?`, commentID, actionID)
	if err != nil {
		return err
	}
	affected, err := result.RowsAffected()
	if err != nil {
		return err
	}
	if affected == 0 {
		return sql.ErrNoRows
	}
	return nil
}
