package api

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"cjmstudio/internal/domain"
	"cjmstudio/internal/store"
)

func TestEffectiveRolePriority(t *testing.T) {
	if got := effectiveRole([]string{"viewer", "editor"}); got != "editor" {
		t.Fatalf("role = %q, want editor", got)
	}
	if got := effectiveRole([]string{"viewer", "admin", "editor"}); got != "admin" {
		t.Fatalf("role = %q, want admin", got)
	}
	if got := effectiveRole([]string{"unrelated-role"}); got != "viewer" {
		t.Fatalf("role = %q, want safe viewer default", got)
	}
}

func TestViewerBootstrapIsFiltered(t *testing.T) {
	st, err := store.Open(filepath.Join(t.TempDir(), "access.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	data, err := st.Bootstrap(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(data.Companies) < 2 || len(data.CJMs) == 0 {
		t.Fatal("seed data is incomplete")
	}
	user, err := st.UpsertUser(context.Background(), store.UserIdentity{Subject: "viewer-sub", DisplayName: "Viewer", Role: "viewer"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.SetUserAccess(context.Background(), user.Subject, domain.UserAccess{CJMIDs: []string{data.CJMs[0].ID}}); err != nil {
		t.Fatal(err)
	}
	s := New(st)
	filtered, err := s.filterBootstrap(context.Background(), principal{Subject: user.Subject, Role: "viewer"}, data)
	if err != nil {
		t.Fatal(err)
	}
	if len(filtered.CJMs) != 1 || filtered.CJMs[0].ID != data.CJMs[0].ID || len(filtered.Companies) != 1 {
		t.Fatalf("unexpected filtered bootstrap: companies=%d cjms=%d", len(filtered.Companies), len(filtered.CJMs))
	}
}

func testHandler(t *testing.T) http.Handler {
	t.Helper()
	st, err := store.Open(filepath.Join(t.TempDir(), "api.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = st.Close() })
	return New(st).Handler()
}

func TestActionCommentsAPI(t *testing.T) {
	handler := testHandler(t)

	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/bootstrap", nil))
	if response.Code != http.StatusOK {
		t.Fatalf("bootstrap status = %d", response.Code)
	}
	var bootstrap domain.Bootstrap
	if err := json.Unmarshal(response.Body.Bytes(), &bootstrap); err != nil {
		t.Fatal(err)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/cjms/"+bootstrap.CJMs[0].ID, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("get CJM status = %d", response.Code)
	}
	var doc domain.CJMDocument
	if err := json.Unmarshal(response.Body.Bytes(), &doc); err != nil {
		t.Fatal(err)
	}
	actionID := doc.Stages[0].Steps[0].Actions[0].ID
	commentsURL := "/api/actions/" + actionID + "/comments"

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, commentsURL, bytes.NewBufferString(`{"body":"Комментарий через API"}`)))
	if response.Code != http.StatusCreated {
		t.Fatalf("create comment status = %d: %s", response.Code, response.Body.String())
	}
	var created domain.ActionComment
	if err := json.Unmarshal(response.Body.Bytes(), &created); err != nil {
		t.Fatal(err)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodPut, commentsURL+"/"+created.ID, bytes.NewBufferString(`{"body":"Изменённый комментарий"}`)))
	if response.Code != http.StatusOK {
		t.Fatalf("update comment status = %d: %s", response.Code, response.Body.String())
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, commentsURL, nil))
	if response.Code != http.StatusOK {
		t.Fatalf("list comments status = %d", response.Code)
	}
	var comments []domain.ActionComment
	if err := json.Unmarshal(response.Body.Bytes(), &comments); err != nil {
		t.Fatal(err)
	}
	if len(comments) != 1 || comments[0].Body != "Изменённый комментарий" {
		t.Fatalf("unexpected comments: %+v", comments)
	}

	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodDelete, commentsURL+"/"+created.ID, nil))
	if response.Code != http.StatusNoContent {
		t.Fatalf("delete comment status = %d", response.Code)
	}
}

func TestHealthAndSecurityHeaders(t *testing.T) {
	handler := testHandler(t)
	request := httptest.NewRequest(http.MethodGet, "/api/health", nil)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusOK {
		t.Fatalf("health status = %d", response.Code)
	}
	if response.Header().Get("X-Frame-Options") != "DENY" || response.Header().Get("X-Content-Type-Options") != "nosniff" {
		t.Fatal("required security headers are missing")
	}

	request = httptest.NewRequest(http.MethodGet, "/api/health", nil)
	request.Header.Set("Origin", "https://external.example")
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, request)
	if response.Code != http.StatusForbidden {
		t.Fatalf("external origin status = %d, want 403", response.Code)
	}
}

func TestLocalAuthenticationFallback(t *testing.T) {
	handler := testHandler(t)
	response := httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/auth/config", nil))
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"enabled":false`)) {
		t.Fatalf("auth config = %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	handler.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/auth/me", nil))
	if response.Code != http.StatusOK || !bytes.Contains(response.Body.Bytes(), []byte(`"role":"admin"`)) {
		t.Fatalf("local user = %d %s", response.Code, response.Body.String())
	}
}
