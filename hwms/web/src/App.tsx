import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import { AppShell } from "./components/AppShell";
import { LoginPage } from "./pages/LoginPage";
import { DashboardPage } from "./pages/DashboardPage";
import { ModulePage } from "./pages/ModulePage";
import { PatientsPage } from "./pages/PatientsPage";
import { NewPatientPage } from "./pages/NewPatientPage";
import { PatientRecordPage } from "./pages/PatientRecordPage";
import { PatientVisitsPage } from "./pages/PatientVisitsPage";
import { NewVisitPage } from "./pages/NewVisitPage";
import { VisitDetailPage } from "./pages/VisitDetailPage";
import { LaboratoryPage } from "./pages/LaboratoryPage";
import { NewLabRequestPage } from "./pages/NewLabRequestPage";
import { LabRequisitionPage } from "./pages/LabRequisitionPage";
import { ReferralsPage } from "./pages/ReferralsPage";
import { NewReferralPage } from "./pages/NewReferralPage";
import { ReferralDetailPage } from "./pages/ReferralDetailPage";
import { IndustrialHygienePage } from "./pages/IndustrialHygienePage";
import { ErgonomicsPage } from "./pages/ErgonomicsPage";
import { MonthlyReturnsPage } from "./pages/MonthlyReturnsPage";
import { ForbiddenPage } from "./pages/ForbiddenPage";
import { NotFoundPage } from "./pages/NotFoundPage";
import { allRoutes, canOpen, homePathFor } from "./lib/navigation";
import { primaryRole, useSession } from "./lib/session";

/**
 * The route table is generated from the navigation declaration, so that what
 * the rail offers and what the router permits cannot drift apart.
 *
 * Guarding here is a courtesy to the user, not a security boundary. Every
 * service checks the token again at its handler and once more in its service
 * layer; a determined caller bypassing this guard reaches a 403, not data.
 */
function elementFor(path: string) {
  switch (path) {
    case "/dashboard":
      return <DashboardPage />;
    case "/patients":
      return <PatientsPage />;
    case "/patients/new":
      return <NewPatientPage />;
    case "/patients/record":
      return <PatientRecordPage />;
    case "/patient-visits":
      return <PatientVisitsPage />;
    case "/patient-visits/new":
      return <NewVisitPage />;
    case "/patient-visits/details":
      return <VisitDetailPage />;
    case "/laboratory":
      return <LaboratoryPage />;
    case "/laboratory/new":
      return <NewLabRequestPage />;
    case "/laboratory/details":
      return <LabRequisitionPage />;
    case "/referrals":
      return <ReferralsPage />;
    case "/referrals/new":
      return <NewReferralPage />;
    case "/referrals/details":
      return <ReferralDetailPage />;
    case "/industrial-hygiene":
      return <IndustrialHygienePage />;
    case "/ergonomics-wellness":
      return <ErgonomicsPage />;
    case "/monthly-returns":
      return <MonthlyReturnsPage />;
    default:
      // Every route in the navigation now has a page. ModulePage remains for
      // a route added to the table before its screen exists: it says so
      // rather than showing an invented figure.
      return <ModulePage />;
  }
}

function Protected({ children }: { children: React.ReactNode }) {
  const { status } = useSession();
  const location = useLocation();

  if (status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink-muted">
        Checking your session…
      </div>
    );
  }
  if (status === "anonymous") {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <>{children}</>;
}

/**
 * Signed in, but the account holds no role this system recognises.
 *
 * Rendering the shell would give an empty rail and a blank page with no
 * explanation. Say what has happened and name who can fix it.
 */
function NoRoleAssigned() {
  const { user, signOut } = useSession();
  return (
    <div className="mx-auto max-w-form px-6 py-16">
      {/* This page renders outside the shell, so it carries the mark itself.
          Someone who lands here has signed in successfully and should be able
          to see they are in the right system. */}
      <img
        src="/logo.png"
        alt="Kiira Motors Corporation"
        className="mb-8 h-8 w-auto"
      />
      <h1 className="text-xl">This account has no role yet</h1>
      <p className="mt-3 text-sm text-ink-muted">
        You are signed in as {user?.name ?? user?.username}, but no role has been assigned to the
        account, so there is nothing for it to open. Nothing is wrong with your password.
      </p>
      <p className="mt-3 text-sm text-ink-muted">
        Contact your system or Keycloak administrator to assign your account to an HWMS group or role.
      </p>
      <button type="button" className="button-secondary mt-6" onClick={() => void signOut()}>
        Sign out
      </button>
    </div>
  );
}

export default function App() {
  const { status, user } = useSession();
  const role = primaryRole(user);

  return (
    <Routes>
      <Route
        path="/login"
        element={
          // Redirect away from sign-in only when there is somewhere to go. An
          // authenticated account with no role has no home path, and
          // redirecting it to /login would bounce between the two forever -
          // which is precisely what happened the first time a real account
          // signed in without a role.
          status === "authenticated" && role !== null ? (
            <Navigate to={homePathFor(role)} replace />
          ) : (
            <LoginPage />
          )
        }
      />

      <Route
        path="/*"
        element={
          <Protected>
            {role === null ? (
              <NoRoleAssigned />
            ) : (
            <AppShell>
              <Routes>
                <Route index element={<Navigate to={homePathFor(role)} replace />} />

                {allRoutes.map((item) => (
                  <Route
                    key={item.path}
                    path={item.path.replace(/^\//, "")}
                    element={
                      canOpen(item, role) ? elementFor(item.path) : <Navigate to="/forbidden" replace />
                    }
                  />
                ))}

                <Route path="forbidden" element={<ForbiddenPage />} />
                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </AppShell>
            )}
          </Protected>
        }
      />
    </Routes>
  );
}
