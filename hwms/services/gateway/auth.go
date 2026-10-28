package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/url"

	"golang.org/x/oauth2"

	"github.com/kiiramotors/hwms/platform/auth"
	"github.com/kiiramotors/hwms/platform/httpx"
)

const (
	sessionCookie  = "hwms_session"
	stateCookie    = "hwms_state"
	verifierCookie = "hwms_verifier"
)

func (g *gateway) setCookie(w http.ResponseWriter, name, value string, maxAge int) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    value,
		Path:     "/",
		MaxAge:   maxAge,
		HttpOnly: true,
		Secure:   g.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

func (g *gateway) clearCookie(w http.ResponseWriter, name string) {
	http.SetCookie(w, &http.Cookie{
		Name:     name,
		Value:    "",
		Path:     "/",
		MaxAge:   -1,
		HttpOnly: true,
		Secure:   g.cookieSecure,
		SameSite: http.SameSiteLaxMode,
	})
}

// handleLogin starts the authorisation code flow with PKCE.
//
// SameSite is Lax rather than Strict on the state and verifier cookies because
// the browser returns from Keycloak by top-level navigation, and Strict would
// withhold them on that hop. The session cookie itself carries no
// cross-site risk of consequence here because every state-changing API call is
// same-origin through this gateway.
func (g *gateway) handleLogin(w http.ResponseWriter, r *http.Request) {
	state, err := newSessionID()
	if err != nil {
		httpx.Problem(w, http.StatusInternalServerError, "Sign-in could not be started. Try again.")
		return
	}
	verifier := oauth2.GenerateVerifier()

	g.setCookie(w, stateCookie, state, 600)
	g.setCookie(w, verifierCookie, verifier, 600)

	http.Redirect(w, r, g.oauth.AuthCodeURL(state, oauth2.S256ChallengeOption(verifier)), http.StatusFound)
}

// handleCallback exchanges the authorisation code and establishes the session.
func (g *gateway) handleCallback(w http.ResponseWriter, r *http.Request) {
	if errParam := r.URL.Query().Get("error"); errParam != "" {
		g.log.Warn("identity provider returned an error", slog.String("error", errParam))
		http.Redirect(w, r, g.appBaseURL+"/login?error=denied", http.StatusFound)
		return
	}

	stateFromCookie, err := r.Cookie(stateCookie)
	if err != nil || stateFromCookie.Value == "" || stateFromCookie.Value != r.URL.Query().Get("state") {
		http.Redirect(w, r, g.appBaseURL+"/login?error=state", http.StatusFound)
		return
	}
	verifier, err := r.Cookie(verifierCookie)
	if err != nil {
		http.Redirect(w, r, g.appBaseURL+"/login?error=state", http.StatusFound)
		return
	}
	g.clearCookie(w, stateCookie)
	g.clearCookie(w, verifierCookie)

	token, err := g.oauth.Exchange(r.Context(), r.URL.Query().Get("code"), oauth2.VerifierOption(verifier.Value))
	if err != nil {
		g.log.Warn("code exchange failed", slog.String("error", err.Error()))
		http.Redirect(w, r, g.appBaseURL+"/login?error=exchange", http.StatusFound)
		return
	}

	rawID, ok := token.Extra("id_token").(string)
	if !ok {
		http.Redirect(w, r, g.appBaseURL+"/login?error=no_id_token", http.StatusFound)
		return
	}
	idToken, err := g.verifier.Verify(r.Context(), rawID)
	if err != nil {
		g.log.Warn("identity token rejected", slog.String("error", err.Error()))
		http.Redirect(w, r, g.appBaseURL+"/login?error=invalid_token", http.StatusFound)
		return
	}

	var claims identityClaims
	if err := idToken.Claims(&claims); err != nil {
		http.Redirect(w, r, g.appBaseURL+"/login?error=invalid_token", http.StatusFound)
		return
	}

	// Roles come from the access token, not the identity token.
	//
	// Keycloak places realm roles in realm_access on the access token and, by
	// default, leaves them off the identity token entirely. Reading them from
	// the identity token yields an empty list, which signs a user in with no
	// role and no navigation, the failure this once produced in the field.
	//
	// Taking them from the access token also keeps the gateway's view of a
	// caller identical to what the services downstream enforce on, since that
	// is the token forwarded to them. Two sources for one answer would
	// eventually disagree.
	roles := g.rolesFromAccessToken(r.Context(), token.AccessToken)
	if len(roles) == 0 {
		// Belt and braces: a realm configured to publish roles on the identity
		// token instead should still work.
		idRoles := append([]string(nil), claims.RealmAccess.Roles...)
		for _, res := range claims.ResourceAccess {
			idRoles = append(idRoles, res.Roles...)
		}
		roles = filterHWMSRoles(idRoles)
	}

	subject := auth.Subject{
		ID:       claims.Subject,
		Username: claims.PreferredUsername,
		Name:     claims.Name,
		Email:    claims.Email,
		Roles:    roles,
	}

	if len(subject.Roles) == 0 {
		// Signing someone in with nothing to open is worse than refusing:
		// they get an empty application and no idea why. Say so, and name who
		// can fix it.
		g.log.Warn("sign-in with no role assigned",
			slog.String("username", subject.Username))
		http.Redirect(w, r, g.appBaseURL+"/login?error=no_role", http.StatusFound)
		return
	}

	id, err := g.sessions.put(&session{Subject: subject, Token: token, IDToken: rawID})
	if err != nil {
		httpx.Problem(w, http.StatusInternalServerError, "Sign-in could not be completed. Try again.")
		return
	}
	g.setCookie(w, sessionCookie, id, int(g.idleTimeout.Seconds()))

	// The username is recorded, never the token. See the rule in
	// platform/logging.
	g.log.Info("session established",
		slog.String("username", subject.Username),
		slog.Any("roles", subject.Roles),
	)

	http.Redirect(w, r, g.appBaseURL+"/", http.StatusFound)
}

// sessionResponse is what the application reads to decide what to render. It
// carries identity and roles, never a token.
type sessionResponse struct {
	Authenticated bool          `json:"authenticated"`
	User          *auth.Subject `json:"user,omitempty"`
	IdleTimeout   int           `json:"idleTimeoutSeconds,omitempty"`
}

func (g *gateway) handleSession(w http.ResponseWriter, r *http.Request) {
	sess, id, ok := g.currentSession(r)
	if !ok {
		httpx.JSON(w, http.StatusOK, sessionResponse{Authenticated: false})
		return
	}
	g.sessions.touch(id)
	subject := sess.Subject
	httpx.JSON(w, http.StatusOK, sessionResponse{
		Authenticated: true,
		User:          &subject,
		IdleTimeout:   int(g.idleTimeout.Seconds()),
	})
}

func (g *gateway) handleLogout(w http.ResponseWriter, r *http.Request) {
	if _, id, ok := g.currentSession(r); ok {
		g.sessions.delete(id)
	}
	g.clearCookie(w, sessionCookie)

	// Ending the local session is not enough: without ending the Keycloak
	// session, the next sign-in silently reuses it and the user appears to
	// have never signed out. On a shared Infirmary workstation that is the
	// difference between signing out and appearing to.
	var claims struct {
		EndSessionEndpoint string `json:"end_session_endpoint"`
	}
	if err := g.provider.Claims(&claims); err == nil && claims.EndSessionEndpoint != "" {
		endpoint, err := url.Parse(claims.EndSessionEndpoint)
		if err == nil {
			q := endpoint.Query()
			q.Set("post_logout_redirect_uri", g.appBaseURL+"/login")
			q.Set("client_id", g.oauth.ClientID)
			endpoint.RawQuery = q.Encode()
			httpx.JSON(w, http.StatusOK, map[string]string{"redirectTo": endpoint.String()})
			return
		}
	}
	httpx.JSON(w, http.StatusOK, map[string]string{"redirectTo": g.appBaseURL + "/login"})
}

func (g *gateway) currentSession(r *http.Request) (*session, string, bool) {
	c, err := r.Cookie(sessionCookie)
	if err != nil || c.Value == "" {
		return nil, "", false
	}
	sess, ok := g.sessions.get(c.Value)
	if !ok {
		return nil, "", false
	}
	return sess, c.Value, true
}

// accessToken returns a valid access token for the session, refreshing it when
// it has expired.
func (g *gateway) accessToken(r *http.Request, sess *session) (string, error) {
	source := g.oauth.TokenSource(r.Context(), sess.Token)
	token, err := source.Token()
	if err != nil {
		return "", err
	}
	if token.AccessToken != sess.Token.AccessToken {
		sess.Token = token
	}
	return token.AccessToken, nil
}

// identityClaims is the subset of a Keycloak token this gateway reads.
type identityClaims struct {
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

// rolesFromAccessToken verifies the access token and returns the roles this
// system recognises.
//
// The token is verified rather than merely decoded. It arrived over the back
// channel so its integrity is already assured by transport, but verifying the
// signature and issuer costs nothing and means this code path cannot become a
// place where an unverified token is trusted. The audience check is skipped
// deliberately: an access token's audience is the resource server, not this
// client.
func (g *gateway) rolesFromAccessToken(ctx context.Context, raw string) []string {
	if raw == "" || g.accessVerifier == nil {
		return nil
	}
	token, err := g.accessVerifier.Verify(ctx, raw)
	if err != nil {
		g.log.Warn("access token could not be verified for roles",
			slog.String("error", err.Error()))
		return nil
	}
	var claims identityClaims
	if err := token.Claims(&claims); err != nil {
		return nil
	}
	roles := append([]string(nil), claims.RealmAccess.Roles...)
	for _, res := range claims.ResourceAccess {
		roles = append(roles, res.Roles...)
	}
	return filterHWMSRoles(roles)
}

// filterHWMSRoles drops the realm's default roles so that the application sees
// only roles this system defines. Keycloak adds several of its own, and an
// application that treats every realm role as meaningful will eventually treat
// one of them as a permission.
func filterHWMSRoles(roles []string) []string {
	out := make([]string, 0, len(roles))
	for _, r := range roles {
		switch r {
		case auth.RoleOfficer, auth.RoleManager, auth.RoleDirector:
			out = append(out, r)
		}
	}
	return out
}
