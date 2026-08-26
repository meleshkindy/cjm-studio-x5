package store

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cjmstudio/internal/domain"

	_ "modernc.org/sqlite"
)

const localUser = "Локальный пользователь"

var emptyDoc = json.RawMessage(`{"type":"doc","content":[{"type":"paragraph"}]}`)

type Store struct {
	mu   sync.RWMutex
	db   *sql.DB
	path string
}

type ConflictError struct{ Message string }

func (e *ConflictError) Error() string { return e.Message }

type ValidationError struct{ Message string }

func (e *ValidationError) Error() string { return e.Message }

func Open(path string) (*Store, error) {
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, err
	}
	db, err := openDB(path)
	if err != nil {
		return nil, err
	}
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("initialize schema: %w", err)
	}
	s := &Store{db: db, path: path}
	if err := s.seed(); err != nil {
		db.Close()
		return nil, err
	}
	return s, nil
}

func openDB(path string) (*sql.DB, error) {
	dsn := "file:" + filepath.ToSlash(path) + "?_pragma=foreign_keys(1)&_pragma=busy_timeout(5000)&_pragma=journal_mode(WAL)"
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		db.Close()
		return nil, err
	}
	return db, nil
}

func (s *Store) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.db.Close()
}

func now() string { return time.Now().UTC().Format(time.RFC3339) }

func newID() string {
	b := make([]byte, 16)
	if _, err := rand.Read(b); err != nil {
		panic(err)
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	h := hex.EncodeToString(b)
	return h[0:8] + "-" + h[8:12] + "-" + h[12:16] + "-" + h[16:20] + "-" + h[20:32]
}

func copyDoc(in json.RawMessage) json.RawMessage {
	if len(in) == 0 || string(in) == "null" {
		return append(json.RawMessage(nil), emptyDoc...)
	}
	return append(json.RawMessage(nil), in...)
}

func (s *Store) seed() error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var count int
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM companies`).Scan(&count); err != nil {
		return err
	}
	if count > 0 {
		return nil
	}

	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	t := now()
	companyA, companyB := newID(), newID()
	for _, row := range []struct{ id, code, name string }{
		{companyA, "1001", "Торговая сеть «Альфа»"},
		{companyB, "2001", "Торговая сеть «Бета»"},
	} {
		if _, err := tx.Exec(`INSERT INTO companies(id,be_number,name,created_at,updated_at) VALUES(?,?,?,?,?)`, row.id, row.code, row.name, t, t); err != nil {
			return err
		}
	}

	actorLandlord, actorManager, actorOwner := newID(), newID(), newID()
	for _, row := range []struct{ id, company, code, name, desc string }{
		{actorLandlord, companyA, "ACT-001", "Арендодатель", "Представитель собственника помещения"},
		{actorManager, companyA, "ACT-002", "Менеджер аренды", "Внутренний менеджер по аренде"},
		{actorOwner, companyB, "ACT-003", "Собственник помещения", "Владелец арендуемого объекта"},
	} {
		if _, err := tx.Exec(`INSERT INTO actors(id,company_id,business_code,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, row.id, row.company, row.code, row.name, row.desc, t, t); err != nil {
			return err
		}
	}

	participants := []struct{ id, company, code, name, desc string }{
		{newID(), companyA, "P-001", "Менеджер аренды", "Владелец процесса аренды"},
		{newID(), companyA, "P-002", "Юрист", "Согласование договора"},
		{newID(), companyA, "P-003", "Проектировщик", "Техническая проверка помещения"},
		{newID(), companyB, "P-004", "Менеджер объекта", "Сопровождение объекта"},
	}
	for _, row := range participants {
		if _, err := tx.Exec(`INSERT INTO participants(id,company_id,business_code,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, row.id, row.company, row.code, row.name, row.desc, t, t); err != nil {
			return err
		}
	}
	systems := []struct{ id, company, code, name, desc string }{
		{newID(), companyA, "SYS-001", "Реестр объектов", "Карточки и параметры объектов"},
		{newID(), companyA, "SYS-002", "Корпоративная почта", "Переписка и документы"},
		{newID(), companyA, "SYS-003", "Система договоров", "Подготовка и согласование договоров"},
		{newID(), companyB, "SYS-004", "Реестр договоров", "Договоры сети"},
	}
	for _, row := range systems {
		if _, err := tx.Exec(`INSERT INTO systems(id,company_id,business_code,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, row.id, row.company, row.code, row.name, row.desc, t, t); err != nil {
			return err
		}
	}

	cjmID := newID()
	if _, err := tx.Exec(`INSERT INTO cjms(id,name,company_id,actor_id,created_at,updated_at,created_by,updated_by,row_version,current_revision) VALUES(?,?,?,?,?,?,?,?,1,0)`, cjmID, "Открытие нового магазина", companyA, actorLandlord, t, t, localUser, localUser); err != nil {
		return err
	}

	stageNames := []string{"Выбор объекта", "Переговоры", "Подписание", "Подготовка", "Эксплуатация"}
	stepNames := [][]string{{"Сбор требований", "Поиск помещения"}, {"Обсуждение условий", "Согласование условий"}, {"Подготовка договора", "Подписание договора"}, {"Передача помещения"}, {"Сопровождение объекта"}}
	var previousStep string
	for stagePos, stageName := range stageNames {
		stageID := newID()
		if _, err := tx.Exec(`INSERT INTO stages(id,cjm_id,position,name,description) VALUES(?,?,?,?,?)`, stageID, cjmID, stagePos, stageName, ""); err != nil {
			return err
		}
		for stepPos, stepName := range stepNames[stagePos] {
			stepID := newID()
			if _, err := tx.Exec(`INSERT INTO steps(id,stage_id,position,name,description) VALUES(?,?,?,?,?)`, stepID, stageID, stepPos, stepName, "Этап взаимодействия с арендодателем"); err != nil {
				return err
			}
			if previousStep != "" {
				if _, err := tx.Exec(`INSERT INTO step_links(id,cjm_id,source_step_id,target_step_id,link_type) VALUES(?,?,?,?,?)`, newID(), cjmID, previousStep, stepID, "main"); err != nil {
					return err
				}
			}
			previousStep = stepID
			for actionPos, actionName := range []string{"Получает исходные данные", "Согласовывает результат"} {
				actionID := newID()
				goal := json.RawMessage(`{"type":"doc","content":[{"type":"paragraph","content":[{"type":"text","text":"Получить согласованный результат без потери данных."}]}]}`)
				if _, err := tx.Exec(`INSERT INTO actions(id,step_id,position,name,description,goal_doc,meaning_doc,pains_doc,open_questions) VALUES(?,?,?,?,?,?,?,?,?)`, actionID, stepID, actionPos, actionName, "", string(goal), string(emptyDoc), string(emptyDoc), ""); err != nil {
					return err
				}
				for _, state := range []string{"as_is", "to_be"} {
					if _, err := tx.Exec(`INSERT INTO action_states(action_id,state,sequence_doc) VALUES(?,?,?)`, actionID, state, string(emptyDoc)); err != nil {
						return err
					}
				}
			}
		}
	}
	initiativeID := newID()
	if _, err := tx.Exec(`INSERT INTO initiatives(id,company_id,initiative_type,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, initiativeID, companyA, "Gap", "Автопроверка условий", "Проверка обязательных условий предложения", t, t); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Store) Bootstrap(ctx context.Context) (domain.Bootstrap, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	var out domain.Bootstrap
	var err error
	if out.Companies, err = listDirectory(ctx, s.db, "companies"); err != nil {
		return out, err
	}
	if out.Actors, err = listDirectory(ctx, s.db, "actors"); err != nil {
		return out, err
	}
	if out.Participants, err = listDirectory(ctx, s.db, "participants"); err != nil {
		return out, err
	}
	if out.Systems, err = listDirectory(ctx, s.db, "systems"); err != nil {
		return out, err
	}
	if out.CJMs, err = listCJMs(ctx, s.db); err != nil {
		return out, err
	}
	return out, nil
}

func listDirectory(ctx context.Context, db queryer, kind string) ([]domain.DirectoryRecord, error) {
	table, err := directoryTable(kind)
	if err != nil {
		return nil, err
	}
	query := `SELECT id, '', be_number, name, '' FROM companies ORDER BY name`
	if table != "companies" {
		query = fmt.Sprintf(`SELECT id, company_id, business_code, name, description FROM %s ORDER BY name`, table)
	}
	rows, err := db.QueryContext(ctx, query)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.DirectoryRecord{}
	for rows.Next() {
		var item domain.DirectoryRecord
		if err := rows.Scan(&item.ID, &item.CompanyID, &item.Code, &item.Name, &item.Description); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

func listCJMs(ctx context.Context, db queryer) ([]domain.CJMSummary, error) {
	rows, err := db.QueryContext(ctx, `
		SELECT c.id,c.name,c.company_id,co.name,c.actor_id,a.name,
		       (SELECT COUNT(*) FROM stages s WHERE s.cjm_id=c.id),
		       (SELECT COUNT(*) FROM steps st JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=c.id),
		       c.current_revision,c.updated_at
		FROM cjms c JOIN companies co ON co.id=c.company_id JOIN actors a ON a.id=c.actor_id
		ORDER BY c.updated_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	items := []domain.CJMSummary{}
	for rows.Next() {
		var item domain.CJMSummary
		if err := rows.Scan(&item.ID, &item.Name, &item.CompanyID, &item.CompanyName, &item.ActorID, &item.ActorName, &item.StageCount, &item.StepCount, &item.Revision, &item.UpdatedAt); err != nil {
			return nil, err
		}
		items = append(items, item)
	}
	return items, rows.Err()
}

type queryer interface {
	QueryContext(context.Context, string, ...any) (*sql.Rows, error)
}

func directoryTable(kind string) (string, error) {
	switch kind {
	case "companies", "actors", "participants", "systems":
		return kind, nil
	default:
		return "", &ValidationError{Message: "неизвестный справочник"}
	}
}

func (s *Store) ListDirectory(ctx context.Context, kind string) ([]domain.DirectoryRecord, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return listDirectory(ctx, s.db, kind)
}

func (s *Store) CreateDirectory(ctx context.Context, kind string, item domain.DirectoryRecord) (domain.DirectoryRecord, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	table, err := directoryTable(kind)
	if err != nil {
		return item, err
	}
	item.ID = newID()
	item.Name = strings.TrimSpace(item.Name)
	item.Code = strings.TrimSpace(item.Code)
	if item.Name == "" {
		return item, &ValidationError{Message: "наименование обязательно"}
	}
	t := now()
	if table == "companies" {
		if item.Code == "" {
			return item, &ValidationError{Message: "номер БЕ обязателен"}
		}
		_, err = s.db.ExecContext(ctx, `INSERT INTO companies(id,be_number,name,created_at,updated_at) VALUES(?,?,?,?,?)`, item.ID, item.Code, item.Name, t, t)
	} else {
		if item.CompanyID == "" {
			return item, &ValidationError{Message: "компания обязательна"}
		}
		tx, txErr := s.db.BeginTx(ctx, nil)
		if txErr != nil {
			return item, txErr
		}
		defer tx.Rollback()
		item.Code, err = nextDirectoryCode(ctx, tx, kind, table)
		if err != nil {
			return item, err
		}
		query := fmt.Sprintf(`INSERT INTO %s(id,company_id,business_code,name,description,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`, table)
		if _, err = tx.ExecContext(ctx, query, item.ID, item.CompanyID, item.Code, item.Name, item.Description, t, t); err != nil {
			return item, translateConstraint(err)
		}
		if err = tx.Commit(); err != nil {
			return item, translateConstraint(err)
		}
	}
	return item, translateConstraint(err)
}

func directoryCodePrefix(kind string) (string, error) {
	switch kind {
	case "actors":
		return "ACT", nil
	case "participants":
		return "P", nil
	case "systems":
		return "SYS", nil
	default:
		return "", &ValidationError{Message: "автоматический ID для справочника не поддерживается"}
	}
}

func nextDirectoryCode(ctx context.Context, tx *sql.Tx, kind, table string) (string, error) {
	prefix, err := directoryCodePrefix(kind)
	if err != nil {
		return "", err
	}
	var next int
	err = tx.QueryRowContext(ctx, `SELECT next_value FROM directory_counters WHERE kind=?`, kind).Scan(&next)
	if errors.Is(err, sql.ErrNoRows) {
		rows, queryErr := tx.QueryContext(ctx, fmt.Sprintf(`SELECT business_code FROM %s`, table))
		if queryErr != nil {
			return "", queryErr
		}
		defer rows.Close()
		maxValue := 0
		for rows.Next() {
			var code string
			if scanErr := rows.Scan(&code); scanErr != nil {
				return "", scanErr
			}
			value, parseErr := strconv.Atoi(strings.TrimPrefix(code, prefix+"-"))
			if parseErr == nil && strings.HasPrefix(code, prefix+"-") && value > maxValue {
				maxValue = value
			}
		}
		if rowsErr := rows.Err(); rowsErr != nil {
			return "", rowsErr
		}
		if closeErr := rows.Close(); closeErr != nil {
			return "", closeErr
		}
		next = maxValue + 1
		if _, err = tx.ExecContext(ctx, `INSERT INTO directory_counters(kind,next_value) VALUES(?,?)`, kind, next+1); err != nil {
			return "", err
		}
	} else if err != nil {
		return "", err
	} else if _, err = tx.ExecContext(ctx, `UPDATE directory_counters SET next_value=? WHERE kind=?`, next+1, kind); err != nil {
		return "", err
	}
	return fmt.Sprintf("%s-%03d", prefix, next), nil
}

func (s *Store) UpdateDirectory(ctx context.Context, kind string, item domain.DirectoryRecord) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	table, err := directoryTable(kind)
	if err != nil {
		return err
	}
	if item.ID == "" || strings.TrimSpace(item.Name) == "" {
		return &ValidationError{Message: "ID и наименование обязательны"}
	}
	if table == "companies" {
		if strings.TrimSpace(item.Code) == "" {
			return &ValidationError{Message: "номер БЕ обязателен"}
		}
		_, err = s.db.ExecContext(ctx, `UPDATE companies SET be_number=?,name=?,updated_at=? WHERE id=?`, item.Code, item.Name, now(), item.ID)
	} else {
		query := fmt.Sprintf(`UPDATE %s SET company_id=?,name=?,description=?,updated_at=? WHERE id=?`, table)
		_, err = s.db.ExecContext(ctx, query, item.CompanyID, item.Name, item.Description, now(), item.ID)
	}
	return translateConstraint(err)
}

func (s *Store) DeleteDirectory(ctx context.Context, kind, id string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	table, err := directoryTable(kind)
	if err != nil {
		return err
	}
	_, err = s.db.ExecContext(ctx, fmt.Sprintf(`DELETE FROM %s WHERE id=?`, table), id)
	return translateConstraint(err)
}

func translateConstraint(err error) error {
	if err == nil {
		return nil
	}
	text := strings.ToLower(err.Error())
	if strings.Contains(text, "constraint") || strings.Contains(text, "unique") || strings.Contains(text, "foreign key") {
		return &ConflictError{Message: "операция нарушает уникальность или связанные данные"}
	}
	return err
}

func (s *Store) CreateCJM(ctx context.Context, name, companyID, actorID string) (*domain.CJMDocument, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	name = strings.TrimSpace(name)
	if name == "" || companyID == "" || actorID == "" {
		return nil, &ValidationError{Message: "название, компания и актор обязательны"}
	}
	var actorCompany string
	if err := s.db.QueryRowContext(ctx, `SELECT company_id FROM actors WHERE id=?`, actorID).Scan(&actorCompany); err != nil {
		return nil, &ValidationError{Message: "актор не найден"}
	}
	if actorCompany != companyID {
		return nil, &ValidationError{Message: "актор должен принадлежать компании CJM"}
	}
	id, t := newID(), now()
	if _, err := s.db.ExecContext(ctx, `INSERT INTO cjms(id,name,company_id,actor_id,created_at,updated_at,created_by,updated_by,row_version,current_revision) VALUES(?,?,?,?,?,?,?,?,1,0)`, id, name, companyID, actorID, t, t, localUser, localUser); err != nil {
		return nil, translateConstraint(err)
	}
	stageID, stepID := newID(), newID()
	if _, err := s.db.ExecContext(ctx, `INSERT INTO stages(id,cjm_id,position,name,description) VALUES(?,?,?,?,?)`, stageID, id, 0, "Новая стадия", ""); err != nil {
		return nil, err
	}
	if _, err := s.db.ExecContext(ctx, `INSERT INTO steps(id,stage_id,position,name,description) VALUES(?,?,?,?,?)`, stepID, stageID, 0, "Новый шаг", ""); err != nil {
		return nil, err
	}
	return getCJM(ctx, s.db, id)
}

func (s *Store) GetCJM(ctx context.Context, id string) (*domain.CJMDocument, error) {
	s.mu.RLock()
	defer s.mu.RUnlock()
	return getCJM(ctx, s.db, id)
}

func getCJM(ctx context.Context, db *sql.DB, id string) (*domain.CJMDocument, error) {
	doc := &domain.CJMDocument{Stages: []domain.Stage{}, Links: []domain.StepLink{}, Initiatives: []domain.Initiative{}, InitiativeLinks: []domain.InitiativeLink{}}
	err := db.QueryRowContext(ctx, `SELECT id,name,company_id,actor_id,created_at,updated_at,created_by,updated_by,row_version,current_revision FROM cjms WHERE id=?`, id).Scan(&doc.ID, &doc.Name, &doc.CompanyID, &doc.ActorID, &doc.CreatedAt, &doc.UpdatedAt, &doc.CreatedBy, &doc.UpdatedBy, &doc.RowVersion, &doc.CurrentRevision)
	if err != nil {
		return nil, err
	}

	stageRows, err := db.QueryContext(ctx, `SELECT id,position,name,description FROM stages WHERE cjm_id=? ORDER BY position`, id)
	if err != nil {
		return nil, err
	}
	stageIndex := map[string]int{}
	for stageRows.Next() {
		var st domain.Stage
		if err := stageRows.Scan(&st.ID, &st.Position, &st.Name, &st.Description); err != nil {
			stageRows.Close()
			return nil, err
		}
		st.Steps = []domain.Step{}
		stageIndex[st.ID] = len(doc.Stages)
		doc.Stages = append(doc.Stages, st)
	}
	stageRows.Close()

	stepRows, err := db.QueryContext(ctx, `SELECT st.id,st.stage_id,st.position,st.name,st.description FROM steps st JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=? ORDER BY s.position,st.position`, id)
	if err != nil {
		return nil, err
	}
	stepLocations := map[string][2]int{}
	for stepRows.Next() {
		var step domain.Step
		var stageID string
		if err := stepRows.Scan(&step.ID, &stageID, &step.Position, &step.Name, &step.Description); err != nil {
			stepRows.Close()
			return nil, err
		}
		step.Actions = []domain.Action{}
		si := stageIndex[stageID]
		stepLocations[step.ID] = [2]int{si, len(doc.Stages[si].Steps)}
		doc.Stages[si].Steps = append(doc.Stages[si].Steps, step)
	}
	stepRows.Close()

	actionRows, err := db.QueryContext(ctx, `SELECT a.id,a.step_id,a.position,a.name,a.description,a.goal_doc,a.meaning_doc,a.pains_doc,a.open_questions FROM actions a JOIN steps st ON st.id=a.step_id JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=? ORDER BY s.position,st.position,a.position`, id)
	if err != nil {
		return nil, err
	}
	actionLocations := map[string][3]int{}
	for actionRows.Next() {
		var a domain.Action
		var stepID string
		var goal, meaning, pains string
		if err := actionRows.Scan(&a.ID, &stepID, &a.Position, &a.Name, &a.Description, &goal, &meaning, &pains, &a.OpenQuestions); err != nil {
			actionRows.Close()
			return nil, err
		}
		a.Goal = json.RawMessage(goal)
		a.Meaning = json.RawMessage(meaning)
		a.Pains = json.RawMessage(pains)
		a.ASIS = domain.ActionState{Participants: []string{}, Systems: []string{}, Sequence: copyDoc(nil)}
		a.TOBE = domain.ActionState{Participants: []string{}, Systems: []string{}, Sequence: copyDoc(nil)}
		loc := stepLocations[stepID]
		actionLocations[a.ID] = [3]int{loc[0], loc[1], len(doc.Stages[loc[0]].Steps[loc[1]].Actions)}
		doc.Stages[loc[0]].Steps[loc[1]].Actions = append(doc.Stages[loc[0]].Steps[loc[1]].Actions, a)
	}
	actionRows.Close()

	stateRows, err := db.QueryContext(ctx, `SELECT ast.action_id,ast.state,ast.sequence_doc FROM action_states ast JOIN actions a ON a.id=ast.action_id JOIN steps st ON st.id=a.step_id JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=?`, id)
	if err != nil {
		return nil, err
	}
	for stateRows.Next() {
		var actionID, state, sequence string
		if err := stateRows.Scan(&actionID, &state, &sequence); err != nil {
			stateRows.Close()
			return nil, err
		}
		loc := actionLocations[actionID]
		a := &doc.Stages[loc[0]].Steps[loc[1]].Actions[loc[2]]
		if state == "as_is" {
			a.ASIS.Sequence = json.RawMessage(sequence)
		} else {
			a.TOBE.Sequence = json.RawMessage(sequence)
		}
	}
	stateRows.Close()

	if err := loadStateRefs(ctx, db, id, actionLocations, doc); err != nil {
		return nil, err
	}

	linkRows, err := db.QueryContext(ctx, `SELECT id,source_step_id,target_step_id,link_type FROM step_links WHERE cjm_id=? ORDER BY rowid`, id)
	if err != nil {
		return nil, err
	}
	for linkRows.Next() {
		var item domain.StepLink
		if err := linkRows.Scan(&item.ID, &item.SourceID, &item.TargetID, &item.Type); err != nil {
			linkRows.Close()
			return nil, err
		}
		doc.Links = append(doc.Links, item)
	}
	linkRows.Close()

	initiativeRows, err := db.QueryContext(ctx, `SELECT id,company_id,initiative_type,name,description FROM initiatives WHERE company_id=? ORDER BY name`, doc.CompanyID)
	if err != nil {
		return nil, err
	}
	for initiativeRows.Next() {
		var item domain.Initiative
		if err := initiativeRows.Scan(&item.ID, &item.CompanyID, &item.Type, &item.Name, &item.Description); err != nil {
			initiativeRows.Close()
			return nil, err
		}
		doc.Initiatives = append(doc.Initiatives, item)
	}
	initiativeRows.Close()

	ilRows, err := db.QueryContext(ctx, `SELECT id,initiative_id,step_id,COALESCE(action_id,'') FROM initiative_links WHERE cjm_id=?`, id)
	if err != nil {
		return nil, err
	}
	for ilRows.Next() {
		var item domain.InitiativeLink
		if err := ilRows.Scan(&item.ID, &item.InitiativeID, &item.StepID, &item.ActionID); err != nil {
			ilRows.Close()
			return nil, err
		}
		doc.InitiativeLinks = append(doc.InitiativeLinks, item)
	}
	ilRows.Close()
	return doc, nil
}

func loadStateRefs(ctx context.Context, db *sql.DB, cjmID string, locations map[string][3]int, doc *domain.CJMDocument) error {
	queries := []struct {
		sql         string
		participant bool
	}{
		{`SELECT r.action_id,r.state,r.participant_id FROM action_state_participants r JOIN actions a ON a.id=r.action_id JOIN steps st ON st.id=a.step_id JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=?`, true},
		{`SELECT r.action_id,r.state,r.system_id FROM action_state_systems r JOIN actions a ON a.id=r.action_id JOIN steps st ON st.id=a.step_id JOIN stages s ON s.id=st.stage_id WHERE s.cjm_id=?`, false},
	}
	for _, q := range queries {
		rows, err := db.QueryContext(ctx, q.sql, cjmID)
		if err != nil {
			return err
		}
		for rows.Next() {
			var actionID, state, ref string
			if err := rows.Scan(&actionID, &state, &ref); err != nil {
				rows.Close()
				return err
			}
			loc := locations[actionID]
			a := &doc.Stages[loc[0]].Steps[loc[1]].Actions[loc[2]]
			target := &a.ASIS
			if state == "to_be" {
				target = &a.TOBE
			}
			if q.participant {
				target.Participants = append(target.Participants, ref)
			} else {
				target.Systems = append(target.Systems, ref)
			}
		}
		rows.Close()
	}
	return nil
}

func (s *Store) DeleteCJM(ctx context.Context, id string) error {
	s.mu.RLock()
	defer s.mu.RUnlock()
	_, err := s.db.ExecContext(ctx, `DELETE FROM cjms WHERE id=?`, id)
	return err
}

func checksum(data []byte) string { sum := sha256.Sum256(data); return hex.EncodeToString(sum[:]) }

func validateWebURL(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Host != ""
}

func detectImage(data []byte) (string, bool) {
	kind := http.DetectContentType(data)
	switch kind {
	case "image/png", "image/jpeg", "image/webp":
		return kind, true
	default:
		return kind, false
	}
}

func sortUnique(values []string) []string {
	set := map[string]bool{}
	for _, v := range values {
		if v != "" {
			set[v] = true
		}
	}
	out := make([]string, 0, len(set))
	for v := range set {
		out = append(out, v)
	}
	sort.Strings(out)
	return out
}

func readAllLimit(r io.Reader, limit int64) ([]byte, error) {
	data, err := io.ReadAll(io.LimitReader(r, limit+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > limit {
		return nil, &ValidationError{Message: "файл превышает допустимый размер"}
	}
	return data, nil
}

func asConflict(err error) bool { var target *ConflictError; return errors.As(err, &target) }
