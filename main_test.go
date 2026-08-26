package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDatabaseURLFromConfigFile(t *testing.T) {
	t.Setenv("CJM_DATABASE_URL", "")
	t.Setenv("DATABASE_URL", "")
	directory := t.TempDir()
	want := "postgres://user:password@localhost:5432/cjm_studio?sslmode=disable"
	if err := os.WriteFile(filepath.Join(directory, "postgres-url.txt"), []byte(want+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	got, err := databaseURLFromConfig("", "", directory)
	if err != nil {
		t.Fatal(err)
	}
	if got != want {
		t.Fatalf("database URL = %q, want %q", got, want)
	}
}

func TestDatabaseURLFlagHasPriority(t *testing.T) {
	t.Setenv("CJM_DATABASE_URL", "postgres://environment")
	got, err := databaseURLFromConfig("postgres://flag", "", t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if got != "postgres://flag" {
		t.Fatalf("database URL = %q", got)
	}
}

func TestAuthConfigFromRuntimeEnvironment(t *testing.T) {
	t.Setenv("CJM_AUTH_ENABLED", "")
	t.Setenv("CJM_KEYCLOAK_URL", "")
	t.Setenv("CJM_KEYCLOAK_REALM", "")
	t.Setenv("CJM_KEYCLOAK_CLIENT_ID", "")
	t.Setenv("CJM_RESTORE_PASSWORD_URL", "")
	t.Setenv("VITE_KEYCLOAK_URL", "https://key-stage.x5.ru/auth")
	t.Setenv("VITE_KEYCLOAK_REALM", "X5")
	t.Setenv("VITE_KEYCLOAK_CLIENT_ID", "client")
	t.Setenv("VITE_RESTORE_PASSWORD_URL", "https://sts2.x5.ru/adfs/portal/updatepass")
	config := authConfigFromEnv()
	if !config.Enabled || config.Realm != "X5" || config.ClientID != "client" {
		t.Fatalf("unexpected auth config: %+v", config)
	}
}
