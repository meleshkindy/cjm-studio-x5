package store

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"
)

func TestPostgresIntegration(t *testing.T) {
	databaseURL := os.Getenv("TEST_POSTGRES_URL")
	if databaseURL == "" {
		t.Skip("TEST_POSTGRES_URL is not set")
	}
	ctx := context.Background()
	admin, err := sql.Open("pgx", databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer admin.Close()
	schema := fmt.Sprintf("cjm_test_%d", time.Now().UnixNano())
	if _, err := admin.ExecContext(ctx, `CREATE SCHEMA `+schema); err != nil {
		t.Fatalf("create test schema: %v", err)
	}
	defer admin.ExecContext(ctx, `DROP SCHEMA `+schema+` CASCADE`)

	parsed, err := url.Parse(databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	st, err := OpenPostgres(ctx, parsed.String(), t.TempDir())
	if err != nil {
		t.Fatalf("open PostgreSQL store: %v", err)
	}
	defer st.Close()

	if importPath := os.Getenv("TEST_SQLITE_IMPORT"); importPath != "" {
		imported, err := st.ImportSQLiteIfEmpty(ctx, importPath)
		if err != nil {
			t.Fatalf("import SQLite: %v", err)
		}
		if !imported {
			t.Fatal("empty PostgreSQL schema must accept SQLite import")
		}
	} else if err := st.EnsureSeeded(); err != nil {
		t.Fatalf("seed PostgreSQL: %v", err)
	}

	before, err := st.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(before.Companies) == 0 || len(before.CJMs) == 0 {
		t.Fatal("PostgreSQL store must contain imported or seeded data")
	}
	backupPath, err := st.CreateBackup(ctx)
	if err != nil {
		t.Fatalf("export SQLite backup: %v", err)
	}
	defer os.Remove(backupPath)
	backup, err := os.Open(backupPath)
	if err != nil {
		t.Fatal(err)
	}
	defer backup.Close()
	if err := st.RestoreBackup(ctx, backup); err != nil {
		t.Fatalf("restore SQLite backup into PostgreSQL: %v", err)
	}
	after, err := st.Bootstrap(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(after.Companies) != len(before.Companies) || len(after.CJMs) != len(before.CJMs) {
		t.Fatalf("round trip changed data: companies %d/%d, CJMs %d/%d", len(after.Companies), len(before.Companies), len(after.CJMs), len(before.CJMs))
	}
}
