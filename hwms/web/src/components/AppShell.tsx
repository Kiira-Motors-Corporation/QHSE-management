import { useEffect, useMemo, useState } from "react";
import { NavLink, useLocation } from "react-router-dom";
import { AuthDialog } from "./AuthDialog";
import { Icon } from "./Icon";
import { navigationFor, routeFor, isReadOnly } from "../lib/navigation";
import { primaryRole, roleLabels, useSession } from "../lib/session";

function initialsFor(name: string) {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "HW";
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("");
}

/**
 * The application shell keeps the current role and current working area in
 * view, while allowing the clinical content to remain the visual priority.
 * On smaller screens the rail becomes a proper modal drawer rather than
 * squeezing record forms into an unusable column.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const { user, signOut } = useSession();
  const role = primaryRole(user);
  const groups = navigationFor(role);
  const location = useLocation();
  const current = routeFor(location.pathname);
  const readOnly = current ? isReadOnly(current, role) : false;
  const [navOpen, setNavOpen] = useState(false);
  const [signOutOpen, setSignOutOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const currentArea = useMemo(() => {
    for (const group of groups) {
      if (group.items.some((item) => item.path === current?.path)) {
        return group.label ?? "Overview";
      }
      if (group.items.some((item) => item.children?.some((child) => child.path === current?.path))) {
        return group.label ?? "Overview";
      }
    }
    return "Health and Wellness";
  }, [current?.path, groups]);

  useEffect(() => {
    setNavOpen(false);
  }, [location.pathname]);

  const confirmSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="topbar-brand">
          <div className="topbar-logo-wrap">
            <img src="/logo.png" alt="Kiira Motors Corporation" className="topbar-logo" />
          </div>
          <div className="topbar-brand-copy">
            <strong>Health &amp; Wellness</strong>
            <span>QHSE workspace</span>
          </div>
        </div>

        <div className="topbar-main">
          <button
            type="button"
            className="icon-button menu-button"
            onClick={() => setNavOpen(true)}
            aria-label="Open navigation"
            aria-expanded={navOpen}
          >
            <Icon name="menu" size={21} />
          </button>

          <div className="topbar-context">
            <span>{currentArea}</span>
            <strong>{current?.label ?? "QHSE management system"}</strong>
          </div>

          <div className="topbar-actions">
            <div className="user-chip">
              <div className="user-copy">
                <strong>{user?.name}</strong>
                <span>{role ? roleLabels[role] : "No role assigned"}</span>
              </div>
              <span className="user-avatar" aria-hidden="true">
                {initialsFor(user?.name ?? "Health Wellness")}
              </span>
            </div>
            <button
              type="button"
              className="button-secondary topbar-signout"
              onClick={() => setSignOutOpen(true)}
            >
              <Icon name="logout" size={17} />
              <span>Sign out</span>
            </button>
          </div>
        </div>
      </header>

      {navOpen ? (
        <button
          type="button"
          className="mobile-scrim"
          aria-label="Close navigation"
          onClick={() => setNavOpen(false)}
        />
      ) : null}

      <nav
        aria-label="Primary"
        className={`sidebar${navOpen ? " sidebar-open" : ""}`}
      >
        <div className="sidebar-mobile-head">
          <strong>Health &amp; Wellness</strong>
          <button
            type="button"
            className="icon-button"
            onClick={() => setNavOpen(false)}
            aria-label="Close navigation"
          >
            <Icon name="close" size={20} />
          </button>
        </div>

        <div className="sidebar-groups">
          {groups.map((group) => (
            <div key={group.label ?? "overview"} className="nav-group">
              {group.label ? <div className="nav-group-label">{group.label}</div> : null}
              <ul className="nav-list">
                {group.items.map((item) => (
                  <li key={item.path}>
                    <NavLink
                      to={item.path}
                      className={({ isActive }) =>
                        `nav-link${isActive ? " nav-link-active" : ""}`
                      }
                    >
                      <Icon name={item.icon} size={19} />
                      <span>{item.label}</span>
                    </NavLink>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </nav>

      <main className="app-main">
        <div className="content-frame">
          {readOnly ? (
            <div className="read-only-note">
              <Icon name="visibility" size={18} />
              <span>
                View-only access. The {role ? roleLabels[role] : "current"} role does not enter or
                approve records here.
              </span>
            </div>
          ) : null}
          {children}
        </div>
      </main>

      <AuthDialog
        open={signOutOpen}
        tone="signout"
        icon="logout"
        title="Sign out of this workspace?"
        description="Your secure session will end on this device. Any work that has not been saved on the current page will be lost."
        confirmLabel="Sign out"
        cancelLabel="Stay signed in"
        busy={signingOut}
        onClose={() => setSignOutOpen(false)}
        onConfirm={() => void confirmSignOut()}
      />
    </div>
  );
}
