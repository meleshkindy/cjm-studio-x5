package api

import "net/http"

func (s *Server) getCJMReport(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !s.requireCJMAccess(w, r, id, false) {
		return
	}
	report, err := s.store.GetCJMReport(r.Context(), id, r.URL.Query().Get("history") == "1")
	if err != nil {
		writeError(w, err)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, http.StatusOK, report)
}
