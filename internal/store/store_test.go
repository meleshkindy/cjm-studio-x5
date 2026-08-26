package store

import (
	"context"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"cjmstudio/internal/domain"
)

func openTestStore(t *testing.T) *Store {
	t.Helper()
	st, err := Open(filepath.Join(t.TempDir(), "test.sqlite"))
	if err != nil {
		t.Fatalf("open test store: %v", err)
	}
	t.Cleanup(func() {
		if err := st.Close(); err != nil {
			t.Errorf("close test store: %v", err)
		}
	})
	return st
}

func TestDirectoryIDsAreGeneratedAndCannotBeEdited(t *testing.T) {
	st := openTestStore(t)
	bootstrap, err := st.Bootstrap(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	companyID := bootstrap.Companies[0].ID
	cases := []struct {
		kind   string
		prefix string
	}{
		{kind: "actors", prefix: "ACT"},
		{kind: "participants", prefix: "P"},
		{kind: "systems", prefix: "SYS"},
	}

	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			first, err := st.CreateDirectory(context.Background(), tc.kind, domain.DirectoryRecord{
				CompanyID: companyID,
				Code:      "MANUAL-ID",
				Name:      "Первая тестовая запись",
			})
			if err != nil {
				t.Fatalf("create first record: %v", err)
			}
			second, err := st.CreateDirectory(context.Background(), tc.kind, domain.DirectoryRecord{
				CompanyID: companyID,
				Name:      "Вторая тестовая запись",
			})
			if err != nil {
				t.Fatalf("create second record: %v", err)
			}

			firstNumber, firstErr := strconv.Atoi(strings.TrimPrefix(first.Code, tc.prefix+"-"))
			secondNumber, secondErr := strconv.Atoi(strings.TrimPrefix(second.Code, tc.prefix+"-"))
			if firstErr != nil || secondErr != nil || !strings.HasPrefix(first.Code, tc.prefix+"-") || secondNumber != firstNumber+1 {
				t.Fatalf("generated IDs must be sequential: %q, %q", first.Code, second.Code)
			}

			originalCode := first.Code
			first.Code = "CHANGED-ID"
			first.Name = "Переименованная запись"
			if err := st.UpdateDirectory(context.Background(), tc.kind, first); err != nil {
				t.Fatalf("update record: %v", err)
			}
			items, err := st.ListDirectory(context.Background(), tc.kind)
			if err != nil {
				t.Fatal(err)
			}
			for _, item := range items {
				if item.ID == first.ID {
					if item.Code != originalCode {
						t.Fatalf("generated ID changed from %q to %q", originalCode, item.Code)
					}
					return
				}
			}
			t.Fatal("updated record not found")
		})
	}
}

func TestActionCommentsCRUDAndDocumentSave(t *testing.T) {
	st := openTestStore(t)
	doc := firstDocument(t, st)
	actionID := doc.Stages[0].Steps[0].Actions[0].ID

	if _, err := st.CreateActionComment(context.Background(), actionID, "   "); err == nil {
		t.Fatal("empty comment must be rejected")
	}
	first, err := st.CreateActionComment(context.Background(), actionID, "Первый комментарий")
	if err != nil {
		t.Fatalf("create first comment: %v", err)
	}
	second, err := st.CreateActionComment(context.Background(), actionID, "Второй комментарий")
	if err != nil {
		t.Fatalf("create second comment: %v", err)
	}
	if first.Author != localUser || first.ActionID != actionID {
		t.Fatalf("unexpected comment metadata: %+v", first)
	}

	first, err = st.UpdateActionComment(context.Background(), actionID, first.ID, "Обновлённый комментарий")
	if err != nil {
		t.Fatalf("update comment: %v", err)
	}
	if first.Body != "Обновлённый комментарий" {
		t.Fatalf("updated body = %q", first.Body)
	}

	doc.Name = "CJM с сохранёнными комментариями"
	if _, err := st.SaveCJM(context.Background(), doc); err != nil {
		t.Fatalf("save CJM: %v", err)
	}
	items, err := st.ListActionComments(context.Background(), actionID)
	if err != nil {
		t.Fatalf("list comments after save: %v", err)
	}
	if len(items) != 2 {
		t.Fatalf("comments after save = %d, want 2", len(items))
	}

	if err := st.DeleteActionComment(context.Background(), actionID, second.ID); err != nil {
		t.Fatalf("delete comment: %v", err)
	}
	items, err = st.ListActionComments(context.Background(), actionID)
	if err != nil {
		t.Fatal(err)
	}
	if len(items) != 1 || items[0].ID != first.ID {
		t.Fatalf("comments after delete = %+v", items)
	}

	doc, err = st.GetCJM(context.Background(), doc.ID)
	if err != nil {
		t.Fatal(err)
	}
	doc.Stages[0].Steps[0].Actions = doc.Stages[0].Steps[0].Actions[1:]
	if _, err := st.SaveCJM(context.Background(), doc); err != nil {
		t.Fatalf("delete action through save: %v", err)
	}
	var count int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM action_comments WHERE action_id=?`, actionID).Scan(&count); err != nil {
		t.Fatal(err)
	}
	if count != 0 {
		t.Fatalf("comments for deleted action = %d", count)
	}
}

func firstDocument(t *testing.T, st *Store) *domain.CJMDocument {
	t.Helper()
	bootstrap, err := st.Bootstrap(context.Background())
	if err != nil {
		t.Fatalf("load bootstrap: %v", err)
	}
	if len(bootstrap.CJMs) == 0 {
		t.Fatal("seed must create a demo CJM")
	}
	doc, err := st.GetCJM(context.Background(), bootstrap.CJMs[0].ID)
	if err != nil {
		t.Fatalf("load CJM: %v", err)
	}
	return doc
}

func TestRichTextAllowsFormattingAndSafeWebLinks(t *testing.T) {
	valid := json.RawMessage(`{
		"type":"doc",
		"content":[
			{"type":"heading","attrs":{"level":2},"content":[{"type":"text","text":"Цель"}]},
			{"type":"bulletList","content":[{"type":"listItem","content":[{"type":"paragraph","content":[{"type":"text","text":"Открыть сайт","marks":[{"type":"link","attrs":{"href":"https://example.com/path"}}]}]}]}]},
			{"type":"image","attrs":{"src":"/api/assets/image-id","alt":"Схема","width":900}}
		]
	}`)
	if err := validateRichDoc(valid); err != nil {
		t.Fatalf("valid Rich Text rejected: %v", err)
	}

	unsafe := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"X","marks":[{"type":"link","attrs":{"href":"javascript:alert(1)"}}]}]}]}`)
	if err := validateRichDoc(unsafe); err == nil {
		t.Fatal("unsafe Rich Text link must be rejected")
	}
}

func TestSaveRejectsBackwardStepLink(t *testing.T) {
	st := openTestStore(t)
	doc := firstDocument(t, st)
	var stepIDs []string
	for _, stage := range doc.Stages {
		for _, step := range stage.Steps {
			stepIDs = append(stepIDs, step.ID)
		}
	}
	if len(stepIDs) < 2 {
		t.Fatal("demo CJM must have at least two steps")
	}
	doc.Links = append(doc.Links, domain.StepLink{
		ID:       newID(),
		SourceID: stepIDs[len(stepIDs)-1],
		TargetID: stepIDs[0],
		Type:     "additional",
	})
	_, err := st.SaveCJM(context.Background(), doc)
	var validation *ValidationError
	if !errors.As(err, &validation) {
		t.Fatalf("expected validation error, got %v", err)
	}
}

func TestOptimisticLockAndRevisionRestore(t *testing.T) {
	st := openTestStore(t)
	original := firstDocument(t, st)
	stale, err := st.GetCJM(context.Background(), original.ID)
	if err != nil {
		t.Fatal(err)
	}

	revision, err := st.CreateRevision(context.Background(), original.ID, "Исходная версия", "manual")
	if err != nil {
		t.Fatalf("create revision: %v", err)
	}
	originalName := original.Name
	original.Name = "Изменённая CJM"
	saved, err := st.SaveCJM(context.Background(), original)
	if err != nil {
		t.Fatalf("save changed CJM: %v", err)
	}
	if saved.RowVersion <= stale.RowVersion {
		t.Fatal("row version must increase after save")
	}

	stale.Name = "Конфликтующая CJM"
	if _, err := st.SaveCJM(context.Background(), stale); err == nil {
		t.Fatal("saving a stale document must fail")
	} else {
		var conflict *ConflictError
		if !errors.As(err, &conflict) {
			t.Fatalf("expected conflict error, got %v", err)
		}
	}

	restored, err := st.RestoreRevision(context.Background(), original.ID, revision.Number)
	if err != nil {
		t.Fatalf("restore revision: %v", err)
	}
	if restored.Name != originalName {
		t.Fatalf("restored name = %q, want %q", restored.Name, originalName)
	}
	if restored.CurrentRevision < 3 {
		t.Fatalf("restore must preserve pre-restore and restore revisions, got v%d", restored.CurrentRevision)
	}
}

func TestSaveDeletesInitiativeAndItsLinks(t *testing.T) {
	st := openTestStore(t)
	doc := firstDocument(t, st)
	if len(doc.Initiatives) == 0 {
		t.Fatal("demo CJM must have an initiative")
	}
	deletedID := doc.Initiatives[0].ID
	doc.Initiatives = doc.Initiatives[1:]
	doc.InitiativeLinks = filterInitiativeLinks(doc.InitiativeLinks, deletedID)
	doc.DeletedInitiativeIDs = []string{deletedID}

	saved, err := st.SaveCJM(context.Background(), doc)
	if err != nil {
		t.Fatalf("delete initiative: %v", err)
	}
	for _, initiative := range saved.Initiatives {
		if initiative.ID == deletedID {
			t.Fatal("deleted initiative returned after save")
		}
	}
	var initiativeCount, linkCount int
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM initiatives WHERE id=?`, deletedID).Scan(&initiativeCount); err != nil {
		t.Fatal(err)
	}
	if err := st.db.QueryRow(`SELECT COUNT(*) FROM initiative_links WHERE initiative_id=?`, deletedID).Scan(&linkCount); err != nil {
		t.Fatal(err)
	}
	if initiativeCount != 0 || linkCount != 0 {
		t.Fatalf("initiative deletion incomplete: initiatives=%d links=%d", initiativeCount, linkCount)
	}
}

func filterInitiativeLinks(links []domain.InitiativeLink, deletedID string) []domain.InitiativeLink {
	result := links[:0]
	for _, link := range links {
		if link.InitiativeID != deletedID {
			result = append(result, link)
		}
	}
	return result
}

func TestBackupRoundTrip(t *testing.T) {
	st := openTestStore(t)
	before, err := st.Bootstrap(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	backupPath, err := st.CreateBackup(context.Background())
	if err != nil {
		t.Fatalf("create backup: %v", err)
	}
	defer os.Remove(backupPath)

	if _, err := st.CreateDirectory(context.Background(), "companies", domain.DirectoryRecord{Code: "TEST-BE", Name: "Временная компания"}); err != nil {
		t.Fatalf("mutate database: %v", err)
	}
	file, err := os.Open(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	defer file.Close()
	if err := st.RestoreBackup(context.Background(), file); err != nil {
		t.Fatalf("restore backup: %v", err)
	}
	after, err := st.Bootstrap(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Companies) != len(before.Companies) || len(after.CJMs) != len(before.CJMs) {
		t.Fatalf("backup round trip changed data: companies %d/%d, CJMs %d/%d", len(after.Companies), len(before.Companies), len(after.CJMs), len(before.CJMs))
	}
}
