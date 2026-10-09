import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Mail } from "lucide-react";
import { call } from "./lib/discover";
import { errorText } from "./lib/types";
import { Brand, Spinner } from "./components";
export function EmailGate({
  children,
  onExit,
}: {
  children: ReactNode;
  onExit: () => Promise<void>;
}) {
  const [verified, setVerified] = useState<boolean | null>(null);
  const [error, setError] = useState("");
  async function check() {
    setError("");
    try {
      const status = await call<{ email_verified: boolean }>("account_status");
      setVerified(status.email_verified);
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    void check();
  }, []);
  if (verified) return <>{children}</>;
  return (
    <main className="email-gate">
      <Brand />
      <div className="email-card">
        <div className="email-symbol">
          <Mail size={27} />
        </div>
        <h1>
          One account.
          <br />
          Two ways to be you.
        </h1>
        <p className="muted">
          Confirm your email to join Kindred. Your email stays private, even
          when you choose to be anonymous.
        </p>
        {error ? (
          <div className="form-error" role="alert">
            {error}
            <button className="text-button" onClick={() => void check()}>
              Retry
            </button>
          </div>
        ) : verified === null ? (
          <div className="loading-row">
            <Spinner /> Checking your account
          </div>
        ) : (
          <div>
            <p>Open the confirmation link in your inbox, then continue.</p>
            <button
              className="button primary full"
              onClick={() => void check()}
            >
              I’ve confirmed my email
            </button>
          </div>
        )}
        <button
          className="text-button"
          onClick={() => void onExit().catch((e) => setError(errorText(e)))}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
