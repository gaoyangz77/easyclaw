import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { useAuth } from "../../providers/AuthProvider.js";
import { formatError } from "@rivonclaw/core";
import { Modal } from "./Modal.js";
import { useToast } from "../Toast.js";

/** Map known backend error messages to i18n keys. */
const AUTH_ERROR_MAP: Record<string, string> = {
  "Email already registered": "auth.errorEmailTaken",
  "Invalid email or password": "auth.errorInvalidCredentials",
  "Login failed": "auth.errorLoginFailed",
  "Registration failed": "auth.errorRegisterFailed",
};

function translateAuthError(err: unknown, t: TFunction): string {
  const raw = formatError(err);
  const key = AUTH_ERROR_MAP[raw];
  return key ? t(key) : raw;
}

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Called after successful login/register (e.g. to navigate to a gated page). */
  onSuccess?: () => void;
}

function validatePassword(password: string): string | null {
  if (password.length < 8) return "passwordTooShort";
  if (!/[A-Z]/.test(password)) return "passwordNeedsUpper";
  if (!/[a-z]/.test(password)) return "passwordNeedsLower";
  if (!/[0-9]/.test(password)) return "passwordNeedsNumber";
  return null;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (!isOpen) {
      setActiveTab("login");
      setEmail("");
      setPassword("");
      setConfirmPassword("");
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  // Clear confirm password and errors when switching tabs
  function switchTab(tab: "login" | "register") {
    setActiveTab(tab);
    setError(null);
    setConfirmPassword("");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (activeTab === "register") {
      const pwError = validatePassword(password);
      if (pwError) {
        setError(t(`auth.${pwError}`));
        return;
      }
      if (password !== confirmPassword) {
        setError(t("auth.passwordMismatch"));
        return;
      }
    }

    setSubmitting(true);
    try {
      if (activeTab === "login") {
        await login({ email, password });
        showToast(t("auth.loginSuccess"));
      } else {
        await register({ email, password, name: null });
        showToast(t("auth.registerSuccess"));
      }
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(translateAuthError(err, t));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("auth.title")} maxWidth={420}>
      <div className="auth-modal-form">
        <p className="auth-subtitle">{t("auth.subtitle")}</p>

        <div className="tab-bar tab-bar--spread" role="tablist">
          <button
            className={`tab-btn${activeTab === "login" ? " tab-btn-active" : ""}`}
            onClick={() => switchTab("login")}
            role="tab"
            aria-selected={activeTab === "login"}
          >
            {t("auth.login")}
          </button>
          <button
            className={`tab-btn${activeTab === "register" ? " tab-btn-active" : ""}`}
            onClick={() => switchTab("register")}
            role="tab"
            aria-selected={activeTab === "register"}
          >
            {t("auth.register")}
          </button>
        </div>

        {error && <div className="error-alert">{error}</div>}

        <form onSubmit={handleSubmit} className="auth-form">
          <label className="form-label-block">
            {t("auth.email")}
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              autoComplete="email"
              className="auth-input"
            />
          </label>

          <label className="form-label-block">
            {t("auth.password")}
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              autoComplete={activeTab === "login" ? "current-password" : "new-password"}
              className="auth-input"
            />
            {activeTab === "register" && (
              <span className="form-hint">{t("auth.passwordHint")}</span>
            )}
          </label>

          {activeTab === "register" && (
            <>
              <label className="form-label-block">
                {t("auth.confirmPassword")}
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  autoComplete="new-password"
                  className="auth-input"
                />
              </label>
            </>
          )}

          <button
            type="submit"
            className="btn btn-primary auth-submit-btn"
            disabled={submitting}
          >
            {submitting
              ? t("common.loading")
              : activeTab === "login"
                ? t("auth.loginAction")
                : t("auth.registerAction")}
          </button>
        </form>
      </div>
    </Modal>
  );
}
