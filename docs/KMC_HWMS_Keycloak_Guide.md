# Keycloak for HWMS: a practical guide

**Audience:** developers on the KMC Health and Wellness Management System (HWMS).
**Goal:** understand what Keycloak is and why it matters, how HWMS uses it today, and
exactly how to connect HWMS to the company Keycloak at `https://auth.kiiramotors.com`
(realm `test`), with the good practices that keep it safe.

> This guide is written against the code in this repository (gateway, services, realm
> export) and against the live discovery document of the company `test` realm, read on
> 26 October 2026. Keycloak's admin console labels change slightly between versions. If
> a button is named a little differently on the company server, look for the nearest
> match. The concepts don't change.

---

## Contents

0. [Quick reference](#0-quick-reference)
1. [Your account comes first](#1-your-account-comes-first)
2. [What Keycloak is](#2-what-keycloak-is)
3. [Why it matters for HWMS](#3-why-it-matters-for-hwms)
4. [Core concepts and vocabulary](#4-core-concepts-and-vocabulary)
5. [The protocols: OAuth 2.0 and OpenID Connect](#5-the-protocols-oauth-20-and-openid-connect)
6. [How HWMS uses Keycloak today](#6-how-hwms-uses-keycloak-today)
7. [How it is going to be: the company Keycloak](#7-how-it-is-going-to-be-the-company-keycloak)
8. [Step by step: connect HWMS to the `test` realm](#8-step-by-step-connect-hwms-to-the-test-realm)
9. [Troubleshooting](#9-troubleshooting)
10. [Good practices](#10-good-practices)
11. [From test to production](#11-from-test-to-production)
12. [Glossary](#12-glossary)
13. [Further reading](#13-further-reading)

---

## 0. Quick reference

| What | Value |
|---|---|
| Keycloak server | `https://auth.kiiramotors.com` |
| Admin console | `https://auth.kiiramotors.com/admin/` |
| Realm you work in | `test` |
| Issuer (`iss` in every token) | `https://auth.kiiramotors.com/realms/test` |
| Discovery document | `https://auth.kiiramotors.com/realms/test/.well-known/openid-configuration` |
| Authorization endpoint | `https://auth.kiiramotors.com/realms/test/protocol/openid-connect/auth` |
| Token endpoint | `https://auth.kiiramotors.com/realms/test/protocol/openid-connect/token` |
| Logout (end session) endpoint | `https://auth.kiiramotors.com/realms/test/protocol/openid-connect/logout` |
| Signing keys (JWKS) | `https://auth.kiiramotors.com/realms/test/protocol/openid-connect/certs` |
| HWMS locally | `http://localhost:8090` |
| HWMS sign-in callback | `http://localhost:8090/auth/callback` |
| HWMS page after sign-out | `http://localhost:8090/login` |

Verified on the day this was written: the realm answers over HTTPS, supports PKCE with
`S256`, and is reachable from inside the HWMS Docker network as well as from the host.

---

## 1. Your account comes first

You were given an administrator account with a **temporary** password.

1. Open `https://auth.kiiramotors.com/admin/`.
2. Sign in with your email address and the temporary password from the onboarding message.
3. Keycloak forces you to choose a new password. Make it long (a passphrase of four or
   more random words is good), and don't use it anywhere else.
4. In the left navigation, open **Manage realms** and select **`test`**. Everything in
   this guide happens inside `test`, not `master`.

Why the realm switch? Your administrator account almost certainly lives in the `master`
realm, the realm that administers the others. The `test` realm is the sandbox where
applications like HWMS are registered and tried out. Never create application clients,
roles or users in `master`.

**Protect this account.** It can change the sign-in behaviour of every application in the
`test` realm.

- Change the temporary password straight away. Until you do, anyone who saw the onboarding
  message can use it.
- If two-factor authentication is offered, turn it on: open your account console
  (`https://auth.kiiramotors.com/realms/master/account/`, then **Account security → Signing
  in**) and add an authenticator app.
- Never put a password or a client secret in code, a commit, a screenshot, a ticket or a
  chat message. If one leaks, change or regenerate it. Don't just delete the message.

---

## 2. What Keycloak is

Keycloak is an open-source **Identity and Access Management (IAM)** server. It is a
Cloud Native Computing Foundation project, and Red Hat ships a supported build of it.
It answers two questions on behalf of your applications:

- **Authentication:** *who is this person?* Keycloak shows the sign-in page, checks the
  password (and second factor, if configured), and remembers the sign-in as a session.
- **Authorisation data:** *what are they allowed to be?* Keycloak stores roles and groups
  and puts them into signed **tokens** that your application trusts.

Your application **never sees a password**. It redirects the user to Keycloak, and gets
back proof of who signed in, as a cryptographically signed token.

An analogy: Keycloak is the company's front desk. It checks your ID once and gives you a
badge (the token). Each department's door (each application or API) checks the badge
rather than checking your ID again. The badge says who you are and which doors are yours,
and it expires.

What Keycloak gives you without writing any security code:

| Capability | What it means in practice |
|---|---|
| Single sign-on (SSO) | Sign in once, use every company app registered in the realm |
| Standard protocols | OpenID Connect, OAuth 2.0 and SAML, so any language or framework can integrate |
| Password policies and brute-force protection | Length and complexity rules, lockout after repeated failures |
| Multi-factor authentication | One-time-password apps, WebAuthn and passkeys |
| User federation | Read users from Active Directory or LDAP instead of creating them again |
| Identity brokering | "Sign in with Microsoft" and similar, if the company wants it |
| Roles and groups | Central place to say who may do what |
| Sessions and sign-out | See and end sessions, sign out of all apps |
| Events and audit | Log of sign-ins, failures and admin changes |
| Admin REST API | Automate user and role administration (HWMS's identity service uses this) |

---

## 3. Why it matters for HWMS

HWMS holds **clinical records** (patients, visits, laboratory results, referrals) and
**operational records** used for management reporting. Getting identity wrong here has
legal consequences, not just technical ones.

1. **One trusted place for identity.** When someone joins, moves or leaves KMC, their
   access changes in one place (the company Keycloak), not in every system separately. A
   leaver disabled in Keycloak can no longer sign in to HWMS.
2. **No passwords inside HWMS.** HWMS never stores or even receives passwords, so a
   breach of HWMS cannot leak them.
3. **Stronger sign-in for free.** Password policy, lockout and MFA are configured once by
   IT and apply to HWMS automatically.
4. **Role-based access that HWMS enforces.** The officer, manager and director roles come
   from Keycloak in the token. HWMS checks them twice, in the HTTP middleware and again in
   the service layer (NFR-SEC-04), and only `hwms-officer` reaches a clinical record.
5. **Audit.** Keycloak records who signed in and when. HWMS records what they did. The
   two together answer "who saw this record", which is a requirement, not a nice-to-have.
6. **Company standard.** IT runs one identity platform for every KMC system. HWMS joining
   it means one less island of accounts to maintain, secure and audit.

---

## 4. Core concepts and vocabulary

| Concept | What it is | In HWMS terms |
|---|---|---|
| **Realm** | An isolated space with its own users, roles, clients, settings and signing keys. Tokens from one realm mean nothing in another. | Local: `hwms`. Company: `test` now, a production realm later. |
| **Client** | An application registered with the realm, allowed to request sign-ins or tokens. | `hwms-gateway` (sign-in for users), `hwms-identity` (account administration). |
| **Confidential client** | A client that runs on a server and can keep a secret. Authenticates to Keycloak with a client secret. | Both HWMS clients are confidential. |
| **Public client** | A client that cannot keep a secret (single-page app in the browser, mobile app). Must use PKCE. | Not used. HWMS deliberately keeps tokens off the browser. |
| **User** | A person (or a service account) who can sign in. | Officers, managers, directors. |
| **Group** | A set of users. Roles assigned to a group are inherited by its members. | Recommended: "HWMS Officers", "HWMS Managers", "HWMS Directors". |
| **Realm role** | A role defined for the whole realm. Appears in `realm_access.roles` in the access token. | `hwms-officer`, `hwms-manager`, `hwms-director` (today). |
| **Client role** | A role that belongs to one client. Appears in `resource_access.<client-id>.roles`. | The cleaner choice in a shared company realm (see section 7). |
| **Composite role** | A role that includes other roles. | `default-roles-<realm>` is one: every user gets it. |
| **Client scope** | A reusable bundle of claims and mappers a client can request (`profile`, `email`, `roles`). | HWMS needs `roles` as a default scope so roles reach the token. |
| **Protocol mapper** | A rule that puts a value into a token (an attribute, a role list, an audience). | An **Audience** mapper is recommended in section 8. |
| **Session** | Keycloak's memory that a user is signed in (SSO session), plus per-client sessions. | Ends on sign-out, idle timeout or maximum lifespan. |
| **Required action** | Something a user must do at next sign-in: update password, verify email, set up OTP. | "Update password" is why your temporary password forced a change. |
| **Service account** | A non-human user attached to a client, used with the client-credentials flow. | `service-account-hwms-identity`. |
| **User federation** | Reading users from LDAP or Active Directory instead of storing them in Keycloak. | Ask IT whether the company realm federates staff accounts. |
| **Identity provider** | Delegating sign-in to another system (Microsoft, Google, another Keycloak). | Not used by HWMS directly. |

Two rules worth memorising:

- **A role is not a permission.** A role is a label in a token. The *permission* is the
  code in HWMS that checks the label (`auth.RequireRole(...)`). Keycloak says who someone
  is and what labels they carry; HWMS decides what each label allows.
- **The realm is the trust boundary.** HWMS trusts exactly one realm (one issuer). A token
  from any other realm, even on the same server, is rejected.

---

## 5. The protocols: OAuth 2.0 and OpenID Connect

### 5.1 Two protocols, two jobs

- **OAuth 2.0** is about **access**: a client obtains an *access token* it can present to
  an API.
- **OpenID Connect (OIDC)** is a thin layer on top of OAuth 2.0 about **identity**: it
  adds the *ID token*, a signed statement of who signed in, plus a standard discovery
  document and a userinfo endpoint.

HWMS uses both. OIDC signs the user in at the gateway, and the OAuth 2.0 access token is
what the gateway sends to the Go services.

### 5.2 Discovery

Every realm publishes a JSON document listing its endpoints and capabilities:

```bash
curl -s https://auth.kiiramotors.com/realms/test/.well-known/openid-configuration | jq '{issuer, authorization_endpoint, token_endpoint, end_session_endpoint, jwks_uri, code_challenge_methods_supported}'
```

HWMS only needs the **issuer**. The Go library (`coreos/go-oidc`) fetches this document
at start-up and finds everything else from it. This is why `OIDC_ISSUER` is the only
Keycloak address most services need.

### 5.3 The three tokens

| Token | Purpose | Who reads it | Typical lifetime | In HWMS |
|---|---|---|---|---|
| **ID token** (JWT) | Proves who signed in, for the client that asked | The client only | Short (minutes) | Gateway verifies it at sign-in, reads `sub`, name, email |
| **Access token** (JWT in Keycloak) | Lets the client call APIs on the user's behalf | Resource servers (APIs) | Short: realm default 5 minutes | Gateway forwards it as `Authorization: Bearer ...` to every service |
| **Refresh token** | Gets new access tokens without asking the user to sign in again | Keycloak only | Bound to the SSO session (idle and maximum lifespan) | Kept server-side in the gateway session; used when the access token expires |

### 5.4 What is inside a token (JWT)

A JWT is three base64url parts separated by dots: `header.payload.signature`. The payload
of a Keycloak access token for an HWMS manager looks like this (illustrative values):

```json
{
  "exp": 1793000300,
  "iat": 1793000000,
  "iss": "https://auth.kiiramotors.com/realms/test",
  "aud": ["hwms-api", "account"],
  "sub": "3f1c8a2e-6b0d-4f57-9a51-1c0d2e7b9a10",
  "typ": "Bearer",
  "azp": "hwms-gateway",
  "sid": "c8f5c2a1-...",
  "realm_access": { "roles": ["hwms-manager", "offline_access", "uma_authorization", "default-roles-test"] },
  "resource_access": { "account": { "roles": ["manage-account", "view-profile"] } },
  "scope": "openid profile email",
  "preferred_username": "grace.namutebi",
  "name": "Grace Namutebi",
  "email": "grace.namutebi@kiiramotors.com"
}
```

| Claim | Meaning | Why HWMS cares |
|---|---|---|
| `iss` | Issuer: the realm that signed it | Must equal `OIDC_ISSUER` exactly, character for character |
| `aud` | Audience: who the token is meant for | Services require `OIDC_AUDIENCE` to be in this list |
| `exp`, `iat` | Expiry and issue time (Unix seconds) | Expired tokens are rejected; server clocks must be correct |
| `sub` | Subject: the user's permanent ID **within this realm** | The stable identifier. Emails and usernames can change; `sub` doesn't |
| `azp` | Authorised party: the client that obtained the token | Tells you which app the token came from |
| `realm_access.roles` | Realm roles | HWMS reads roles from here today |
| `resource_access.<client>.roles` | Client roles | Where roles live if you use client roles |

Keycloak adds its own default roles (`offline_access`, `uma_authorization`,
`default-roles-<realm>`). HWMS ignores them on purpose: `filterHWMSRoles` in
`services/gateway/auth.go` keeps only the three HWMS roles, so a Keycloak default can
never be mistaken for a permission.

### 5.5 How a token is trusted

The signature is made with a private key only Keycloak holds. Anyone can verify it with
the public keys published at the JWKS URL. Verification means checking **all** of:

1. the signature, against the realm's published keys;
2. `iss` equals the expected issuer;
3. `aud` contains the expected audience;
4. `exp` is in the future (and `nbf`, if present, is in the past).

`go-oidc` does all four in `Verifier.Verify` (`platform/auth/auth.go`). It also refreshes
the keys automatically when Keycloak rotates them, so never copy a public key into
configuration.

> **Never decode a token and trust it without verifying it.** Decoding is not verifying;
> anyone can write a JSON payload and base64-encode it.

### 5.6 The flows (grant types)

| Flow | Use it for | HWMS |
|---|---|---|
| **Authorization Code + PKCE** | Signing users in to any app | **Used** by the gateway |
| **Client Credentials** | A service acting as itself, no user involved | **Used** by the identity service |
| **Refresh Token** | Renewing an access token | **Used** by the gateway |
| Implicit | Legacy browser flow that put tokens in the URL | **Never.** Deprecated by OAuth security best practice |
| Resource Owner Password (Keycloak calls it "Direct access grants") | App collects the password and posts it to Keycloak | **Never.** The app sees the password, and MFA and SSO break |
| Device Authorization | TVs and command-line tools without a browser | Not needed |

**PKCE** (Proof Key for Code Exchange, "pixie"): before redirecting, the client invents a
random secret (the *verifier*) and sends only its SHA-256 hash (the *challenge*). When it
exchanges the code for tokens it must present the original verifier. A stolen
authorisation code is useless without it. HWMS uses `S256`, the only method you should
allow. Never allow `plain`.

---

## 6. How HWMS uses Keycloak today

### 6.1 The architecture: a backend-for-frontend (BFF)

```
                 ┌────────────────────────────────────────────────────────────┐
                 │                       Keycloak                             │
                 │  local: http://keycloak:8180/realms/hwms                   │
                 │  company: https://auth.kiiramotors.com/realms/test         │
                 └──────▲───────────────────────▲────────────────────▲────────┘
       sign-in page     │ code ↔ tokens         │ JWKS (public keys)  │ admin API
       (browser)        │ (back channel)        │                     │ (client credentials)
┌──────────┐      ┌─────┴──────┐  Bearer token  ┌┴──────────────────┐ ┌┴─────────────┐
│ Browser  │◀────▶│  web +     │───────────────▶│ clinical, admin,  │ │  identity    │
│ (React)  │cookie│  gateway   │                │ occupational,     │ │  service     │
│ no token │      │  (BFF)     │───────────────▶│ metrics           │ │ (accounts)   │
└──────────┘      └────────────┘                └───────────────────┘ └──────────────┘
```

The **browser never holds a token**. The gateway (`services/gateway`) does the OIDC dance,
keeps the tokens in a server-side session, and gives the browser only an opaque,
`HttpOnly` session cookie (`hwms_session`). JavaScript cannot read that cookie, so a
cross-site scripting bug cannot steal a token. This is the pattern the IETF recommends for
browser-based applications that handle sensitive data.

### 6.2 What happens when someone signs in

```
 Browser                      Gateway                          Keycloak
    │  GET /auth/login           │                                 │
    │───────────────────────────▶│ create state + PKCE verifier    │
    │                            │ (short-lived HttpOnly cookies)  │
    │  302 → authorization endpoint?client_id=hwms-gateway         │
    │       &code_challenge=…&code_challenge_method=S256&state=…   │
    │◀───────────────────────────│                                 │
    │  sign-in page, user types password (and OTP)                 │
    │─────────────────────────────────────────────────────────────▶│
    │  302 → /auth/callback?code=…&state=…                         │
    │◀─────────────────────────────────────────────────────────────│
    │  GET /auth/callback        │                                 │
    │───────────────────────────▶│ check state matches the cookie  │
    │                            │ POST token endpoint:            │
    │                            │ code + verifier + client secret │
    │                            │────────────────────────────────▶│
    │                            │ ID, access and refresh tokens   │
    │                            │◀────────────────────────────────│
    │                            │ verify ID token, read roles     │
    │                            │ from the access token, refuse   │
    │                            │ if no HWMS role, store session  │
    │  302 → /  + hwms_session cookie                              │
    │◀───────────────────────────│                                 │
```

Code: `handleLogin` and `handleCallback` in `services/gateway/auth.go`.

### 6.3 What happens on every API call

1. The browser calls `/api/...` with the session cookie (same origin, through nginx).
2. The gateway finds the session, refreshes the access token if it has expired, and
   forwards the request with `Authorization: Bearer <access token>`. It strips the cookie
   (`services/gateway/proxy.go`).
3. The service verifies the token (`platform/auth`: signature, `iss`, `aud`, expiry), puts
   the subject on the request context, and checks the role in middleware **and** again in
   the service method.

### 6.4 Sign-out

`handleLogout` deletes the gateway session, then sends the browser to Keycloak's end-session
endpoint with `client_id` and `post_logout_redirect_uri=<app>/login`, so the Keycloak SSO
session ends too. Without that second step, the next "sign in" would silently reuse the
Keycloak session. On a shared Infirmary workstation, that is the difference between
signing out and only appearing to.

### 6.5 The identity service

The manager's **Accounts** screen creates officer and director accounts. The identity
service does this by calling Keycloak's Admin REST API
(`/admin/realms/<realm>/users`, role mappings) with its **own** service account
(`hwms-identity`, client-credentials flow), never with the manager's token. That service
account holds the `realm-management` roles `manage-users`, `view-users`, `query-users`
and `view-realm` (`deploy/keycloak/realm-hwms.json`).

### 6.6 Where things are configured

| File | What it holds |
|---|---|
| `hwms/deploy/keycloak/realm-hwms.json` | The local realm: roles, both clients, redirect URIs, password policy, lockout, session timeouts |
| `hwms/docker-compose.yml` | Keycloak container, and every service's OIDC environment |
| `hwms/.env` (from `.env.example`, git-ignored) | `OIDC_ISSUER`, client secrets, `APP_BASE_URL` |
| `hwms/services/gateway/main.go` | Reads `OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`, `OIDC_REDIRECT_URL`, `COOKIE_SECURE`, `SESSION_IDLE_TIMEOUT` |
| `hwms/services/gateway/auth.go` | Sign-in, callback, session, sign-out, role extraction |
| `hwms/platform/auth/auth.go` | Token verification and role checks used by every service |
| `hwms/services/identity/keycloak.go` | Admin REST API client |
| `hwms/deploy/k8s/00-namespace-and-config.yaml` | Production-style settings (issuer, audience, secrets) |

| Variable | Used by | Meaning |
|---|---|---|
| `OIDC_ISSUER` | gateway, all services | The realm URL that appears as `iss` in tokens |
| `OIDC_DISCOVERY_URL` | gateway, services (optional) | Only when the services must reach Keycloak at a different address from the browser |
| `OIDC_CLIENT_ID` | gateway | The client ID registered in Keycloak (`hwms-gateway`, set in compose) |
| `OIDC_CLIENT_SECRET` | gateway | From `GATEWAY_CLIENT_SECRET` in `.env` |
| `OIDC_REDIRECT_URL` | gateway | `${APP_BASE_URL}/auth/callback`, must be registered in Keycloak exactly |
| `OIDC_AUDIENCE` | services | The value services require in `aud` (default `account`) |
| `KEYCLOAK_URL`, `KEYCLOAK_REALM` | identity | Where the Admin API lives (hard-coded in compose today) |
| `KEYCLOAK_ADMIN_CLIENT_ID`, `KEYCLOAK_ADMIN_CLIENT_SECRET` | identity | The service-account client and its secret (`IDENTITY_CLIENT_SECRET`) |
| `COOKIE_SECURE` | gateway | `true` whenever the app is served over HTTPS |
| `SESSION_IDLE_TIMEOUT` | gateway | Idle time before the HWMS session ends (30 minutes) |

---

## 7. How it is going to be: the company Keycloak

### 7.1 What changes and what doesn't

| | Today (local) | With the company Keycloak |
|---|---|---|
| Who runs Keycloak | You, in Docker | KMC IT, at `https://auth.kiiramotors.com` |
| Realm | `hwms`, imported from `realm-hwms.json` | `test` now; a production realm later |
| Who configures the realm (password policy, MFA, lockout, timeouts) | `realm-hwms.json` | KMC IT. HWMS inherits their settings |
| Clients | Imported from the JSON | **You create them** in the admin console |
| Users | Created by `seed-manager.sh` and the Accounts screen | Company accounts. How HWMS users are created must be agreed (see 7.2) |
| Sign-in page | KMC theme mounted into the container | The company's theme. HWMS cannot mount files on their server |
| `/etc/hosts` trick | Needed (`127.0.0.1 keycloak`) | Not needed: one real DNS name, HTTPS |
| HWMS code | — | Unchanged if you name the client `hwms-gateway` and use realm roles; small changes otherwise |
| Gateway, BFF pattern, double role checks | Same | Same |

### 7.2 Decisions to agree with the Keycloak administrators first

A shared company realm is not your private realm. These questions have security and
organisational consequences, so raise them with IT before configuring anything. Record
the answers in the stakeholder decision register.

1. **Realm roles or client roles?** HWMS reads realm roles named `hwms-officer`,
   `hwms-manager` and `hwms-director` today.
   - *Realm roles* need no code change, but they are realm-wide: they appear in every token
     for that user, from every application, and you need permission to create realm roles.
   - *Client roles* (defined on the `hwms-gateway` client) are scoped to HWMS and are the
     tidier choice in a shared realm. They need a small code change (section 8, step 4B).

   **Recommendation:** ask IT. Realm roles are fine for the `test` realm; plan client roles
   for production.
2. **Audience.** HWMS services accept any token whose `aud` contains `account`. In a
   shared realm, that means a token obtained by *another* company application, for a user
   who also holds an HWMS role, would be accepted by HWMS's APIs. **Recommendation:** add
   an audience dedicated to HWMS (`hwms-api`) and require it (step 5).
3. **Who creates HWMS users?** HWMS's Accounts screen creates users through the identity
   service, which needs `manage-users`. In a shared realm, `manage-users` lets HWMS modify
   **every** user in the realm, including other systems' users. Options:
   - IT keeps account creation; the manager asks IT, and HWMS only assigns roles to
     existing company accounts. The Accounts screen is then disabled or reduced to a view.
   - IT grants the identity service *fine-grained* admin permissions limited to one group
     (supported as "admin permissions v2" in recent Keycloak versions; ask whether the
     company server has it enabled).
   - IT grants full `manage-users`. This is the simplest option but the least
     appropriate in a shared realm.
4. **Login theme.** Can the KMC theme (`hwms/deploy/keycloak/themes/kmc`) be installed on
   the company server, or does HWMS use the company theme? The company theme is the
   normal answer.
5. **Realm policies.** Confirm the password policy, brute-force lockout, MFA and session
   timeouts. HWMS's own idle timeout is 30 minutes; the realm's **SSO Session Idle**
   should not be shorter, or the refresh token dies before the HWMS session does.
6. **Environments.** One client per environment: a `test`-realm client for development
   (`localhost` URLs), and a separate production client with production URLs. Never point
   a production client at `localhost`.

---

## 8. Step by step: connect HWMS to the `test` realm

You need: your new admin password (section 1), the HWMS stack (`make up` in `hwms/`), and
about 30 minutes.

### Step 1. Open the realm

`https://auth.kiiramotors.com/admin/` → sign in → **Manage realms** → **test**. Check the
realm name shown at the top of the left navigation says `test` before every change.

### Step 2. Create the gateway client

**Clients → Create client.**

*General settings*

| Field | Value | Why |
|---|---|---|
| Client type | OpenID Connect | HWMS speaks OIDC |
| Client ID | `hwms-gateway` | Compose already passes this ID. Another name means changing `OIDC_CLIENT_ID` |
| Name | `HWMS gateway (development)` | Humans read this |
| Description | `KMC Health and Wellness Management System, local development. Owner: <your name>` | Lets IT know whose client it is |

*Capability config*

| Field | Value | Why |
|---|---|---|
| Client authentication | **On** | Confidential client: the gateway can keep a secret |
| Authorization | Off | That's Keycloak's own policy engine; HWMS enforces roles itself |
| Standard flow | **On** | Authorization Code flow |
| Direct access grants | **Off** | Password grant: never |
| Implicit flow | **Off** | Deprecated |
| Service accounts roles | Off | The gateway acts for users, not as itself |
| Device / CIBA grants | Off | Not needed |
| PKCE Method (if shown on this page) | **S256** | Otherwise set it in step 2b |

*Login settings*

| Field | Value |
|---|---|
| Root URL | `http://localhost:8090` |
| Home URL | `http://localhost:8090` |
| Valid redirect URIs | `http://localhost:8090/auth/callback` |
| Valid post logout redirect URIs | `http://localhost:8090/login` |
| Web origins | `http://localhost:8090` |

Enter **exact** URLs. No `*` wildcards: a wildcard redirect URI lets an attacker have
Keycloak deliver a sign-in code to a page they control.

**Save.**

**Step 2b. PKCE.** If the wizard had no PKCE option: open the client → **Advanced** tab →
*Advanced settings* → **Proof Key for Code Exchange Code Challenge Method** = `S256` →
Save. This makes Keycloak *refuse* sign-ins without PKCE, rather than merely accepting
them.

### Step 3. Copy the client secret into `.env`

Client → **Credentials** tab → copy **Client secret**. In `hwms/.env` (git-ignored, never
committed):

```bash
GATEWAY_CLIENT_SECRET=<paste the secret here>
```

If the secret is ever exposed, press **Regenerate** on the same tab and update `.env`.

### Step 4. Roles

**Option A: realm roles (no code change).** If IT allows it: **Realm roles → Create
role**, three times:

| Role name | Description |
|---|---|
| `hwms-officer` | Health and Wellness Officer. Records visits, monitoring, ergonomics. The only role with access to individual clinical records. |
| `hwms-manager` | Manager. Read-only operational summaries, plus administration of officer and director accounts. No clinical access. |
| `hwms-director` | Director. Executive summaries and trends only. No clinical access. |

The names must match exactly: they are compared as strings in `platform/auth/auth.go`.

**Option B: client roles (code change required).** On the `hwms-gateway` client →
**Roles** tab → **Create role** with the same three names. Keycloak then puts them in
`resource_access["hwms-gateway"].roles` instead of `realm_access.roles`, so two places
in the code must read that claim:

- `platform/auth/auth.go`: the `claims` struct and `Verify`, which every service uses.
- `services/gateway/auth.go`: `identityClaims` and `rolesFromAccessToken`.

A sketch of the change (the client ID should come from configuration, not be hard-coded):

```go
type claims struct {
    // ...
    ResourceAccess map[string]struct {
        Roles []string `json:"roles"`
    } `json:"resource_access"`
}

roles := c.ResourceAccess[clientID].Roles // instead of c.RealmAccess.Roles
```

Whichever option you choose, check that the **`roles`** client scope is attached to the
client as **Default**: client → **Client scopes** tab. Without it, no roles reach the token.

### Step 5. A dedicated audience for the HWMS APIs (recommended)

Client `hwms-gateway` → **Client scopes** tab → open **`hwms-gateway-dedicated`** →
**Configure a new mapper** (or **Add mapper → By configuration**) → **Audience**:

| Field | Value |
|---|---|
| Name | `hwms-api audience` |
| Included Client Audience | *(leave empty)* |
| Included Custom Audience | `hwms-api` |
| Add to ID token | Off |
| Add to access token | **On** |

Then in `hwms/.env`:

```bash
OIDC_AUDIENCE=hwms-api
```

Every service now rejects access tokens that were not issued through the HWMS client,
even if they come from the same realm.

### Step 6. Test users and role assignment

You need one test account per HWMS role, so you can sign in as each and check what it
sees. The order matters: **roles first, then groups, then users**. A user only gets
HWMS access through a role, and the cleanest way to give a role is through a group.

Do everything below in the **`test`** realm (check the realm name at the top of the left
navigation).

**6.1 Make sure the three roles exist.** You created them in step 4. Check under
**Realm roles** (option A) or under **Clients → hwms-gateway → Roles** (option B) that
`hwms-officer`, `hwms-manager` and `hwms-director` are listed.

**6.2 Create one group per role.** Do this three times:

1. Left navigation → **Groups** → **Create group**.
2. Name: `HWMS Managers` → **Create**.
3. Click the new group → **Role mapping** tab → **Assign role**.
4. Show the right kind of role. For option A, choose **Realm roles** (in some versions,
   change the filter dropdown to *Filter by realm roles*). For option B, choose **Client
   roles** and look for the `hwms-gateway` entries.
5. Tick `hwms-manager` → **Assign**.

Repeat for `HWMS Officers` → `hwms-officer` and `HWMS Directors` → `hwms-director`.

**6.3 Create the test users.** Do this three times:

1. Left navigation → **Users** → **Add user** (or **Create new user** if the list is
   empty).
2. Fill in the form:

   | Field | Example for the manager | Notes |
   |---|---|---|
   | Required user actions | *(leave empty)* | The temporary password in 6.4 already forces a password change |
   | Email verified | **On** | Otherwise Keycloak asks the user to verify an email address that may not receive mail |
   | Username | `hwms.test.manager` | Keycloak stores usernames in lower case |
   | Email | `hwms.test.manager@kiiramotors.com`, or an address IT gives you | Must be unique in the realm. HWMS shows it as the user's email |
   | First name / Last name | `Test` / `Manager` | HWMS shows the name in the top bar |

3. **Join groups** → tick `HWMS Managers` → **Join**.
4. **Create**.

Repeat with `hwms.test.officer` (group `HWMS Officers`) and `hwms.test.director` (group
`HWMS Directors`).

**6.4 Give each user a temporary password.**

1. Open the user → **Credentials** tab → **Set password**.
2. Enter a password twice. It must satisfy the realm's password policy; if Keycloak
   rejects it, the error says which rule failed.
3. Leave **Temporary** **On** → **Save** → confirm **Set password**.

Store these passwords in a password manager, never in the repository or a chat. Anyone
testing with these accounts must set their own password at first sign-in.

**6.5 Check the result.** Open each user → **Groups** tab shows the group, and **Role
mapping** tab shows the HWMS role (with **Hide inherited roles** unticked, since the role
comes through the group).

**6.6 Sign in as each user**, once HWMS points at the `test` realm (steps 9 and 10):

1. Open a **private browser window** at `http://localhost:8090` and choose **Sign in**.
   A private window keeps each test user's session separate from your normal browser.
2. Sign in as `hwms.test.manager` with the temporary password. Keycloak asks for a new
   password; set it.
3. You land in HWMS. Confirm what each role should see:

   | User | Should land on | Should see |
   |---|---|---|
   | `hwms.test.officer` | Patient visits | Clinical screens and recording forms |
   | `hwms.test.manager` | Dashboard | Dashboard, the operations screens, Accounts. No clinical screens |
   | `hwms.test.director` | Dashboard | Dashboard only |

4. **Sign out**, close the window, and repeat for the next user.

To prove the refusal works, create a fourth user in no group. Signing in as that user
should return to HWMS's sign-in page with a "no role" message (`/login?error=no_role`).
That is deliberate: an account with no HWMS role gets nothing.

**Later, for real staff:** use the same groups. Giving someone HWMS access means adding
them to a group, and removing access means removing them. Don't assign HWMS roles to
users one by one.

### Step 7. Check the token before touching HWMS

Client `hwms-gateway` → **Client scopes** → **Evaluate** → choose a test user →
**Generated access token**. Confirm:

- `iss` is `https://auth.kiiramotors.com/realms/test`;
- `aud` contains `hwms-api` (and `account`, which is fine);
- `realm_access.roles` (option A) or `resource_access.hwms-gateway.roles` (option B)
  contains the HWMS role;
- `azp` is `hwms-gateway`.

This tab is the fastest way to debug almost every role or audience problem.

### Step 8. (Only if agreed) the identity service client

Only if decision 3 in section 7.2 allows it:

1. **Clients → Create client**, Client ID `hwms-identity`, Client authentication **On**,
   **only** Service accounts roles **On** (Standard flow **Off**, no redirect URIs).
2. **Service accounts roles** tab → **Assign role** → filter by clients →
   `realm-management` → the narrowest set IT agrees to.
3. **Credentials** → copy the secret into `.env` as `IDENTITY_CLIENT_SECRET`.

### Step 9. Point HWMS at the company Keycloak

In `hwms/.env`:

```bash
# Company Keycloak, realm "test"
OIDC_ISSUER=https://auth.kiiramotors.com/realms/test
GATEWAY_CLIENT_SECRET=<from step 3>
OIDC_AUDIENCE=hwms-api
# Leave OIDC_DISCOVERY_URL unset: the browser and the containers use the same URL.
```

Note the exact issuer: `https`, no trailing slash, `/realms/test`.

The identity service's `KEYCLOAK_URL` and `KEYCLOAK_REALM` are hard-coded in
`docker-compose.yml`. Make them overridable before relying on the Accounts screen:

```yaml
  identity:
    environment:
      KEYCLOAK_URL: ${KEYCLOAK_URL:-http://keycloak:8180}
      KEYCLOAK_REALM: ${KEYCLOAK_REALM:-hwms}
```

and add `KEYCLOAK_URL=https://auth.kiiramotors.com` and `KEYCLOAK_REALM=test` to `.env`.
The same pattern (`OIDC_CLIENT_ID: ${OIDC_CLIENT_ID:-hwms-gateway}`) is worth applying to
the gateway, so one compose file serves every environment.

### Step 10. Restart and test

Environment changes need the containers recreated:

```bash
cd hwms
docker compose up -d gateway identity clinical admin occupational metrics
docker compose logs -f gateway
```

Then:

1. Open `http://localhost:8090` and choose **Sign in**. You should land on the
   **company** sign-in page at `auth.kiiramotors.com`.
2. Sign in as a test user. You return to HWMS on the screen for that role.
3. Open a screen that calls an API (the dashboard). Data loads, which means the services
   accepted the token's issuer and audience.
4. Sign out. You return to `/login`, and signing in again asks for the password, which
   means the Keycloak session ended too.

The local `keycloak` container keeps running (other services still list it in
`depends_on`). It's harmless, and it lets you switch back.

### Step 11. Switching back to local Keycloak

Restore the previous `OIDC_ISSUER`, `GATEWAY_CLIENT_SECRET` and `OIDC_AUDIENCE` values in
`.env` (keep both sets in your `.env`, commented, if you switch often) and recreate the
containers as in step 10.

---

## 9. Troubleshooting

### 9.1 Symptoms, causes and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| Keycloak page: **"Invalid parameter: redirect_uri"** | The callback URL isn't registered exactly (scheme, host, port, path) | Add `http://localhost:8090/auth/callback` to *Valid redirect URIs* |
| Keycloak page: **"Client not found"** | Wrong `OIDC_CLIENT_ID`, or wrong realm in `OIDC_ISSUER` | Client ID must be `hwms-gateway`; issuer must end in `/realms/test` |
| Back on HWMS at `/login?error=exchange` | Code exchange failed: wrong secret, client authentication off, PKCE mismatch | Check `GATEWAY_CLIENT_SECRET`; `docker compose logs gateway` shows "code exchange failed" with the reason |
| `/login?error=invalid_token` | ID token rejected, usually an issuer mismatch | `OIDC_ISSUER` must equal the token's `iss` exactly |
| `/login?error=no_role` | No HWMS role in the token | Assign the role (step 4/6); check the `roles` scope is Default; option B needs the code change |
| `/login?error=state` | State or PKCE cookie missing: sign-in took over 10 minutes, or cookies blocked | Start sign-in again; allow cookies for localhost |
| Signed in, but every screen says **"The session has expired. Sign in again."** | Services return 401: `aud` doesn't contain `OIDC_AUDIENCE` | Compare the token's `aud` (step 7) with `OIDC_AUDIENCE` |
| Gateway keeps restarting, logs "discover issuer" | Containers can't reach Keycloak (DNS, proxy, firewall, TLS) | Test from inside the network (9.2) |
| Sign-out shows **"Invalid redirect uri"** | Post-logout URL not registered | Add `http://localhost:8090/login` to *Valid post logout redirect URIs* |
| Sign-out shows **"Do you want to log out?"** | Keycloak asks for confirmation when the request has no `id_token_hint` | Expected today; see 10.5 for the improvement |
| **"Account is not fully set up"** | Pending required action (update password, verify email, configure OTP) | The user completes it, or an admin removes it under *Required user actions* |
| **"Invalid username or password"** although it's right | Temporary lockout from brute-force detection | Wait, or an admin unlocks the user |
| "Token is not valid yet" or immediately expired | Clock skew between machines | Enable time sync (NTP) on the host |
| Accounts screen fails with 403 | Identity service account lacks `realm-management` roles in `test` | Decision 3, step 8 |

### 9.2 Useful commands

```bash
# Can the containers reach the realm?
docker compose exec -T postgres wget -qO- https://auth.kiiramotors.com/realms/test/.well-known/openid-configuration | head -c 200

# Follow sign-in problems as they happen
docker compose logs -f gateway

# Decode a token's payload locally, e.g. one copied from the Evaluate tab.
# Never paste a real token into a website: it is a live credential until it expires.
jwt_payload() {
  local p; p=$(cut -d. -f2 <<<"$1" | tr '_-' '/+')
  while [ $(( ${#p} % 4 )) -ne 0 ]; do p="$p="; done
  base64 -d <<<"$p" | jq .
}
jwt_payload "eyJhbGciOi..."
```

Keycloak's own logs are on the company server. Ask IT for the **Events** view (realm
`test` → *Events*) when a sign-in fails without a clear message; it records the error code
for every failed sign-in, if event saving is enabled.

---

## 10. Good practices

### 10.1 Accounts and credentials

- Change temporary passwords immediately. Use long, unique passphrases and MFA for every
  administrator account.
- Don't share admin accounts. One person, one account, so the audit trail means something.
- Secrets live in `.env` locally (git-ignored, as here) and in a Kubernetes Secret or a
  secret manager in production, never in code, images or `realm-*.json` exports.
- If a secret might have leaked, regenerate it first and investigate second.
- The development secrets in `.env.example` and `realm-hwms.json`
  (`development-only-...-rotate-me`) must never be used outside your laptop.

### 10.2 Client configuration

- **Confidential client + Authorization Code + PKCE (S256)** for anything with a server
  side. That is HWMS's setup; keep it.
- **Turn off** Direct access grants and Implicit flow on every client.
- **Exact** redirect URIs, post-logout URIs and web origins. No wildcards, no `http://`
  except `localhost`.
- **One client per application per environment** (`hwms-gateway` in `test`, a separate
  one in production), each with an owner named in its description.
- **Least capability:** enable only the flows the client uses.
- Keep an export of your client's configuration in the repository (client → *Action* →
  *Export*), **with the secret removed**, so the setup is reviewable and repeatable.

### 10.3 Tokens

- Keep access tokens short-lived (the realm default of 5 minutes is good) and rely on
  refresh tokens held server-side.
- Always verify signature, issuer, audience and expiry. `platform/auth` does this; don't
  add any code path that only decodes.
- Never store tokens in `localStorage` or `sessionStorage`, or anywhere JavaScript can
  read them. The BFF pattern exists precisely for this.
- Never log tokens. The gateway logs the username, never the token (see
  `platform/logging`).
- Identify users by `sub`, not email or username: emails change, `sub` doesn't. Note that
  `sub` is per realm. The same person has a different `sub` in `hwms`, `test` and
  production, so don't migrate local test data that references local users.
- Require a **dedicated audience** for your APIs in a shared realm.

### 10.4 Roles and authorisation

- Keycloak says *who* and *which role*; HWMS decides *what that allows*. Keep the
  enforcement in HWMS code, and keep checking twice (middleware and service layer).
- Least privilege: officer, manager and director, and nothing broader. Don't create an
  "HWMS admin" that bypasses the clinical boundary.
- Assign roles through **groups**, not user by user.
- Prefer **client roles** in a shared realm; realm roles leak into other apps' tokens.
- Ignore roles you don't define (HWMS's `filterHWMSRoles` does).
- Review who holds each role regularly; a leaver should lose access the day they leave.

### 10.5 Sessions and sign-out

- Always end the Keycloak session on sign-out (HWMS does, through the end-session endpoint).
- **Improvement for later:** pass `id_token_hint` (the gateway already keeps the ID token in
  the session) in the sign-out redirect. Keycloak then skips the "Do you want to log out?"
  confirmation.
- Align timeouts: HWMS idle 30 minutes ≤ realm *SSO Session Idle* ≤ *SSO Session Max*.
- **Back-channel logout** (Keycloak notifying the gateway when an admin ends a session) is
  supported by the company realm. It would need a small endpoint in the gateway. Worth
  adding before production, so that disabling a user ends their HWMS session immediately
  rather than within one access-token lifetime.
- The gateway's session store is in memory: restarting it signs everyone out, and two
  replicas would not share sessions. Fine for now, and already documented in `session.go`.

### 10.6 Service accounts

- One service account per service, with the narrowest roles that work.
- Never give an application `realm-admin`.
- Rotate service-account secrets on a schedule and whenever someone with access leaves.

### 10.7 Network and TLS

- HTTPS everywhere except `localhost`. In production set `COOKIE_SECURE=true` (the
  Kubernetes config already does).
- The HWMS images are distroless, which ships public CA certificates, so HTTPS to the
  company server works. If IT ever moves Keycloak behind an internal certificate
  authority, that CA must be added to the images.
- Keep server clocks synchronised (NTP). Token validation depends on time.

### 10.8 Working in a shared realm

- Change only what you own: your clients, your roles, your test users. Ask before
  touching realm settings, authentication flows, themes or other teams' clients.
- Name everything so its owner is obvious (`hwms-...`).
- Clean up test users and old clients when you finish with them.
- Keycloak holds **identity only**. Never put clinical information (diagnoses, medical
  notes) in user attributes: Keycloak is not the clinical system and isn't protected as one.

### 10.9 Before you call the integration done

- [ ] Temporary password changed; MFA on your admin account
- [ ] `hwms-gateway` client: confidential, standard flow only, PKCE S256, exact URLs
- [ ] Secret only in `.env`; nothing committed (`git status` shows no `.env`)
- [ ] Roles created and assigned through groups
- [ ] Dedicated audience mapper; `OIDC_AUDIENCE=hwms-api`
- [ ] Evaluate tab shows the right `iss`, `aud` and roles
- [ ] Sign-in, an API call, and sign-out tested for each role
- [ ] A user with no HWMS role is refused
- [ ] Decisions in 7.2 recorded in the decision register
- [ ] Client configuration exported (without secret) for review

---

## 11. From test to production

Moving from `test` to production repeats section 8 with production values. What is
different:

| Item | Production |
|---|---|
| Realm | The production realm IT designates |
| Client | A **new** client; never reuse the `test` client |
| URLs | `https://qhse.kiiramotors.local/auth/callback` and so on (from `deploy/k8s/00-namespace-and-config.yaml`), HTTPS only |
| Config | `OIDC_ISSUER` in the ConfigMap points at the company realm; `OIDC_DISCOVERY_URL` is removed unless the cluster really needs a different internal address; `OIDC_AUDIENCE` changes from `account` to the dedicated audience |
| Secrets | `GATEWAY_CLIENT_SECRET` and `IDENTITY_CLIENT_SECRET` in the Kubernetes Secret, created with `kubectl create secret`, never committed |
| Bundled Keycloak | The Keycloak deployment in `deploy/k8s/10-data.yaml` and its database are no longer needed when the company server is used |
| Users | Real staff accounts (possibly federated from Active Directory), roles through groups |
| Security | MFA required for HWMS roles (at least officer and manager), back-channel logout, IT monitoring of sign-in events |
| Sign-off | Security review of the client configuration with IT before go-live |

---

## 12. Glossary

| Term | Meaning |
|---|---|
| **IAM** | Identity and Access Management |
| **IdP** | Identity provider: the system that authenticates users (Keycloak) |
| **OIDC** | OpenID Connect, identity on top of OAuth 2.0 |
| **OAuth 2.0** | Framework for delegated access with tokens |
| **JWT** | JSON Web Token, `header.payload.signature` in base64url |
| **JWKS** | JSON Web Key Set, the realm's public signing keys |
| **Claim** | A field inside a token (`sub`, `iss`, `aud`, `exp`, ...) |
| **Issuer (`iss`)** | The realm that signed a token |
| **Audience (`aud`)** | Who a token is intended for |
| **Subject (`sub`)** | Permanent user ID within a realm |
| **`azp`** | The client the token was issued to |
| **PKCE** | Proof Key for Code Exchange; protects the authorisation code |
| **BFF** | Backend for frontend: a server component that holds tokens for the browser |
| **SSO** | Single sign-on |
| **RP-initiated logout** | The application asks the IdP to end the session |
| **Back-channel logout** | The IdP tells the application, server to server, that a session ended |
| **Confidential client** | A client that can keep a secret (runs on a server) |
| **Service account** | A client's own non-human identity for the client-credentials flow |
| **Required action** | A step a user must complete at next sign-in |
| **Realm** | Isolated tenant in Keycloak: users, roles, clients, keys |

---

## 13. Further reading

- Keycloak documentation: <https://www.keycloak.org/documentation>, especially the
  *Server Administration Guide* (realms, clients, roles, sessions) and *Securing
  Applications* (OIDC clients, PKCE, logout).
- OpenID Connect Core 1.0: <https://openid.net/specs/openid-connect-core-1_0.html>
- OAuth 2.0 (RFC 6749): <https://www.rfc-editor.org/rfc/rfc6749>
- PKCE (RFC 7636): <https://www.rfc-editor.org/rfc/rfc7636>
- OAuth 2.0 Security Best Current Practice (RFC 9700):
  <https://www.rfc-editor.org/rfc/rfc9700>
- OAuth 2.0 for Browser-Based Applications (IETF draft, describes the BFF pattern):
  <https://datatracker.ietf.org/doc/draft-ietf-oauth-browser-based-apps/>
- In this repository: `hwms/README.md` (running the stack), `hwms/services/gateway/auth.go`
  and `hwms/platform/auth/auth.go` (the code this guide describes).
