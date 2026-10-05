package domain

import "encoding/json"

type DirectoryRecord struct {
	ID          string `json:"id"`
	CompanyID   string `json:"companyId,omitempty"`
	Code        string `json:"code"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

type AppUser struct {
	Subject     string   `json:"subject"`
	Username    string   `json:"username"`
	DisplayName string   `json:"displayName"`
	Email       string   `json:"email,omitempty"`
	Role        string   `json:"role"`
	CompanyIDs  []string `json:"companyIds"`
	CJMIDs      []string `json:"cjmIds"`
	LastSeenAt  string   `json:"lastSeenAt"`
	CreatedAt   string   `json:"createdAt"`
	UpdatedAt   string   `json:"updatedAt"`
}

type UserAccess struct {
	CompanyIDs []string `json:"companyIds"`
	CJMIDs     []string `json:"cjmIds"`
}

type CJMSummary struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	CompanyID   string `json:"companyId"`
	CompanyName string `json:"companyName"`
	ActorID     string `json:"actorId"`
	ActorName   string `json:"actorName"`
	StageCount  int    `json:"stageCount"`
	StepCount   int    `json:"stepCount"`
	Revision    int    `json:"revision"`
	UpdatedAt   string `json:"updatedAt"`
}

type RichDoc = json.RawMessage

type ActionState struct {
	Participants []string `json:"participants"`
	Systems      []string `json:"systems"`
	Sequence     RichDoc  `json:"sequence"`
}

type Action struct {
	ID            string      `json:"id"`
	Position      int         `json:"position"`
	Name          string      `json:"name"`
	Description   string      `json:"description"`
	Goal          RichDoc     `json:"goal"`
	Meaning       RichDoc     `json:"meaning"`
	Pains         RichDoc     `json:"pains"`
	OpenQuestions string      `json:"openQuestions"`
	ASIS          ActionState `json:"asIs"`
	TOBE          ActionState `json:"toBe"`
}

type Step struct {
	ID          string   `json:"id"`
	Position    int      `json:"position"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
	Actions     []Action `json:"actions"`
}

type Stage struct {
	ID          string `json:"id"`
	Position    int    `json:"position"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Steps       []Step `json:"steps"`
}

type StepLink struct {
	ID       string `json:"id"`
	SourceID string `json:"sourceId"`
	TargetID string `json:"targetId"`
	Type     string `json:"type"`
}

type Initiative struct {
	ID          string `json:"id"`
	CompanyID   string `json:"companyId"`
	Type        string `json:"type"`
	Name        string `json:"name"`
	Description string `json:"description"`
}

type InitiativeLink struct {
	ID           string `json:"id"`
	InitiativeID string `json:"initiativeId"`
	StepID       string `json:"stepId"`
	ActionID     string `json:"actionId,omitempty"`
}

type ActionComment struct {
	ID        string `json:"id"`
	ActionID  string `json:"actionId"`
	Author    string `json:"author"`
	Body      string `json:"body"`
	CreatedAt string `json:"createdAt"`
	UpdatedAt string `json:"updatedAt"`
}

type CJMDocument struct {
	ID                   string           `json:"id"`
	Name                 string           `json:"name"`
	CompanyID            string           `json:"companyId"`
	ActorID              string           `json:"actorId"`
	CreatedAt            string           `json:"createdAt"`
	UpdatedAt            string           `json:"updatedAt"`
	CreatedBy            string           `json:"createdBy"`
	UpdatedBy            string           `json:"updatedBy"`
	RowVersion           int              `json:"rowVersion"`
	CurrentRevision      int              `json:"currentRevision"`
	Stages               []Stage          `json:"stages"`
	Links                []StepLink       `json:"links"`
	Initiatives          []Initiative     `json:"initiatives"`
	InitiativeLinks      []InitiativeLink `json:"initiativeLinks"`
	DeletedInitiativeIDs []string         `json:"deletedInitiativeIds,omitempty"`
}

type Bootstrap struct {
	Companies    []DirectoryRecord `json:"companies"`
	Actors       []DirectoryRecord `json:"actors"`
	Participants []DirectoryRecord `json:"participants"`
	Systems      []DirectoryRecord `json:"systems"`
	CJMs         []CJMSummary      `json:"cjms"`
}

type Revision struct {
	Number    int          `json:"number"`
	Comment   string       `json:"comment"`
	Kind      string       `json:"kind"`
	CreatedAt string       `json:"createdAt"`
	CreatedBy string       `json:"createdBy"`
	Snapshot  *CJMDocument `json:"snapshot,omitempty"`
}

type Asset struct {
	ID          string
	Name        string
	ContentType string
	Size        int64
	Data        []byte
}

type CJMReport struct {
	GeneratedAt string          `json:"generatedAt"`
	Document    *CJMDocument    `json:"document"`
	Directories Bootstrap       `json:"directories"`
	Comments    []ActionComment `json:"comments"`
	Revisions   []Revision      `json:"revisions"`
}
