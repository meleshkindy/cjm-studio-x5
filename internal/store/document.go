package store

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"

	"cjmstudio/internal/domain"
)

type richNode struct {
	Type    string          `json:"type"`
	Text    string          `json:"text,omitempty"`
	Attrs   json.RawMessage `json:"attrs,omitempty"`
	Marks   []richMark      `json:"marks,omitempty"`
	Content []richNode      `json:"content,omitempty"`
}

type richMark struct {
	Type  string          `json:"type"`
	Attrs json.RawMessage `json:"attrs,omitempty"`
}

func normalizeDocument(doc *domain.CJMDocument) {
	if doc.ID == "" {
		doc.ID = newID()
	}
	for si := range doc.Stages {
		stage := &doc.Stages[si]
		if stage.ID == "" {
			stage.ID = newID()
		}
		stage.Position = si
		if stage.Steps == nil {
			stage.Steps = []domain.Step{}
		}
		for pi := range stage.Steps {
			step := &stage.Steps[pi]
			if step.ID == "" {
				step.ID = newID()
			}
			step.Position = pi
			if step.Actions == nil {
				step.Actions = []domain.Action{}
			}
			for ai := range step.Actions {
				action := &step.Actions[ai]
				if action.ID == "" {
					action.ID = newID()
				}
				action.Position = ai
				action.Goal = copyDoc(action.Goal)
				action.Meaning = copyDoc(action.Meaning)
				action.Pains = copyDoc(action.Pains)
				action.ASIS.Sequence = copyDoc(action.ASIS.Sequence)
				action.TOBE.Sequence = copyDoc(action.TOBE.Sequence)
				action.ASIS.Participants = sortUnique(action.ASIS.Participants)
				action.ASIS.Systems = sortUnique(action.ASIS.Systems)
				action.TOBE.Participants = sortUnique(action.TOBE.Participants)
				action.TOBE.Systems = sortUnique(action.TOBE.Systems)
			}
		}
	}
	for i := range doc.Links {
		if doc.Links[i].ID == "" {
			doc.Links[i].ID = newID()
		}
	}
	for i := range doc.Initiatives {
		if doc.Initiatives[i].ID == "" {
			doc.Initiatives[i].ID = newID()
		}
		doc.Initiatives[i].CompanyID = doc.CompanyID
	}
	for i := range doc.InitiativeLinks {
		if doc.InitiativeLinks[i].ID == "" {
			doc.InitiativeLinks[i].ID = newID()
		}
	}
}

func validateRichDoc(raw json.RawMessage) error {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	if len(raw) > 2*1024*1024 {
		return &ValidationError{Message: "Rich Text превышает допустимый размер"}
	}
	var root richNode
	if err := json.Unmarshal(raw, &root); err != nil {
		return &ValidationError{Message: "некорректный формат Rich Text"}
	}
	if root.Type != "doc" {
		return &ValidationError{Message: "корневой элемент Rich Text должен иметь тип doc"}
	}
	return validateRichNode(root, 0)
}

func validateRichNode(node richNode, depth int) error {
	if depth > 40 {
		return &ValidationError{Message: "слишком глубокая структура Rich Text"}
	}
	allowed := map[string]bool{"doc": true, "paragraph": true, "text": true, "heading": true, "bulletList": true, "orderedList": true, "listItem": true, "blockquote": true, "hardBreak": true, "image": true}
	if !allowed[node.Type] {
		return &ValidationError{Message: "неподдерживаемый элемент Rich Text: " + node.Type}
	}
	for _, mark := range node.Marks {
		switch mark.Type {
		case "bold", "italic", "underline", "strike":
		case "link":
			var attrs struct {
				Href string `json:"href"`
			}
			if json.Unmarshal(mark.Attrs, &attrs) != nil || !validateWebURL(attrs.Href) {
				return &ValidationError{Message: "Rich Text содержит небезопасную ссылку"}
			}
		default:
			return &ValidationError{Message: "неподдерживаемое форматирование Rich Text: " + mark.Type}
		}
	}
	if node.Type == "heading" {
		var attrs struct {
			Level int `json:"level"`
		}
		if json.Unmarshal(node.Attrs, &attrs) != nil || (attrs.Level != 2 && attrs.Level != 3) {
			return &ValidationError{Message: "разрешены только подзаголовки уровней 2 и 3"}
		}
	}
	if node.Type == "image" {
		var attrs struct {
			Src, Alt, Title string
			Width           int `json:"width"`
		}
		if json.Unmarshal(node.Attrs, &attrs) != nil {
			return &ValidationError{Message: "некорректное изображение в Rich Text"}
		}
		if !strings.HasPrefix(attrs.Src, "/api/assets/") {
			return &ValidationError{Message: "изображение должно храниться локально"}
		}
		if attrs.Width < 0 || attrs.Width > 2400 {
			return &ValidationError{Message: "некорректная ширина изображения"}
		}
	}
	for _, child := range node.Content {
		if err := validateRichNode(child, depth+1); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) validateDocument(ctx context.Context, db *sql.DB, doc *domain.CJMDocument) error {
	doc.Name = strings.TrimSpace(doc.Name)
	if doc.ID == "" || doc.Name == "" || doc.CompanyID == "" || doc.ActorID == "" {
		return &ValidationError{Message: "ID, название, компания и актор обязательны"}
	}
	var actorCompany string
	if err := db.QueryRowContext(ctx, `SELECT company_id FROM actors WHERE id=?`, doc.ActorID).Scan(&actorCompany); err != nil {
		return &ValidationError{Message: "актор не найден"}
	}
	if actorCompany != doc.CompanyID {
		return &ValidationError{Message: "актор должен принадлежать компании CJM"}
	}
	if len(doc.Stages) > 50 {
		return &ValidationError{Message: "слишком много стадий"}
	}

	participantSet, err := referenceSet(ctx, db, "participants", doc.CompanyID)
	if err != nil {
		return err
	}
	systemSet, err := referenceSet(ctx, db, "systems", doc.CompanyID)
	if err != nil {
		return err
	}
	initiativeSet := map[string]bool{}
	initiativeTypes := map[string]bool{"Live": true, "Future": true, "Gap": true, "MVP1": true, "MVP2": true, "MVP3": true}
	for _, initiative := range doc.Initiatives {
		if initiative.ID == "" || strings.TrimSpace(initiative.Name) == "" || !initiativeTypes[initiative.Type] {
			return &ValidationError{Message: "инициатива должна иметь ID, название и допустимый тип"}
		}
		if initiative.CompanyID != "" && initiative.CompanyID != doc.CompanyID {
			return &ValidationError{Message: "инициатива относится к другой компании"}
		}
		initiativeSet[initiative.ID] = true
	}

	ids := map[string]string{}
	stepOrder := map[string]int{}
	actionStep := map[string]string{}
	order := 0
	stepCount, actionCount := 0, 0
	for _, stage := range doc.Stages {
		if stage.ID == "" || strings.TrimSpace(stage.Name) == "" {
			return &ValidationError{Message: "каждая стадия должна иметь ID и название"}
		}
		if ids[stage.ID] != "" {
			return &ValidationError{Message: "обнаружен дублирующийся ID узла"}
		}
		ids[stage.ID] = "stage"
		for _, step := range stage.Steps {
			stepCount++
			if stepCount > 500 {
				return &ValidationError{Message: "слишком много шагов"}
			}
			if step.ID == "" || strings.TrimSpace(step.Name) == "" {
				return &ValidationError{Message: "каждый шаг должен иметь ID и название"}
			}
			if ids[step.ID] != "" {
				return &ValidationError{Message: "обнаружен дублирующийся ID узла"}
			}
			ids[step.ID] = "step"
			stepOrder[step.ID] = order
			order++
			for _, action := range step.Actions {
				actionCount++
				if actionCount > 5000 {
					return &ValidationError{Message: "слишком много действий"}
				}
				if action.ID == "" || strings.TrimSpace(action.Name) == "" {
					return &ValidationError{Message: "каждое действие должно иметь ID и название"}
				}
				if ids[action.ID] != "" {
					return &ValidationError{Message: "обнаружен дублирующийся ID узла"}
				}
				ids[action.ID] = "action"
				actionStep[action.ID] = step.ID
				for _, raw := range []json.RawMessage{action.Goal, action.Meaning, action.Pains, action.ASIS.Sequence, action.TOBE.Sequence} {
					if err := validateRichDoc(raw); err != nil {
						return fmt.Errorf("действие %s: %w", action.Name, err)
					}
				}
				for _, pid := range append(append([]string{}, action.ASIS.Participants...), action.TOBE.Participants...) {
					if !participantSet[pid] {
						return &ValidationError{Message: "участник процесса относится к другой компании или не найден"}
					}
				}
				for _, sid := range append(append([]string{}, action.ASIS.Systems...), action.TOBE.Systems...) {
					if !systemSet[sid] {
						return &ValidationError{Message: "информационная система относится к другой компании или не найдена"}
					}
				}
			}
		}
	}

	adj := map[string][]string{}
	seenLinks := map[string]bool{}
	for _, link := range doc.Links {
		if _, ok := stepOrder[link.SourceID]; !ok {
			return &ValidationError{Message: "исходный шаг связи не найден"}
		}
		if _, ok := stepOrder[link.TargetID]; !ok {
			return &ValidationError{Message: "целевой шаг связи не найден"}
		}
		if link.SourceID == link.TargetID {
			return &ValidationError{Message: "шаг не может ссылаться на себя"}
		}
		if stepOrder[link.SourceID] >= stepOrder[link.TargetID] {
			return &ValidationError{Message: "связь с более позднего шага на более ранний запрещена"}
		}
		if link.Type != "main" && link.Type != "additional" && link.Type != "alternative" {
			return &ValidationError{Message: "неизвестный тип связи"}
		}
		key := link.SourceID + "|" + link.TargetID + "|" + link.Type
		if seenLinks[key] {
			return &ValidationError{Message: "обнаружена дублирующая связь"}
		}
		seenLinks[key] = true
		adj[link.SourceID] = append(adj[link.SourceID], link.TargetID)
	}
	if hasCycle(adj) {
		return &ValidationError{Message: "циклические связи запрещены"}
	}

	seenInitiativeLinks := map[string]bool{}
	for _, link := range doc.InitiativeLinks {
		if !initiativeSet[link.InitiativeID] {
			return &ValidationError{Message: "инициатива связи не найдена"}
		}
		if _, ok := stepOrder[link.StepID]; !ok {
			return &ValidationError{Message: "шаг инициативы не найден"}
		}
		if link.ActionID != "" && actionStep[link.ActionID] != link.StepID {
			return &ValidationError{Message: "действие инициативы должно принадлежать выбранному шагу"}
		}
		key := link.InitiativeID + "|" + link.StepID + "|" + link.ActionID
		if seenInitiativeLinks[key] {
			return &ValidationError{Message: "инициатива уже связана с этим узлом"}
		}
		seenInitiativeLinks[key] = true
	}
	return nil
}

func referenceSet(ctx context.Context, db *sql.DB, table, companyID string) (map[string]bool, error) {
	rows, err := db.QueryContext(ctx, fmt.Sprintf(`SELECT id FROM %s WHERE company_id=?`, table), companyID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]bool{}
	for rows.Next() {
		var id string
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		out[id] = true
	}
	return out, rows.Err()
}

func hasCycle(adj map[string][]string) bool {
	state := map[string]int{}
	var visit func(string) bool
	visit = func(n string) bool {
		if state[n] == 1 {
			return true
		}
		if state[n] == 2 {
			return false
		}
		state[n] = 1
		for _, next := range adj[n] {
			if visit(next) {
				return true
			}
		}
		state[n] = 2
		return false
	}
	for n := range adj {
		if visit(n) {
			return true
		}
	}
	return false
}

func (s *Store) SaveCJM(ctx context.Context, doc *domain.CJMDocument) (*domain.CJMDocument, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	normalizeDocument(doc)
	if err := s.validateDocument(ctx, s.db, doc); err != nil {
		return nil, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return nil, err
	}
	defer tx.Rollback()
	t := now()
	result, err := tx.ExecContext(ctx, `UPDATE cjms SET name=?,company_id=?,actor_id=?,updated_at=?,updated_by=?,row_version=row_version+1 WHERE id=? AND row_version=?`, doc.Name, doc.CompanyID, doc.ActorID, t, localUser, doc.ID, doc.RowVersion)
	if err != nil {
		return nil, translateConstraint(err)
	}
	affected, _ := result.RowsAffected()
	if affected == 0 {
		return nil, &ConflictError{Message: "CJM была изменена в другой вкладке; загрузите актуальную версию"}
	}
	for _, initiativeID := range sortUnique(doc.DeletedInitiativeIDs) {
		if _, err := tx.ExecContext(ctx, `DELETE FROM initiative_links WHERE initiative_id IN (SELECT id FROM initiatives WHERE id=? AND company_id=?)`, initiativeID, doc.CompanyID); err != nil {
			return nil, err
		}
		if _, err := tx.ExecContext(ctx, `DELETE FROM initiatives WHERE id=? AND company_id=?`, initiativeID, doc.CompanyID); err != nil {
			return nil, err
		}
	}
	if err := pruneRemovedActionComments(ctx, tx, doc); err != nil {
		return nil, err
	}
	if _, err := tx.ExecContext(ctx, `DELETE FROM stages WHERE cjm_id=?`, doc.ID); err != nil {
		return nil, err
	}
	for _, stage := range doc.Stages {
		if _, err := tx.ExecContext(ctx, `INSERT INTO stages(id,cjm_id,position,name,description) VALUES(?,?,?,?,?)`, stage.ID, doc.ID, stage.Position, stage.Name, stage.Description); err != nil {
			return nil, err
		}
		for _, step := range stage.Steps {
			if _, err := tx.ExecContext(ctx, `INSERT INTO steps(id,stage_id,position,name,description) VALUES(?,?,?,?,?)`, step.ID, stage.ID, step.Position, step.Name, step.Description); err != nil {
				return nil, err
			}
			for _, action := range step.Actions {
				if _, err := tx.ExecContext(ctx, `INSERT INTO actions(id,step_id,position,name,description,goal_doc,meaning_doc,pains_doc,open_questions) VALUES(?,?,?,?,?,?,?,?,?)`, action.ID, step.ID, action.Position, action.Name, action.Description, string(action.Goal), string(action.Meaning), string(action.Pains), action.OpenQuestions); err != nil {
					return nil, err
				}
				if err := insertActionState(ctx, tx, action.ID, "as_is", action.ASIS); err != nil {
					return nil, err
				}
				if err := insertActionState(ctx, tx, action.ID, "to_be", action.TOBE); err != nil {
					return nil, err
				}
			}
		}
	}
	for _, link := range doc.Links {
		if _, err := tx.ExecContext(ctx, `INSERT INTO step_links(id,cjm_id,source_step_id,target_step_id,link_type) VALUES(?,?,?,?,?)`, link.ID, doc.ID, link.SourceID, link.TargetID, link.Type); err != nil {
			return nil, err
		}
	}
	for _, initiative := range doc.Initiatives {
		_, err := tx.ExecContext(ctx, `INSERT INTO initiatives(id,company_id,initiative_type,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET initiative_type=excluded.initiative_type,name=excluded.name,description=excluded.description,updated_at=excluded.updated_at WHERE initiatives.company_id=excluded.company_id`, initiative.ID, doc.CompanyID, initiative.Type, initiative.Name, initiative.Description, t, t)
		if err != nil {
			return nil, translateConstraint(err)
		}
	}
	for _, link := range doc.InitiativeLinks {
		var action any = nil
		if link.ActionID != "" {
			action = link.ActionID
		}
		if _, err := tx.ExecContext(ctx, `INSERT INTO initiative_links(id,cjm_id,initiative_id,step_id,action_id) VALUES(?,?,?,?,?)`, link.ID, doc.ID, link.InitiativeID, link.StepID, action); err != nil {
			return nil, translateConstraint(err)
		}
	}
	if err := tx.Commit(); err != nil {
		return nil, err
	}
	return getCJM(ctx, s.db, doc.ID)
}

func pruneRemovedActionComments(ctx context.Context, tx *sql.Tx, doc *domain.CJMDocument) error {
	retained := map[string]bool{}
	for _, stage := range doc.Stages {
		for _, step := range stage.Steps {
			for _, action := range step.Actions {
				retained[action.ID] = true
			}
		}
	}
	rows, err := tx.QueryContext(ctx, `SELECT a.id FROM actions a JOIN steps st ON st.id=a.step_id JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=?`, doc.ID)
	if err != nil {
		return err
	}
	current := []string{}
	for rows.Next() {
		var actionID string
		if err := rows.Scan(&actionID); err != nil {
			rows.Close()
			return err
		}
		current = append(current, actionID)
	}
	if err := rows.Err(); err != nil {
		rows.Close()
		return err
	}
	if err := rows.Close(); err != nil {
		return err
	}
	for _, actionID := range current {
		if !retained[actionID] {
			if _, err := tx.ExecContext(ctx, `DELETE FROM action_comments WHERE cjm_id=? AND action_id=?`, doc.ID, actionID); err != nil {
				return err
			}
		}
	}
	return nil
}

func insertActionState(ctx context.Context, tx *sql.Tx, actionID, state string, value domain.ActionState) error {
	if _, err := tx.ExecContext(ctx, `INSERT INTO action_states(action_id,state,sequence_doc) VALUES(?,?,?)`, actionID, state, string(value.Sequence)); err != nil {
		return err
	}
	for _, id := range value.Participants {
		if _, err := tx.ExecContext(ctx, `INSERT INTO action_state_participants(action_id,state,participant_id) VALUES(?,?,?)`, actionID, state, id); err != nil {
			return err
		}
	}
	for _, id := range value.Systems {
		if _, err := tx.ExecContext(ctx, `INSERT INTO action_state_systems(action_id,state,system_id) VALUES(?,?,?)`, actionID, state, id); err != nil {
			return err
		}
	}
	return nil
}

func validateURLForTest(raw string) bool { u, err := url.Parse(raw); return err == nil && u.Host != "" }
