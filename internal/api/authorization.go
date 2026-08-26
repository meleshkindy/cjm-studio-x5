package api

import (
	"context"
	"database/sql"
	"errors"
	"net/http"
	"sort"
	"strings"

	"cjmstudio/internal/domain"
	"cjmstudio/internal/store"
)

func (s *Server) authConfig(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.auth.config)
}

func (s *Server) authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.auth.config.Enabled {
			p := principal{Subject: "local-development", Username: "local", DisplayName: "Локальный пользователь", Role: "admin"}
			next.ServeHTTP(w, r.WithContext(withPrincipal(r.Context(), p)))
			return
		}
		if r.URL.Path == "/api/health" || r.URL.Path == "/api/auth/config" || r.URL.Path == "/api/auth/session" {
			next.ServeHTTP(w, r)
			return
		}
		p, err := s.requestPrincipal(r)
		if err != nil {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Требуется вход в систему"})
			return
		}
		next.ServeHTTP(w, r.WithContext(withPrincipal(r.Context(), p)))
	})
}

func (s *Server) requestPrincipal(r *http.Request) (principal, error) {
	if header := strings.TrimSpace(r.Header.Get("Authorization")); header != "" {
		p, err := s.auth.verifyBearer(r.Context(), header)
		if err != nil {
			return principal{}, err
		}
		if _, err := s.store.UpsertUser(r.Context(), p.identity()); err != nil {
			return principal{}, err
		}
		return p, nil
	}
	cookie, err := r.Cookie(sessionCookieName)
	if err != nil || cookie.Value == "" {
		return principal{}, errors.New("сессия отсутствует")
	}
	user, err := s.store.SessionUser(r.Context(), hashSessionToken(cookie.Value))
	if err != nil {
		return principal{}, err
	}
	return appUserPrincipal(user), nil
}

func (s *Server) createSession(w http.ResponseWriter, r *http.Request) {
	if !s.auth.config.Enabled {
		writeJSON(w, http.StatusBadRequest, map[string]any{"error": "Авторизация отключена"})
		return
	}
	p, err := s.auth.verifyBearer(r.Context(), r.Header.Get("Authorization"))
	if err != nil {
		writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "Не удалось подтвердить вход"})
		return
	}
	user, err := s.store.UpsertUser(r.Context(), p.identity())
	if err != nil {
		writeError(w, err)
		return
	}
	if previous, err := r.Cookie(sessionCookieName); err == nil && previous.Value != "" {
		_ = s.store.DeleteSession(r.Context(), hashSessionToken(previous.Value))
	}
	token, err := randomSessionToken()
	if err != nil {
		writeError(w, err)
		return
	}
	if err := s.store.CreateSession(r.Context(), hashSessionToken(token), p.Subject, p.ExpiresAt); err != nil {
		writeError(w, err)
		return
	}
	setSessionCookie(w, r, token, p.ExpiresAt)
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	if cookie, err := r.Cookie(sessionCookieName); err == nil && cookie.Value != "" {
		_ = s.store.DeleteSession(r.Context(), hashSessionToken(cookie.Value))
	}
	clearSessionCookie(w, r)
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) currentUser(w http.ResponseWriter, r *http.Request) {
	p := principalFromContext(r.Context())
	if !s.auth.config.Enabled {
		writeJSON(w, http.StatusOK, domain.AppUser{Subject: p.Subject, Username: p.Username, DisplayName: p.DisplayName, Role: p.Role, CompanyIDs: []string{}, CJMIDs: []string{}})
		return
	}
	user, err := s.store.GetUser(r.Context(), p.Subject)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func (s *Server) listUsers(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	items, err := s.store.ListUsers(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) updateUserAccess(w http.ResponseWriter, r *http.Request) {
	if !s.requireAdmin(w, r) {
		return
	}
	var access domain.UserAccess
	if err := decodeJSON(r, &access); err != nil {
		writeError(w, err)
		return
	}
	user, err := s.store.SetUserAccess(r.Context(), r.PathValue("subject"), access)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, user)
}

func writeForbidden(w http.ResponseWriter) {
	writeJSON(w, http.StatusForbidden, map[string]any{"error": "Недостаточно прав для этой операции"})
}

func (s *Server) requireAdmin(w http.ResponseWriter, r *http.Request) bool {
	if principalFromContext(r.Context()).Role != "admin" {
		writeForbidden(w)
		return false
	}
	return true
}

func (s *Server) requireEditor(w http.ResponseWriter, r *http.Request) (principal, bool) {
	p := principalFromContext(r.Context())
	if p.Role != "admin" && p.Role != "editor" {
		writeForbidden(w)
		return p, false
	}
	return p, true
}

func (s *Server) canAccessCompany(ctx context.Context, p principal, companyID string) (bool, error) {
	if p.Role == "admin" {
		return true, nil
	}
	access, err := s.store.UserAccess(ctx, p.Subject)
	if err != nil {
		return false, err
	}
	sort.Strings(access.CompanyIDs)
	index := sort.SearchStrings(access.CompanyIDs, companyID)
	return index < len(access.CompanyIDs) && access.CompanyIDs[index] == companyID, nil
}

func (s *Server) canAccessCJM(ctx context.Context, p principal, cjmID string) (bool, error) {
	if p.Role == "admin" {
		return true, nil
	}
	companyID, err := s.store.CJMCompanyID(ctx, cjmID)
	if err != nil {
		return false, err
	}
	access, err := s.store.UserAccess(ctx, p.Subject)
	if err != nil {
		return false, err
	}
	return store.UserCanAccess(access, companyID, cjmID), nil
}

func (s *Server) requireCJMAccess(w http.ResponseWriter, r *http.Request, cjmID string, obscure bool) bool {
	allowed, err := s.canAccessCJM(r.Context(), principalFromContext(r.Context()), cjmID)
	if err != nil {
		if obscure && errors.Is(err, sql.ErrNoRows) {
			writeForbidden(w)
		} else {
			writeError(w, err)
		}
		return false
	}
	if !allowed {
		writeForbidden(w)
		return false
	}
	return true
}

func (s *Server) requireCJMEditor(w http.ResponseWriter, r *http.Request, cjmID string) (principal, bool) {
	p, ok := s.requireEditor(w, r)
	if !ok || !s.requireCJMAccess(w, r, cjmID, true) {
		return p, false
	}
	return p, true
}

func (s *Server) requireActionAccess(w http.ResponseWriter, r *http.Request, actionID string, obscure bool) bool {
	cjmID, err := s.store.ActionCJMID(r.Context(), actionID)
	if err != nil {
		if obscure && errors.Is(err, sql.ErrNoRows) {
			writeForbidden(w)
		} else {
			writeError(w, err)
		}
		return false
	}
	return s.requireCJMAccess(w, r, cjmID, obscure)
}

func (s *Server) requireActionEditor(w http.ResponseWriter, r *http.Request, actionID string) (principal, bool) {
	p, ok := s.requireEditor(w, r)
	if !ok || !s.requireActionAccess(w, r, actionID, true) {
		return p, false
	}
	return p, true
}

func (s *Server) filterBootstrap(ctx context.Context, p principal, data domain.Bootstrap) (domain.Bootstrap, error) {
	if p.Role == "admin" {
		return data, nil
	}
	access, err := s.store.UserAccess(ctx, p.Subject)
	if err != nil {
		return data, err
	}
	visibleCompanies := make(map[string]bool, len(access.CompanyIDs))
	for _, id := range access.CompanyIDs {
		visibleCompanies[id] = true
	}
	visibleCJMs := make(map[string]bool, len(access.CJMIDs))
	for _, id := range access.CJMIDs {
		visibleCJMs[id] = true
	}
	filteredCJMs := make([]domain.CJMSummary, 0, len(data.CJMs))
	for _, item := range data.CJMs {
		if visibleCompanies[item.CompanyID] || visibleCJMs[item.ID] {
			visibleCompanies[item.CompanyID] = true
			filteredCJMs = append(filteredCJMs, item)
		}
	}
	filterDirectory := func(items []domain.DirectoryRecord, companies bool) []domain.DirectoryRecord {
		out := make([]domain.DirectoryRecord, 0, len(items))
		for _, item := range items {
			id := item.CompanyID
			if companies {
				id = item.ID
			}
			if visibleCompanies[id] {
				out = append(out, item)
			}
		}
		return out
	}
	data.Companies = filterDirectory(data.Companies, true)
	data.Actors = filterDirectory(data.Actors, false)
	data.Participants = filterDirectory(data.Participants, false)
	data.Systems = filterDirectory(data.Systems, false)
	data.CJMs = filteredCJMs
	return data, nil
}
