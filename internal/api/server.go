package api

import (
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"mime"
	"net/http"
	"os"
	"strconv"
	"strings"
	"time"

	"cjmstudio/internal/domain"
	"cjmstudio/internal/store"
)

type Server struct {
	store *store.Store
	mux   *http.ServeMux
}

func New(st *store.Store) *Server {
	s := &Server{store: st, mux: http.NewServeMux()}
	s.routes()
	return s
}

func (s *Server) Handler() http.Handler {
	return s.securityHeaders(s.logRequests(s.mux))
}

func (s *Server) routes() {
	s.mux.HandleFunc("GET /api/health", func(w http.ResponseWriter, _ *http.Request) { writeJSON(w, http.StatusOK, map[string]any{"ok": true}) })
	s.mux.HandleFunc("GET /api/bootstrap", s.bootstrap)
	s.mux.HandleFunc("GET /api/directories/{kind}", s.listDirectory)
	s.mux.HandleFunc("POST /api/directories/{kind}", s.createDirectory)
	s.mux.HandleFunc("PUT /api/directories/{kind}/{id}", s.updateDirectory)
	s.mux.HandleFunc("DELETE /api/directories/{kind}/{id}", s.deleteDirectory)
	s.mux.HandleFunc("GET /api/cjms", s.bootstrap)
	s.mux.HandleFunc("POST /api/cjms", s.createCJM)
	s.mux.HandleFunc("GET /api/cjms/{id}", s.getCJM)
	s.mux.HandleFunc("PUT /api/cjms/{id}", s.saveCJM)
	s.mux.HandleFunc("DELETE /api/cjms/{id}", s.deleteCJM)
	s.mux.HandleFunc("GET /api/actions/{actionId}/comments", s.listActionComments)
	s.mux.HandleFunc("POST /api/actions/{actionId}/comments", s.createActionComment)
	s.mux.HandleFunc("PUT /api/actions/{actionId}/comments/{commentId}", s.updateActionComment)
	s.mux.HandleFunc("DELETE /api/actions/{actionId}/comments/{commentId}", s.deleteActionComment)
	s.mux.HandleFunc("GET /api/cjms/{id}/revisions", s.listRevisions)
	s.mux.HandleFunc("POST /api/cjms/{id}/revisions", s.createRevision)
	s.mux.HandleFunc("GET /api/cjms/{id}/revisions/{number}", s.getRevision)
	s.mux.HandleFunc("POST /api/cjms/{id}/revisions/{number}/restore", s.restoreRevision)
	s.mux.HandleFunc("POST /api/assets", s.uploadAsset)
	s.mux.HandleFunc("GET /api/assets/{id}", s.getAsset)
	s.mux.HandleFunc("GET /api/backup", s.backup)
	s.mux.HandleFunc("POST /api/restore", s.restore)
}

func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	data, err := s.store.Bootstrap(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (s *Server) listDirectory(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListDirectory(r.Context(), r.PathValue("kind"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) createDirectory(w http.ResponseWriter, r *http.Request) {
	var item domain.DirectoryRecord
	if err := decodeJSON(r, &item); err != nil {
		writeError(w, err)
		return
	}
	created, err := s.store.CreateDirectory(r.Context(), r.PathValue("kind"), item)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, created)
}

func (s *Server) updateDirectory(w http.ResponseWriter, r *http.Request) {
	var item domain.DirectoryRecord
	if err := decodeJSON(r, &item); err != nil {
		writeError(w, err)
		return
	}
	item.ID = r.PathValue("id")
	if err := s.store.UpdateDirectory(r.Context(), r.PathValue("kind"), item); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteDirectory(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteDirectory(r.Context(), r.PathValue("kind"), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) createCJM(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Name      string `json:"name"`
		CompanyID string `json:"companyId"`
		ActorID   string `json:"actorId"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	doc, err := s.store.CreateCJM(r.Context(), input.Name, input.CompanyID, input.ActorID)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, doc)
}

func (s *Server) getCJM(w http.ResponseWriter, r *http.Request) {
	doc, err := s.store.GetCJM(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) saveCJM(w http.ResponseWriter, r *http.Request) {
	var doc domain.CJMDocument
	if err := decodeJSONLimit(r, &doc, 20<<20); err != nil {
		writeError(w, err)
		return
	}
	doc.ID = r.PathValue("id")
	saved, err := s.store.SaveCJM(r.Context(), &doc)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, saved)
}

func (s *Server) deleteCJM(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteCJM(r.Context(), r.PathValue("id")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listActionComments(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListActionComments(r.Context(), r.PathValue("actionId"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) createActionComment(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.CreateActionComment(r.Context(), r.PathValue("actionId"), input.Body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func (s *Server) updateActionComment(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Body string `json:"body"`
	}
	if err := decodeJSON(r, &input); err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.UpdateActionComment(r.Context(), r.PathValue("actionId"), r.PathValue("commentId"), input.Body)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) deleteActionComment(w http.ResponseWriter, r *http.Request) {
	if err := s.store.DeleteActionComment(r.Context(), r.PathValue("actionId"), r.PathValue("commentId")); err != nil {
		writeError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *Server) listRevisions(w http.ResponseWriter, r *http.Request) {
	items, err := s.store.ListRevisions(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, items)
}

func (s *Server) createRevision(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Comment string `json:"comment"`
		Kind    string `json:"kind"`
	}
	if r.ContentLength > 0 {
		if err := decodeJSON(r, &input); err != nil {
			writeError(w, err)
			return
		}
	}
	item, err := s.store.CreateRevision(r.Context(), r.PathValue("id"), input.Comment, input.Kind)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, item)
}

func revisionNumber(r *http.Request) (int, error) {
	number, err := strconv.Atoi(r.PathValue("number"))
	if err != nil || number < 1 {
		return 0, &store.ValidationError{Message: "некорректный номер редакции"}
	}
	return number, nil
}

func (s *Server) getRevision(w http.ResponseWriter, r *http.Request) {
	number, err := revisionNumber(r)
	if err != nil {
		writeError(w, err)
		return
	}
	item, err := s.store.GetRevision(r.Context(), r.PathValue("id"), number)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, item)
}

func (s *Server) restoreRevision(w http.ResponseWriter, r *http.Request) {
	number, err := revisionNumber(r)
	if err != nil {
		writeError(w, err)
		return
	}
	doc, err := s.store.RestoreRevision(r.Context(), r.PathValue("id"), number)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, doc)
}

func (s *Server) uploadAsset(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 6<<20)
	if err := r.ParseMultipartForm(6 << 20); err != nil {
		writeError(w, &store.ValidationError{Message: "изображение превышает 5 МБ"})
		return
	}
	file, header, err := r.FormFile("file")
	if err != nil {
		writeError(w, &store.ValidationError{Message: "выберите изображение"})
		return
	}
	defer file.Close()
	asset, err := s.store.SaveAsset(r.Context(), header.Filename, file)
	if err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, map[string]any{"id": asset.ID, "name": asset.Name, "contentType": asset.ContentType, "size": asset.Size, "url": "/api/assets/" + asset.ID})
}

func (s *Server) getAsset(w http.ResponseWriter, r *http.Request) {
	asset, err := s.store.GetAsset(r.Context(), r.PathValue("id"))
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Content-Type", asset.ContentType)
	w.Header().Set("Content-Length", strconv.FormatInt(asset.Size, 10))
	w.Header().Set("Cache-Control", "private, max-age=86400")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{"filename": asset.Name}))
	w.Write(asset.Data)
}

func (s *Server) backup(w http.ResponseWriter, r *http.Request) {
	path, err := s.store.CreateBackup(r.Context())
	if err != nil {
		writeError(w, err)
		return
	}
	defer os.Remove(path)
	file, err := os.Open(path)
	if err != nil {
		writeError(w, err)
		return
	}
	defer file.Close()
	name := "cjm-studio-" + time.Now().Format("2006-01-02-1504") + ".sqlite"
	w.Header().Set("Content-Type", "application/vnd.sqlite3")
	w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": name}))
	io.Copy(w, file)
}

func (s *Server) restore(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 500<<20)
	if err := r.ParseMultipartForm(32 << 20); err != nil {
		writeError(w, &store.ValidationError{Message: "не удалось прочитать резервную копию"})
		return
	}
	file, _, err := r.FormFile("backup")
	if err != nil {
		writeError(w, &store.ValidationError{Message: "выберите файл резервной копии"})
		return
	}
	defer file.Close()
	if err := s.store.RestoreBackup(r.Context(), file); err != nil {
		writeError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "message": "Резервная копия восстановлена"})
}

func decodeJSON(r *http.Request, dst any) error { return decodeJSONLimit(r, dst, 2<<20) }

func decodeJSONLimit(r *http.Request, dst any, limit int64) error {
	dec := json.NewDecoder(io.LimitReader(r.Body, limit))
	dec.DisallowUnknownFields()
	if err := dec.Decode(dst); err != nil {
		return &store.ValidationError{Message: "некорректный JSON: " + err.Error()}
	}
	return nil
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(value); err != nil {
		log.Printf("encode response: %v", err)
	}
}

func writeError(w http.ResponseWriter, err error) {
	status := http.StatusInternalServerError
	message := "внутренняя ошибка"
	var validation *store.ValidationError
	var conflict *store.ConflictError
	switch {
	case errors.As(err, &validation):
		status = http.StatusBadRequest
		message = validation.Message
	case errors.As(err, &conflict):
		status = http.StatusConflict
		message = conflict.Message
	case errors.Is(err, sql.ErrNoRows):
		status = http.StatusNotFound
		message = "объект не найден"
	default:
		log.Printf("request error: %v", err)
	}
	writeJSON(w, status, map[string]any{"error": message})
}

func (s *Server) securityHeaders(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("X-Frame-Options", "DENY")
		w.Header().Set("Referrer-Policy", "no-referrer")
		if origin := r.Header.Get("Origin"); origin != "" && !sameOrigin(origin, r.Host) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "внешний источник запроса запрещён"})
			return
		}
		next.ServeHTTP(w, r)
	})
}

func sameOrigin(origin, host string) bool {
	return origin == "http://"+host || origin == "https://"+host || strings.HasPrefix(origin, "http://127.0.0.1:") || strings.HasPrefix(origin, "http://localhost:")
}

func (s *Server) logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		start := time.Now()
		next.ServeHTTP(w, r)
		if strings.HasPrefix(r.URL.Path, "/api/") {
			log.Printf("%s %s %s", r.Method, r.URL.Path, time.Since(start).Round(time.Millisecond))
		}
	})
}

func ErrorText(err error) string { return fmt.Sprint(err) }
