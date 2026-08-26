package store

import (
	"context"
	"database/sql"
	"errors"
	"sort"
	"strings"
	"time"

	"cjmstudio/internal/domain"
)

type UserIdentity struct {
	Subject     string
	Username    string
	DisplayName string
	Email       string
	Role        string
}

func validRole(role string) bool {
	return role == "admin" || role == "editor" || role == "viewer"
}

func normalizeIdentity(identity UserIdentity) (UserIdentity, error) {
	identity.Subject = strings.TrimSpace(identity.Subject)
	identity.Username = strings.TrimSpace(identity.Username)
	identity.DisplayName = strings.TrimSpace(identity.DisplayName)
	identity.Email = strings.TrimSpace(identity.Email)
	identity.Role = strings.ToLower(strings.TrimSpace(identity.Role))
	if identity.Subject == "" || len(identity.Subject) > 255 {
		return identity, &ValidationError{Message: "некорректный идентификатор пользователя"}
	}
	if identity.DisplayName == "" {
		identity.DisplayName = identity.Username
	}
	if identity.DisplayName == "" {
		identity.DisplayName = "Пользователь"
	}
	if len([]rune(identity.DisplayName)) > 200 || len(identity.Username) > 200 || len(identity.Email) > 320 {
		return identity, &ValidationError{Message: "данные пользователя превышают допустимую длину"}
	}
	if !validRole(identity.Role) {
		identity.Role = "viewer"
	}
	return identity, nil
}

func (s *Store) UpsertUser(ctx context.Context, identity UserIdentity) (domain.AppUser, error) {
	identity, err := normalizeIdentity(identity)
	if err != nil {
		return domain.AppUser{}, err
	}
	s.mu.RLock()
	defer s.mu.RUnlock()
	t := now()
	_, err = s.db.ExecContext(ctx, `
		INSERT INTO app_users(subject,username,display_name,email,role,last_seen_at,created_at,updated_at)
		VALUES(?,?,?,?,?,?,?,?)
		ON CONFLICT(subject) DO UPDATE SET
			username=excluded.username,
			display_name=excluded.display_name,
			email=excluded.email,
			role=excluded.role,
			last_seen_at=excluded.last_seen_at,
			updated_at=excluded.updated_at`,
		identity.Subject, identity.Username, identity.DisplayName, identity.Email, identity.Role, t, t, t)
	if err != nil {
		return domain.AppUser{}, err
	}
	return getUser(ctx, s.db, identity.Subject)
}

func getUser(ctx context.Context, db *database, subject string) (domain.AppUser, error) {
	var user domain.AppUser
	err := db.QueryRowContext(ctx, `SELECT subject,username,display_name,email,role,last_seen_at,created_at,updated_at FROM app_users WHERE subject=?`, subject).
		Scan(&user.Subject, &user.Username, &user.DisplayName, &user.Email, &user.Role, &user.LastSeenAt, &user.CreatedAt, &user.UpdatedAt)
	if err != nil {
		return user, err
	}
	user.CompanyIDs, err = stringColumn(ctx, db, `SELECT company_id FROM user_company_access WHERE user_subject=? ORDER BY company_id`, subject)
	if err != nil {
		return user, err
	}
	user.CJMIDs, err = stringColumn(ctx, db, `SELECT cjm_id FROM user_cjm_access WHERE user_subject=? ORDER BY cjm_id`, subject)
	return user, err
}

func stringColumn(ctx context.Context, db queryer, query string, args ...any) ([]string, error) {
	rows, err := db.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	values := []string{}
	for rows.Next() {
		var value string
		if err := rows.Scan(&value); err != nil {
			return nil, err
		}
		values = append(values, value)
	}
	return values, rows.Err()
}

func (s *Store) GetUser(ctx context.Context, subject string) (domain.AppUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return getUser(ctx, s.db, subject)
}

func (s *Store) ListUsers(ctx context.Context) ([]domain.AppUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	rows, err := s.db.QueryContext(ctx, `SELECT subject FROM app_users ORDER BY display_name,username,subject`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	subjects := []string{}
	for rows.Next() {
		var subject string
		if err := rows.Scan(&subject); err != nil {
			return nil, err
		}
		subjects = append(subjects, subject)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	items := make([]domain.AppUser, 0, len(subjects))
	for _, subject := range subjects {
		user, err := getUser(ctx, s.db, subject)
		if err != nil {
			return nil, err
		}
		items = append(items, user)
	}
	return items, nil
}

func (s *Store) SetUserAccess(ctx context.Context, subject string, access domain.UserAccess) (domain.AppUser, error) {
	subject = strings.TrimSpace(subject)
	access.CompanyIDs = sortUnique(access.CompanyIDs)
	access.CJMIDs = sortUnique(access.CJMIDs)
	s.mu.Lock()
	defer s.mu.Unlock()
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return domain.AppUser{}, err
	}
	defer tx.Rollback()
	var exists int
	if err := tx.QueryRowContext(ctx, `SELECT COUNT(*) FROM app_users WHERE subject=?`, subject).Scan(&exists); err != nil {
		return domain.AppUser{}, err
	}
	if exists == 0 {
		return domain.AppUser{}, sql.ErrNoRows
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_company_access WHERE user_subject=?`, subject); err != nil {
		return domain.AppUser{}, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM user_cjm_access WHERE user_subject=?`, subject); err != nil {
		return domain.AppUser{}, err
	}
	for _, companyID := range access.CompanyIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_company_access(user_subject,company_id) VALUES(?,?)`, subject, companyID); err != nil {
			return domain.AppUser{}, translateConstraint(err)
		}
	}
	for _, cjmID := range access.CJMIDs {
		if _, err := tx.ExecContext(ctx, `INSERT INTO user_cjm_access(user_subject,cjm_id) VALUES(?,?)`, subject, cjmID); err != nil {
			return domain.AppUser{}, translateConstraint(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return domain.AppUser{}, err
	}
	return getUser(ctx, s.db, subject)
}

func (s *Store) UserAccess(ctx context.Context, subject string) (domain.UserAccess, error) {
	user, err := s.GetUser(ctx, subject)
	if err != nil {
		return domain.UserAccess{}, err
	}
	return domain.UserAccess{CompanyIDs: user.CompanyIDs, CJMIDs: user.CJMIDs}, nil
}

func (s *Store) CJMCompanyID(ctx context.Context, cjmID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var companyID string
	err := s.db.QueryRowContext(ctx, `SELECT company_id FROM cjms WHERE id=?`, cjmID).Scan(&companyID)
	return companyID, err
}

func (s *Store) ActionCJMID(ctx context.Context, actionID string) (string, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return actionCJMID(ctx, s.db, actionID)
}

func (s *Store) CreateSession(ctx context.Context, sessionHash, subject string, expiresAt time.Time) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	if sessionHash == "" || subject == "" || !expiresAt.After(time.Now()) {
		return &ValidationError{Message: "некорректная сессия"}
	}
	if _, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE expires_at<=?`, now()); err != nil {
		return err
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO auth_sessions(session_hash,user_subject,expires_at,created_at) VALUES(?,?,?,?) ON CONFLICT(session_hash) DO UPDATE SET user_subject=excluded.user_subject,expires_at=excluded.expires_at`, sessionHash, subject, expiresAt.UTC().Format(time.RFC3339), now())
	return err
}

func (s *Store) SessionUser(ctx context.Context, sessionHash string) (domain.AppUser, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var subject string
	err := s.db.QueryRowContext(ctx, `SELECT user_subject FROM auth_sessions WHERE session_hash=? AND expires_at>?`, sessionHash, now()).Scan(&subject)
	if err != nil {
		return domain.AppUser{}, err
	}
	return getUser(ctx, s.db, subject)
}

func (s *Store) DeleteSession(ctx context.Context, sessionHash string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, err := s.db.ExecContext(ctx, `DELETE FROM auth_sessions WHERE session_hash=?`, sessionHash)
	return err
}

func accessContains(values []string, value string) bool {
	index := sort.SearchStrings(values, value)
	return index < len(values) && values[index] == value
}

func UserCanAccess(access domain.UserAccess, companyID, cjmID string) bool {
	return accessContains(access.CompanyIDs, companyID) || accessContains(access.CJMIDs, cjmID)
}

func IsMissingUser(err error) bool { return errors.Is(err, sql.ErrNoRows) }
