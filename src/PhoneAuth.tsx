import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Phone, ShieldCheck } from "lucide-react";
import { supabase } from "./lib/supabase";
import { call } from "./lib/discover";
import { errorText } from "./lib/types";
import { Brand, Spinner } from "./components";
export function PhoneForm({
  link = false,
  onVerified,
}: {
  link?: boolean;
  onVerified?: () => void;
}) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [cooldown, setCooldown] = useState(0);
  useEffect(() => {
    if (!cooldown) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);
  async function request() {
    setBusy(true);
    setError("");
    try {
      const normalized = phone.replace(/[\s()-]/g, "");
      if (!/^\+[1-9]\d{7,14}$/.test(normalized))
        throw new Error(
          "Include your country code, for example +91 followed by your number.",
        );
      const { error } = link
        ? await supabase!.auth.updateUser({ phone: normalized })
        : await supabase!.auth.signInWithOtp({
            phone: normalized,
            options: { shouldCreateUser: true },
          });
      if (error) throw error;
      setPhone(normalized);
      setSent(true);
      setCooldown(60);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  async function verify() {
    setBusy(true);
    setError("");
    try {
      const { error } = await supabase!.auth.verifyOtp({
        phone,
        token: code,
        type: link ? "phone_change" : "sms",
      });
      if (error) throw error;
      onVerified?.();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void (sent ? verify() : request());
      }}
      className="phone-form"
    >
      <label>
        Phone number
        <input
          type="tel"
          autoComplete="tel"
          value={phone}
          disabled={sent || busy}
          onChange={(e) => setPhone(e.target.value)}
          placeholder="+91 98765 43210"
          required
        />
      </label>
      {sent && (
        <>
          <p className="muted">Enter the verification code sent by SMS.</p>
          <label>
            Verification code
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6,8}"
              minLength={6}
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
              required
              autoFocus
            />
          </label>
        </>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      <button className="button primary full" disabled={busy}>
        {busy ? (
          <Spinner />
        ) : sent ? (
          "Verify and continue"
        ) : link ? (
          "Send verification code"
        ) : (
          "Continue with phone"
        )}
      </button>
      {sent && (
        <div className="phone-options">
          <button
            type="button"
            className="text-button"
            disabled={busy || cooldown > 0}
            onClick={() => void request()}
          >
            {cooldown ? `Resend in ${cooldown}s` : "Resend code"}
          </button>
          <button
            type="button"
            className="text-button"
            disabled={busy}
            onClick={() => {
              setSent(false);
              setCode("");
              setError("");
            }}
          >
            Change number
          </button>
        </div>
      )}
      <p className="phone-privacy">
        <ShieldCheck size={15} /> Your number is never shown on either profile.
      </p>
    </form>
  );
}
export function PhoneGate({
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
      const status = await call<{ phone_verified: boolean }>("account_status");
      setVerified(status.phone_verified);
    } catch (e) {
      setError(errorText(e));
    }
  }
  useEffect(() => {
    void check();
  }, []);
  if (verified) return <>{children}</>;
  return (
    <main className="phone-gate">
      <Brand />
      <div className="phone-card">
        <div className="phone-symbol">
          <Phone size={27} />
        </div>
        <h1>
          One account.
          <br />
          Two ways to be you.
        </h1>
        <p className="muted">
          Verify your phone to join Kindred. Your account stays accountable,
          even when you choose to be anonymous.
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
          <PhoneForm link onVerified={() => void check()} />
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
