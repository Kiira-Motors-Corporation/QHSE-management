import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { AuthDialog } from "../components/AuthDialog";
import { Icon } from "../components/Icon";

/**
 * Sign-in.
 *
 * The layout follows the prototype the client reviewed and approved: a dark
 * branded panel carrying the KMC mark on one side, the sign-in action on the
 * other. That arrangement is settled and is not re-litigated here.
 *
 * What differs from the prototype is what the right panel does. This page
 * collects no credentials. It hands the browser to Keycloak, which owns
 * password policy, lockout, multi-factor and, later, corporate single
 * sign-on. The application never sees a password, which is both safer and the
 * reason moving to corporate sign-on later is a configuration change rather
 * than a release.
 */
const errorMessages: Record<string, string> = {
  denied: "Sign-in was cancelled. Select sign in to try again.",
  state: "The sign-in attempt expired before it completed. Select sign in to start again.",
  exchange: "Sign-in could not be completed. Select sign in to try again, and tell ICT if it recurs.",
  no_id_token:
    "The sign-in service returned an incomplete response. Tell ICT with the time this happened.",
  invalid_token:
    "The sign-in service returned a response this system could not verify. Tell ICT with the time this happened.",
  no_role:
    "This account has no role assigned, so there is nothing it can open. Ask the manager to assign a role.",
};

export function LoginPage() {
  const [params] = useSearchParams();
  const errorKey = params.get("error");
  const message = errorKey ? (errorMessages[errorKey] ?? errorMessages.exchange) : null;
  const [signInOpen, setSignInOpen] = useState(false);
  const [startingSignIn, setStartingSignIn] = useState(false);

  const continueToSignIn = () => {
    setStartingSignIn(true);
    window.location.assign("/auth/login");
  };

  return (
    <>
    <main className="grid min-h-screen lg:grid-cols-[minmax(360px,0.9fr)_minmax(480px,1.1fr)]"
          style={{ background: "var(--dark)" }}>
      {/* Branded panel. The KMC mark sits here, top left, at full colour on a
          dark ground, the arrangement the client signed off. */}
      <section
        className="relative flex flex-col justify-between px-6 py-8 lg:min-h-screen lg:px-[clamp(32px,5vw,76px)] lg:py-12"
        style={{
          color: "var(--ink-inverse)",
          background:
            "radial-gradient(circle at 16% 18%, var(--brand-glow), transparent 28%), linear-gradient(145deg, var(--dark) 0%, var(--dark-raised) 100%)",
        }}
      >
        <div className="flex flex-col items-start gap-2">
          <img
            src="/logo.png"
            alt="Kiira Motors Corporation"
            className="w-[230px] max-w-full"
          />
          <span
            className="text-xs uppercase tracking-[0.08em]"
            style={{ color: "var(--dark-ink-muted)" }}
          >
            Health and Wellness · Occupational health
          </span>
        </div>

        <div className="max-w-[580px] py-10 lg:py-16">
          <span
            className="mb-4 block text-xs font-semibold uppercase tracking-[0.11em]"
            style={{ color: "var(--kmc-red-tint)" }}
          >
            Department of Quality, Health, Safety and Environment
          </span>
          <h1 className="mb-5 max-w-[540px] text-[clamp(2rem,4vw,3.3rem)] font-semibold leading-[1.08]">
            Sign in to the workspace for your role
          </h1>
          <p
            className="max-w-[560px] text-[0.95rem] leading-[1.7]"
            style={{ color: "var(--dark-ink)" }}
          >
            Operational records are captured once, where the work happens. Every figure reported to
            management is derived from those records and states where it came from.
          </p>
        </div>

        <div
          className="hidden max-w-[540px] gap-3 rounded p-4 lg:flex"
          style={{ background: "var(--white-05)", border: "1px solid var(--dark-rule)" }}
        >
          <Icon name="lock" size={22} className="shrink-0" style={{ color: "var(--kmc-red-tint)" }} />
          <div className="flex flex-col gap-1">
            <strong className="text-[0.78rem]">Access follows the signed-in role</strong>
            <span className="text-[0.7rem] leading-[1.5]" style={{ color: "var(--dark-ink-muted)" }}>
              Individual clinical records, patients, visits, laboratory results and referrals, are
              open to the Health and Wellness Officer only. Every retrieval is logged.
            </span>
          </div>
        </div>
      </section>

      {/* Sign-in panel */}
      <section className="flex items-center justify-center px-6 py-12">
        <div
          className="w-full max-w-[560px] rounded-[5px] p-8"
          style={{
            background: "var(--surface)",
            border: "1px solid var(--rule)",
            borderRadius: "var(--radius-lg)",
            boxShadow: "var(--shadow-float)",
          }}
        >
          <div className="mb-6 flex items-center gap-3">
            <span
              className="grid h-[42px] w-[42px] shrink-0 place-items-center rounded"
              style={{ color: "var(--kmc-red-deep)", background: "var(--kmc-red-wash)" }}
            >
              <Icon name="lock" size={20} />
            </span>
            <div>
              <h2 className="text-lg">Sign in</h2>
              <p className="mt-0.5 text-xs text-ink-muted">
                Use your Kiira Motors account.
              </p>
            </div>
          </div>

          <p className="text-sm leading-relaxed text-ink-muted">
            You will be taken to the corporate sign-in page and returned here. This system never
            receives your password.
          </p>

          {message ? (
            <div
              className="mt-6 flex items-start gap-3 rounded border px-4 py-3 text-sm"
              style={{
                borderColor: "var(--breach)",
                background: "var(--breach-wash)",
                color: "var(--breach)",
              }}
              role="alert"
            >
              <Icon name="error" size={18} className="mt-0.5 shrink-0" />
              <span>{message}</span>
            </div>
          ) : null}

          <button
            type="button"
            className="button-primary mt-8 w-full"
            onClick={() => setSignInOpen(true)}
          >
            <Icon name="login" size={18} />
            Sign in
          </button>

          <div className="mt-8 border-t border-rule pt-6 text-xs leading-relaxed text-ink-muted">
            <p>
              Accounts and roles are managed through corporate Single Sign-On (Keycloak). If you cannot
              sign in, or your account opens nothing, contact the ICT / system administrator.
            </p>
          </div>
        </div>
      </section>
    </main>

    <AuthDialog
      open={signInOpen}
      tone="signin"
      icon="lock"
      title="Continue to secure sign in"
      description="KMC’s sign-in service will verify your account and return you to this workspace. The Health and Wellness system never receives your password."
      confirmLabel="Continue to sign in"
      cancelLabel="Not now"
      busy={startingSignIn}
      onClose={() => setSignInOpen(false)}
      onConfirm={continueToSignIn}
    />
    </>
  );
}
