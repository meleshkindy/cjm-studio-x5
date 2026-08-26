package api

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"cjmstudio/internal/domain"
	"cjmstudio/internal/store"
	"github.com/coreos/go-oidc/v3/oidc"
)

const sessionCookieName = "cjm_session"

type AuthConfig struct {
	Enabled            bool   `json:"enabled"`
	URL                string `json:"url,omitempty"`
	Realm              string `json:"realm,omitempty"`
	ClientID           string `json:"clientId,omitempty"`
	RestorePasswordURL string `json:"restorePasswordUrl,omitempty"`
}

type principal struct {
	Subject     string
	Username    string
	DisplayName string
	Email       string
	Role        string
	ExpiresAt   time.Time
}

func (p principal) identity() store.UserIdentity {
	return store.UserIdentity{Subject: p.Subject, Username: p.Username, DisplayName: p.DisplayName, Email: p.Email, Role: p.Role}
}

type principalContextKey struct{}

func withPrincipal(ctx context.Context, value principal) context.Context {
	return context.WithValue(ctx, principalContextKey{}, value)
}

func principalFromContext(ctx context.Context) principal {
	value, _ := ctx.Value(principalContextKey{}).(principal)
	return value
}

type authenticator struct {
	config   AuthConfig
	issuer   string
	verifier *oidc.IDTokenVerifier
}

func newAuthenticator(config AuthConfig) (*authenticator, error) {
	config.URL = strings.TrimRight(strings.TrimSpace(config.URL), "/")
	config.Realm = strings.TrimSpace(config.Realm)
	config.ClientID = strings.TrimSpace(config.ClientID)
	config.RestorePasswordURL = strings.TrimSpace(config.RestorePasswordURL)
	if !config.Enabled {
		return &authenticator{config: config}, nil
	}
	if config.URL == "" || config.Realm == "" || config.ClientID == "" {
		return nil, fmt.Errorf("Keycloak URL, realm и client ID обязательны при включённой авторизации")
	}
	parsed, err := url.Parse(config.URL)
	if err != nil || parsed.Scheme != "https" || parsed.Host == "" {
		return nil, fmt.Errorf("Keycloak URL должен быть корректным HTTPS-адресом")
	}
	if config.RestorePasswordURL != "" {
		restore, err := url.Parse(config.RestorePasswordURL)
		if err != nil || restore.Scheme != "https" || restore.Host == "" {
			return nil, fmt.Errorf("адрес восстановления пароля должен быть корректным HTTPS-адресом")
		}
	}
	issuer := config.URL + "/realms/" + url.PathEscape(config.Realm)
	keyContext := oidc.ClientContext(context.Background(), &http.Client{Timeout: 10 * time.Second})
	keys := oidc.NewRemoteKeySet(keyContext, issuer+"/protocol/openid-connect/certs")
	verifier := oidc.NewVerifier(issuer, keys, &oidc.Config{SkipClientIDCheck: true})
	return &authenticator{config: config, issuer: issuer, verifier: verifier}, nil
}

type keycloakClaims struct {
	AuthorizedParty   string `json:"azp"`
	PreferredUsername string `json:"preferred_username"`
	Name              string `json:"name"`
	Email             string `json:"email"`
	RealmAccess       struct {
		Roles []string `json:"roles"`
	} `json:"realm_access"`
	ResourceAccess map[string]struct {
		Roles []string `json:"roles"`
	} `json:"resource_access"`
}

func (a *authenticator) verifyBearer(ctx context.Context, header string) (principal, error) {
	if !a.config.Enabled || a.verifier == nil {
		return principal{}, errors.New("авторизация отключена")
	}
	parts := strings.Fields(header)
	if len(parts) != 2 || !strings.EqualFold(parts[0], "Bearer") || parts[1] == "" {
		return principal{}, errors.New("токен доступа не передан")
	}
	verified, err := a.verifier.Verify(ctx, parts[1])
	if err != nil {
		return principal{}, fmt.Errorf("токен доступа недействителен: %w", err)
	}
	clientMatch := false
	for _, audience := range verified.Audience {
		if audience == a.config.ClientID {
			clientMatch = true
			break
		}
	}
	var claims keycloakClaims
	if err := verified.Claims(&claims); err != nil {
		return principal{}, fmt.Errorf("не удалось прочитать токен: %w", err)
	}
	if !clientMatch && claims.AuthorizedParty != a.config.ClientID {
		return principal{}, errors.New("токен выдан для другого приложения")
	}
	roles := append([]string{}, claims.RealmAccess.Roles...)
	if resource, ok := claims.ResourceAccess[a.config.ClientID]; ok {
		roles = append(roles, resource.Roles...)
	}
	role := effectiveRole(roles)
	displayName := strings.TrimSpace(claims.Name)
	if displayName == "" {
		displayName = strings.TrimSpace(claims.PreferredUsername)
	}
	if displayName == "" {
		displayName = "Пользователь"
	}
	return principal{
		Subject: verified.Subject, Username: claims.PreferredUsername, DisplayName: displayName,
		Email: claims.Email, Role: role, ExpiresAt: verified.Expiry,
	}, nil
}

func effectiveRole(roles []string) string {
	best := "viewer"
	for _, role := range roles {
		switch strings.ToLower(strings.TrimSpace(role)) {
		case "admin":
			return "admin"
		case "editor":
			best = "editor"
		case "viewer":
			if best == "" {
				best = "viewer"
			}
		}
	}
	return best
}

func randomSessionToken() (string, error) {
	data := make([]byte, 32)
	if _, err := rand.Read(data); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(data), nil
}

func hashSessionToken(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}

func secureRequest(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	return strings.EqualFold(strings.TrimSpace(strings.Split(r.Header.Get("X-Forwarded-Proto"), ",")[0]), "https")
}

func setSessionCookie(w http.ResponseWriter, r *http.Request, token string, expiresAt time.Time) {
	maxAge := int(time.Until(expiresAt).Seconds())
	if maxAge < 1 {
		maxAge = 1
	}
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: token, Path: "/", Expires: expiresAt, MaxAge: maxAge, HttpOnly: true, Secure: secureRequest(r), SameSite: http.SameSiteStrictMode})
}

func clearSessionCookie(w http.ResponseWriter, r *http.Request) {
	http.SetCookie(w, &http.Cookie{Name: sessionCookieName, Value: "", Path: "/", MaxAge: -1, HttpOnly: true, Secure: secureRequest(r), SameSite: http.SameSiteStrictMode})
}

func appUserPrincipal(user domain.AppUser) principal {
	return principal{Subject: user.Subject, Username: user.Username, DisplayName: user.DisplayName, Email: user.Email, Role: user.Role}
}
