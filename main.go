package main

import (
	"context"
	"embed"
	"flag"
	"fmt"
	"io/fs"
	"log"
	"mime"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"

	"cjmstudio/internal/api"
	"cjmstudio/internal/store"
)

//go:embed web/dist
var webFiles embed.FS

func main() {
	defaultDataDir, err := userDataDir()
	if err != nil {
		log.Fatal(err)
	}
	dataDir := flag.String("data-dir", defaultDataDir, "каталог временных резервных копий")
	databaseURL := flag.String("database-url", "", "строка подключения PostgreSQL")
	databaseURLFile := flag.String("database-url-file", os.Getenv("CJM_DATABASE_URL_FILE"), "файл со строкой подключения PostgreSQL")
	importSQLite := flag.String("import-sqlite", os.Getenv("CJM_SQLITE_IMPORT"), "SQLite-копия для первичного импорта в пустую PostgreSQL")
	listenAddress := flag.String("listen", envOrDefault("CJM_LISTEN_ADDRESS", "127.0.0.1"), "адрес прослушивания; для сервера обычно 0.0.0.0")
	port := flag.Int("port", 0, "локальный порт; 0 выбирает свободный")
	noBrowser := flag.Bool("no-browser", false, "не открывать браузер автоматически")
	flag.Parse()

	resolvedDatabaseURL, err := databaseURLFromConfig(*databaseURL, *databaseURLFile, *dataDir)
	if err != nil {
		log.Fatalf("read PostgreSQL configuration: %v", err)
	}
	st, err := store.OpenPostgres(context.Background(), resolvedDatabaseURL, *dataDir)
	if err != nil {
		log.Fatalf("open PostgreSQL: %v", err)
	}
	defer st.Close()
	if strings.TrimSpace(*importSQLite) != "" {
		imported, err := st.ImportSQLiteIfEmpty(context.Background(), *importSQLite)
		if err != nil {
			log.Fatalf("import SQLite: %v", err)
		}
		if imported {
			log.Printf("Данные импортированы из %s", *importSQLite)
		} else {
			log.Printf("Импорт SQLite пропущен: PostgreSQL уже содержит данные")
		}
	}
	if err := st.EnsureSeeded(); err != nil {
		log.Fatalf("initialize data: %v", err)
	}

	apiServer, err := api.NewWithAuth(st, authConfigFromEnv())
	if err != nil {
		log.Fatalf("configure authentication: %v", err)
	}
	dist, err := fs.Sub(webFiles, "web/dist")
	if err != nil {
		log.Fatal(err)
	}
	mux := http.NewServeMux()
	mux.Handle("/api/", apiServer.Handler())
	mux.Handle("/", spaHandler(dist))

	listener, err := net.Listen("tcp", net.JoinHostPort(*listenAddress, fmt.Sprint(*port)))
	if err != nil {
		log.Fatalf("listen: %v", err)
	}
	browserHost := *listenAddress
	if browserHost == "0.0.0.0" || browserHost == "::" || browserHost == "" {
		browserHost = "127.0.0.1"
	}
	url := "http://" + net.JoinHostPort(browserHost, fmt.Sprint(listener.Addr().(*net.TCPAddr).Port))
	server := &http.Server{Handler: mux, ReadHeaderTimeout: 10 * time.Second, IdleTimeout: 60 * time.Second}

	log.Printf("CJM Studio запущена: %s", url)
	if !*noBrowser {
		go func() {
			time.Sleep(350 * time.Millisecond)
			if err := openBrowser(url); err != nil {
				log.Printf("open browser: %v", err)
			}
		}()
	}

	go func() {
		if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
			log.Fatalf("serve: %v", err)
		}
	}()
	stop := make(chan os.Signal, 1)
	signal.Notify(stop, os.Interrupt, syscall.SIGTERM)
	<-stop
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	server.Shutdown(ctx)
}

func authConfigFromEnv() api.AuthConfig {
	config := api.AuthConfig{
		URL:                firstEnv("CJM_KEYCLOAK_URL", "VITE_KEYCLOAK_URL"),
		Realm:              firstEnv("CJM_KEYCLOAK_REALM", "VITE_KEYCLOAK_REALM"),
		ClientID:           firstEnv("CJM_KEYCLOAK_CLIENT_ID", "VITE_KEYCLOAK_CLIENT_ID"),
		RestorePasswordURL: firstEnv("CJM_RESTORE_PASSWORD_URL", "VITE_RESTORE_PASSWORD_URL"),
	}
	config.Enabled = config.URL != "" || config.Realm != "" || config.ClientID != ""
	if value := strings.TrimSpace(os.Getenv("CJM_AUTH_ENABLED")); value != "" {
		config.Enabled = strings.EqualFold(value, "true") || value == "1" || strings.EqualFold(value, "yes")
	}
	return config
}

func firstEnv(names ...string) string {
	for _, name := range names {
		if value := strings.TrimSpace(os.Getenv(name)); value != "" {
			return value
		}
	}
	return ""
}

func envOrDefault(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func userDataDir() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, "CJM Studio"), nil
}

func databaseURLFromConfig(flagValue, fileValue, dataDir string) (string, error) {
	if value := strings.TrimSpace(flagValue); value != "" {
		return value, nil
	}
	if value := strings.TrimSpace(os.Getenv("CJM_DATABASE_URL")); value != "" {
		return value, nil
	}
	if value := strings.TrimSpace(os.Getenv("DATABASE_URL")); value != "" {
		return value, nil
	}
	explicitFile := strings.TrimSpace(fileValue) != ""
	path := strings.TrimSpace(fileValue)
	if path == "" {
		path = filepath.Join(dataDir, "postgres-url.txt")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) && !explicitFile {
			return "", nil
		}
		return "", err
	}
	if value := strings.TrimSpace(string(data)); value != "" {
		return value, nil
	}
	return "", &store.ValidationError{Message: "файл подключения PostgreSQL пуст"}
}

func openBrowser(rawURL string) error {
	var command string
	var args []string
	switch runtime.GOOS {
	case "windows":
		command = "rundll32"
		args = []string{"url.dll,FileProtocolHandler", rawURL}
	case "darwin":
		command = "open"
		args = []string{rawURL}
	default:
		command = "xdg-open"
		args = []string{rawURL}
	}
	return exec.Command(command, args...).Start()
}

func spaHandler(dist fs.FS) http.Handler {
	fileServer := http.FileServer(http.FS(dist))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		clean := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
		if clean == "." || clean == "" {
			clean = "index.html"
		}
		if info, err := fs.Stat(dist, clean); err == nil && !info.IsDir() {
			if ext := path.Ext(clean); ext != "" {
				if kind := mime.TypeByExtension(ext); kind != "" {
					w.Header().Set("Content-Type", kind)
				}
			}
			fileServer.ServeHTTP(w, r)
			return
		}
		data, err := fs.ReadFile(dist, "index.html")
		if err != nil {
			http.Error(w, "frontend is not built", http.StatusServiceUnavailable)
			return
		}
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Write(data)
	})
}
