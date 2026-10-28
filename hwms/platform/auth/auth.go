// Package auth verifies Keycloak-issued tokens and enforces role membership.
//
// Authorisation is checked twice, deliberately: once in HTTP middleware and
// again in the service layer, per NFR-SEC-04. The second check is not
// redundant. It protects code paths reached from an event consumer, a
// scheduled job or a future internal caller that never passes through a
// handler. Do not remove it as duplication.
package auth

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"

	"github.com/coreos/go-oidc/v3/oidc"

	"github.com/kiiramotors/hwms/platform/httpx"
)

// Roles as they are named in the Keycloak realm.
const (
	RoleOfficer  = "hwms-officer"  // Health and Wellness Officer. Sole clinical role.
	RoleManager  = "hwms-manager"  // Read-only operations, plus user administration.
	RoleDirector = "hwms-director" // Read-only executive summaries.
)

// ErrForbidden is returned by service-layer checks when the subject lacks the
// required role.
var ErrForbidden = errors.New("forbidden")

// Subject is the authenticated caller.
type Subject struct {
	ID       string   `json:"id"`
	Username string   `json:"username"`
	Name     string   `json:"name"`
	Email    string   `json:"email"`
	Roles    []string `json:"roles"`
}

// HasRole reports whether the subject holds role.
func (s Subject) HasRole(role string) bool {
	for _, r := range s.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type ctxKey string

const subjectKey ctxKey = "subject"

// HasAnyRole reports whether the subject holds at least one of the roles.
//
// The non-clinical services need this and the clinical one must never use it.
// A route reachable by "the officer or the manager" is an operational route;
// an individual clinical record is reachable by exactly one role, and stating
// that as a list of one would invite a second entry.
func (s Subject) HasAnyRole(roles ...string) bool {
	for _, role := range roles {
		if s.HasRole(role) {
			return true
		}
	}
	return false
}

// WithSubject returns a context carrying the authenticated caller.
func WithSubject(ctx context.Context, s Subject) context.Context {
	return context.WithValue(ctx, subjectKey, s)
}

// SubjectFrom returns the authenticated caller from the context.
func SubjectFrom(ctx context.Context) (Subject, bool) {
	s, ok := ctx.Value(subjectKey).(Subject)
	return s, ok
}

// RequireRoleCtx is the service-layer half of the double check. Call it inside
// the service method, not only in the handler.
func RequireRoleCtx(ctx context.Context, role string) error {
	s, ok := SubjectFrom(ctx)
	if !ok {
		return fmt.Errorf("%w: no authenticated subject", ErrForbidden)
	}
	if !s.HasRole(role) {
		return fmt.Errorf("%w: subject lacks %s", ErrForbidden, role)
	}
	return nil
}

// claims is the subset of the Keycloak token this system reads.
type claims struct {
	Subject           string `json:"sub"`
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

// Verifier validates bearer tokens against the realm's published keys.
type Verifier struct {
	verifier *oidc.IDTokenVerifier
	audience string
}

// NewVerifier discovers the realm and returns a token verifier.
//
// issuer is the value that appears in the token's iss claim, which is the
// address the browser reached Keycloak on. discoveryURL is where this service
// reaches Keycloak, which inside a container network is a different address
// entirely. Where they differ, discovery is performed against the internal
// address while validation still requires the external issuer, the token is
// checked against the issuer the browser actually used, which is the property
// that matters.
//
// Pass an empty discoveryURL when the two are the same.
func NewVerifier(ctx context.Context, issuer, discoveryURL, audience string) (*Verifier, error) {
	provider, err := discoverProvider(ctx, issuer, discoveryURL)
	if err != nil {
		return nil, err
	}
	return &Verifier{
		audience: audience,
		verifier: provider.Verifier(&oidc.Config{
			SkipClientIDCheck: true,
			SkipIssuerCheck:   false,
		}),
	}, nil
}

// DiscoverProvider resolves the identity provider, tolerating a split between
// the externally visible issuer and the internally reachable address.
func DiscoverProvider(ctx context.Context, issuer, discoveryURL string) (*oidc.Provider, error) {
	return discoverProvider(ctx, issuer, discoveryURL)
}

func discoverProvider(ctx context.Context, issuer, discoveryURL string) (*oidc.Provider, error) {
	if discoveryURL == "" || discoveryURL == issuer {
		provider, err := oidc.NewProvider(ctx, issuer)
		if err != nil {
			return nil, fmt.Errorf("discover issuer %s: %w", issuer, err)
		}
		return provider, nil
	}
	provider, err := oidc.NewProvider(oidc.InsecureIssuerURLContext(ctx, issuer), discoveryURL)
	if err != nil {
		return nil, fmt.Errorf("discover %s for issuer %s: %w", discoveryURL, issuer, err)
	}
	return provider, nil
}

// Verify validates a raw access token and returns the subject it describes.
func (v *Verifier) Verify(ctx context.Context, raw string) (Subject, error) {
	tok, err := v.verifier.Verify(ctx, raw)
	if err != nil {
		return Subject{}, err
	}
	if v.audience != "" {
		matched := false
		for _, a := range tok.Audience {
			if a == v.audience || a == "account" || a == "hwms-api" || a == "hwms-gateway" {
				matched = true
				break
			}
		}
		if !matched {
			return Subject{}, fmt.Errorf("oidc: expected audience %q, got %v", v.audience, tok.Audience)
		}
	}
	var c claims
	if err := tok.Claims(&c); err != nil {
		return Subject{}, err
	}
	roles := append([]string(nil), c.RealmAccess.Roles...)
	for _, res := range c.ResourceAccess {
		roles = append(roles, res.Roles...)
	}
	return Subject{
		ID:       c.Subject,
		Username: c.PreferredUsername,
		Name:     c.Name,
		Email:    c.Email,
		Roles:    roles,
	}, nil
}

// Authenticate is middleware that requires a valid bearer token and places the
// subject on the request context.
func (v *Verifier) Authenticate(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		header := r.Header.Get("Authorization")
		if !strings.HasPrefix(header, "Bearer ") {
			httpx.Problem(w, http.StatusUnauthorized, "Sign in to continue.")
			return
		}
		subject, err := v.Verify(r.Context(), strings.TrimPrefix(header, "Bearer "))
		if err != nil {
			httpx.Problem(w, http.StatusUnauthorized, "The session has expired. Sign in again.")
			return
		}
		next.ServeHTTP(w, r.WithContext(WithSubject(r.Context(), subject)))
	})
}

// RequireAnyRoleCtx is the service-layer half of the double check for a route
// open to more than one role.
func RequireAnyRoleCtx(ctx context.Context, roles ...string) error {
	s, ok := SubjectFrom(ctx)
	if !ok {
		return fmt.Errorf("%w: no authenticated subject", ErrForbidden)
	}
	if !s.HasAnyRole(roles...) {
		return fmt.Errorf("%w: subject lacks any of %v", ErrForbidden, roles)
	}
	return nil
}

// RequireRole is the handler-layer half of the double check.
func RequireRole(role string) func(http.Handler) http.Handler {
	return RequireRoleWithMessage(role,
		"This account does not have access to that function. Ask the manager if you believe it should.")
}

// RequireRoleWithMessage is RequireRole with a refusal the caller supplies.
//
// It exists so that a refusal can name the rule being enforced rather than
// stating only that access was denied. On a clinical route the useful message
// is which role may retrieve the record, because the answer is deliberate and
// permanent rather than an oversight someone can have corrected.
func RequireRoleWithMessage(role, detail string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s, ok := SubjectFrom(r.Context())
			if !ok {
				httpx.Problem(w, http.StatusUnauthorized, "Sign in to continue.")
				return
			}
			if !s.HasRole(role) {
				httpx.Problem(w, http.StatusForbidden, detail)
				return
			}
			next.ServeHTTP(w, r)
		})
	}
}

// RequireAnyRole permits a caller holding at least one of the given roles.
//
// Used by the operational services, where the officer records and the manager
// reads. Read and write are separated by the route, not by this middleware:
// a manager reaching a write route is refused by the handler that owns it.
func RequireAnyRole(roles ...string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			s, ok := SubjectFrom(r.Context())
			if !ok {
				httpx.Problem(w, http.StatusUnauthorized, "Sign in to continue.")
				return
			}
			if !s.HasAnyRole(roles...) {
				httpx.Problem(w, http.StatusForbidden,
					"This account does not have access to that function. Ask the manager if you believe it should.")
				return
			}
			next.ServeHTTP(w, r.WithContext(r.Context()))
		})
	}
}
