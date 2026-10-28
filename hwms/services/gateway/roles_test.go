package main

import (
	"encoding/json"
	"testing"

	"github.com/kiiramotors/hwms/platform/auth"
)

// These exist because of a real failure.
//
// The gateway originally read roles from the identity token. Keycloak places
// realm roles on the *access* token and, by default, leaves them off the
// identity token entirely, so a correctly provisioned manager signed in with
// an empty role list, an empty navigation, and no explanation.
//
// The access-control suite in services/clinical did not catch it: those tests
// inject a subject directly and never exercise claim extraction. Nothing
// between the token and the session was tested at all. This file tests that
// gap.

// decodeClaims mirrors what the gateway does with a verified token's payload.
func decodeClaims(t *testing.T, payload string) []string {
	t.Helper()
	var claims identityClaims
	if err := json.Unmarshal([]byte(payload), &claims); err != nil {
		t.Fatalf("claims did not decode: %v", err)
	}
	roles := append([]string(nil), claims.RealmAccess.Roles...)
	for _, res := range claims.ResourceAccess {
		roles = append(roles, res.Roles...)
	}
	return filterHWMSRoles(roles)
}

// A Keycloak access token carries realm_access.roles.
const accessTokenPayload = `{
  "sub": "a5b63b19-5de9-4f50-8be5-dd6311179d85",
  "preferred_username": "manager@kiiramotors.com",
  "realm_access": {
    "roles": ["default-roles-hwms", "offline_access", "uma_authorization", "hwms-manager"]
  }
}`

// A Keycloak identity token, by default, does not.
const identityTokenPayload = `{
  "sub": "a5b63b19-5de9-4f50-8be5-dd6311179d85",
  "preferred_username": "manager@kiiramotors.com",
  "email": "manager@kiiramotors.com"
}`

func TestRolesAreReadFromTheAccessTokenShape(t *testing.T) {
	roles := decodeClaims(t, accessTokenPayload)
	if len(roles) != 1 || roles[0] != auth.RoleManager {
		t.Fatalf("expected exactly [%s], got %v", auth.RoleManager, roles)
	}
}

func TestRolesAreReadFromResourceAccessClientRoles(t *testing.T) {
	clientRolePayload := `{
	  "sub": "a5b63b19-5de9-4f50-8be5-dd6311179d85",
	  "preferred_username": "officer@kiiramotors.com",
	  "realm_access": {
	    "roles": ["default-roles-test", "offline_access"]
	  },
	  "resource_access": {
	    "hwms-gateway": {
	      "roles": ["hwms-officer"]
	    }
	  }
	}`
	roles := decodeClaims(t, clientRolePayload)
	if len(roles) != 1 || roles[0] != auth.RoleOfficer {
		t.Fatalf("expected exactly [%s], got %v", auth.RoleOfficer, roles)
	}
}

// This is the bug, expressed as a test. The identity token yields nothing,
// which is why the gateway must not depend on it alone.
func TestIdentityTokenShapeYieldsNoRoles(t *testing.T) {
	if roles := decodeClaims(t, identityTokenPayload); len(roles) != 0 {
		t.Fatalf("the identity token carries no realm roles; got %v", roles)
	}
}

func TestRealmDefaultRolesAreNotTreatedAsPermissions(t *testing.T) {
	// Keycloak adds several roles of its own. An application that treated
	// every realm role as meaningful would eventually treat one of them as a
	// permission.
	noise := []string{"default-roles-hwms", "offline_access", "uma_authorization", "admin"}
	if roles := filterHWMSRoles(noise); len(roles) != 0 {
		t.Fatalf("no realm default role is a permission in this system; got %v", roles)
	}
}

func TestEveryRoleThisSystemDefinesIsRecognised(t *testing.T) {
	for _, role := range []string{auth.RoleOfficer, auth.RoleManager, auth.RoleDirector} {
		got := filterHWMSRoles([]string{"offline_access", role})
		if len(got) != 1 || got[0] != role {
			t.Errorf("%s must survive filtering; got %v", role, got)
		}
	}
}

func TestFilteringNeverReturnsNil(t *testing.T) {
	// The session response marshals this straight to JSON. A nil slice would
	// serialise as null rather than [], and the application reads .length on
	// it.
	if roles := filterHWMSRoles(nil); roles == nil {
		t.Fatal("expected an empty slice, not nil")
	}
}
