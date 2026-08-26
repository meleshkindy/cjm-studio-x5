package store

import (
	"strings"
	"testing"
)

func TestRebindPostgres(t *testing.T) {
	query := `SELECT '?' AS literal, id FROM cjms WHERE id=? AND name='It''s ?' AND row_version=?`
	want := `SELECT '?' AS literal, id FROM cjms WHERE id=$1 AND name='It''s ?' AND row_version=$2`
	if got := rebindPostgres(query); got != want {
		t.Fatalf("rebindPostgres() = %q, want %q", got, want)
	}
}

func TestPostgresSchemaUsesPortableTypes(t *testing.T) {
	for _, forbidden := range []string{"PRAGMA", " BLOB ", "rowid"} {
		if strings.Contains(strings.ToUpper(postgresSchemaSQL), strings.ToUpper(forbidden)) {
			t.Fatalf("PostgreSQL schema contains SQLite-only token %q", forbidden)
		}
	}
}
