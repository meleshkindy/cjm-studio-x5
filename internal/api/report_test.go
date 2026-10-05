package api

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"cjmstudio/internal/domain"
	"cjmstudio/internal/store"
)

func TestCJMReportCompletenessAndAccess(t *testing.T) {
	ctx := context.Background()
	st, err := store.Open(filepath.Join(t.TempDir(), "report.sqlite"))
	if err != nil {
		t.Fatal(err)
	}
	defer st.Close()
	data, err := st.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	id := data.CJMs[0].ID
	doc, err := st.GetCJM(ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	action := doc.Stages[0].Steps[0].Actions[0]
	if _, err := st.CreateActionCommentAs(ctx, action.ID, "Полный комментарий для отчёта", "Автор отчёта"); err != nil {
		t.Fatal(err)
	}
	revision, err := st.CreateRevisionAs(ctx, id, "Редакция для отчёта", "manual", "Редактор")
	if err != nil {
		t.Fatal(err)
	}
	other, err := st.CreateCJM(ctx, "Другая CJM", doc.CompanyID, doc.ActorID)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.CreateRevision(ctx, other.ID, "Чужая редакция", "manual"); err != nil {
		t.Fatal(err)
	}
	_, err = st.UpsertUser(ctx, store.UserIdentity{Subject: "report-viewer", DisplayName: "Читатель", Role: "viewer"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := st.SetUserAccess(ctx, "report-viewer", domain.UserAccess{CJMIDs: []string{id}}); err != nil {
		t.Fatal(err)
	}
	server := New(st)
	get := func(path string, role string) *httptest.ResponseRecorder {
		request := httptest.NewRequest(http.MethodGet, path, nil)
		request = request.WithContext(withPrincipal(request.Context(), principal{Subject: "report-viewer", Role: role}))
		response := httptest.NewRecorder()
		server.mux.ServeHTTP(response, request)
		return response
	}
	response := get("/api/cjms/"+id+"/report?history=1", "viewer")
	if response.Code != http.StatusOK {
		t.Fatalf("report: %d %s", response.Code, response.Body.String())
	}
	var report domain.CJMReport
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.Document.ID != id || len(report.Document.Stages) != len(doc.Stages) || report.GeneratedAt == "" {
		t.Fatal("document metadata/structure missing")
	}
	if len(report.Comments) != 1 || report.Comments[0].Body != "Полный комментарий для отчёта" || report.Comments[0].Author != "Автор отчёта" {
		t.Fatal("comments missing or incorrect")
	}
	if report.Revisions[0].Number != revision.Number || report.Revisions[0].Snapshot == nil || report.Revisions[0].Snapshot.ID != id {
		t.Fatal("revision snapshot missing")
	}
	for _, r := range report.Revisions {
		if r.Comment == "Чужая редакция" {
			t.Fatal("another CJM's history leaked")
		}
	}
	if len(report.Directories.Companies) != 1 || report.Directories.Companies[0].ID != doc.CompanyID {
		t.Fatal("wrong company directory scope")
	}
	for _, rows := range [][]domain.DirectoryRecord{report.Directories.Actors, report.Directories.Participants, report.Directories.Systems} {
		for _, item := range rows {
			if item.CompanyID != doc.CompanyID {
				t.Fatal("another company's directory leaked")
			}
		}
	}
	if response.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("report must not be cached")
	}
	response = get("/api/cjms/"+id+"/report", "viewer")
	report = domain.CJMReport{}
	if err := json.Unmarshal(response.Body.Bytes(), &report); err != nil {
		t.Fatal(err)
	}
	if report.Revisions[0].Snapshot != nil {
		t.Fatal("large snapshots should be opt-in")
	}
	if got := get("/api/cjms/"+other.ID+"/report?history=1", "viewer").Code; got != http.StatusForbidden {
		t.Fatalf("unauthorized report status %d", got)
	}
	if got := get("/api/cjms/missing/report", "admin").Code; got != http.StatusNotFound {
		t.Fatalf("missing report status %d", got)
	}
	anonymous := httptest.NewRecorder()
	server.auth.config.Enabled = true
	server.Handler().ServeHTTP(anonymous, httptest.NewRequest(http.MethodGet, "/api/cjms/"+id+"/report", nil))
	if anonymous.Code != http.StatusUnauthorized {
		t.Fatalf("anonymous report status %d", anonymous.Code)
	}
}
