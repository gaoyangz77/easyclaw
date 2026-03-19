import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useMutation } from "@apollo/client/react";
import type { TFunction } from "i18next";
import { GQL } from "@rivonclaw/core";
import { useAuth } from "../../providers/AuthProvider.js";
import { REQUEST_CAPTCHA } from "../../api/auth-queries.js";
import { formatError } from "@rivonclaw/core";
import { Modal } from "./Modal.js";
import { useToast } from "../Toast.js";
import { EyeIcon, EyeOffIcon, RefreshIcon } from "../icons.js";
import { EXTERNAL_LINKS } from "../../lib/external-links.js";

/** Map known backend error messages to i18n keys. */
const AUTH_ERROR_MAP: Record<string, string> = {
  "Email already registered": "auth.errorEmailTaken",
  "Invalid email or password": "auth.errorInvalidCredentials",
  "Login failed": "auth.errorLoginFailed",
  "Registration failed": "auth.errorRegisterFailed",
  "Captcha expired or invalid": "auth.captchaExpired",
  "Incorrect captcha": "auth.captchaError",
  "Too many captcha attempts": "auth.captchaExpired",
  "Email not registered": "auth.errorEmailNotRegistered",
};

/** Error messages that indicate the email is not registered — triggers auto-register. */
const AUTO_REGISTER_ERRORS = new Set([
  "Email not registered",
  "Invalid email or password",
]);

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

/** Compute password strength checks for the strength indicator. */
function getPasswordChecks(pw: string) {
  return {
    length: pw.length >= 8,
    upper: /[A-Z]/.test(pw),
    lower: /[a-z]/.test(pw),
    number: /[0-9]/.test(pw),
  };
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const { showToast } = useToast();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAnswer, setCaptchaAnswer] = useState("");
  const [captchaSvg, setCaptchaSvg] = useState("");
  const [captchaError, setCaptchaError] = useState(false);

  const [requestCaptcha] = useMutation<{ requestCaptcha: GQL.CaptchaResponse }>(REQUEST_CAPTCHA);

  const pwChecks = useMemo(() => getPasswordChecks(password), [password]);
  const pwStrength = useMemo(() => {
    const passed = Object.values(pwChecks).filter(Boolean).length;
    return passed; // 0-4
  }, [pwChecks]);

  const refreshCaptcha = useCallback(async () => {
    setCaptchaAnswer("");
    setCaptchaError(false);
    try {
      const { data } = await requestCaptcha();
      if (data?.requestCaptcha) {
        setCaptchaToken(data.requestCaptcha.token);
        setCaptchaSvg(data.requestCaptcha.svg);
      } else {
        setCaptchaError(true);
      }
    } catch {
      setCaptchaError(true);
    }
  }, [requestCaptcha]);

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      refreshCaptcha();
    } else {
      setActiveTab("login");
      setEmail("");
      setPassword("");
      setShowPassword(false);
      setError(null);
      setSubmitting(false);
      setCaptchaToken("");
      setCaptchaAnswer("");
      setCaptchaSvg("");
      setCaptchaError(false);
    }
  }, [isOpen, refreshCaptcha]);

  // Clear errors when switching tabs, reset password visibility
  function switchTab(tab: "login" | "register") {
    setActiveTab(tab);
    setError(null);
    setShowPassword(false);
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
    }

    setSubmitting(true);
    try {
      if (activeTab === "login") {
        try {
          await login({ email, password, captchaToken, captchaAnswer });
          showToast(t("auth.loginSuccess"));
        } catch (loginErr) {
          const raw = formatError(loginErr);
          // Auto-register: if login fails because account doesn't exist,
          // switch to register tab and prompt user to submit again
          if (AUTO_REGISTER_ERRORS.has(raw)) {
            setActiveTab("register");
            setError(t("auth.autoRegisterNotice"));
            refreshCaptcha();
            setSubmitting(false);
            return;
          }
          throw loginErr;
        }
      } else {
        await register({ email, password, name: null, captchaToken, captchaAnswer });
        showToast(t("auth.registerSuccess"));
      }
      onClose();
      onSuccess?.();
    } catch (err) {
      setError(translateAuthError(err, t));
      refreshCaptcha();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal isOpen={isOpen} onClose={onClose} title={t("auth.title")} maxWidth={400}>
      <div className="auth-modal-form">
        <p className="auth-subtitle">
          {activeTab === "login" ? t("auth.subtitle") : t("auth.subtitleRegister")}
        </p>

        <div className="auth-tab-pill" role="tablist">
          <button
            className={`auth-tab-pill-btn${activeTab === "login" ? " auth-tab-pill-btn--active" : ""}`}
            onClick={() => switchTab("login")}
            role="tab"
            aria-selected={activeTab === "login"}
            type="button"
          >
            {t("auth.login")}
          </button>
          <button
            className={`auth-tab-pill-btn${activeTab === "register" ? " auth-tab-pill-btn--active" : ""}`}
            onClick={() => switchTab("register")}
            role="tab"
            aria-selected={activeTab === "register"}
            type="button"
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
              maxLength={254}
              autoComplete="email"
              className="auth-input"
            />
          </label>

          <div className="auth-password-field">
            <div className="auth-password-header">
              <span className="form-label-block">{t("auth.password")}</span>
              {activeTab === "login" && (
                <button type="button" className="auth-forgot-link" tabIndex={-1} onClick={() => showToast(t("auth.forgotPasswordHint"))}>
                  {t("auth.forgotPassword")}
                </button>
              )}
            </div>
            <div className="auth-input-wrap">
              <input
                type={showPassword ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                maxLength={72}
                autoComplete={activeTab === "login" ? "current-password" : "new-password"}
                className="auth-input auth-input--has-toggle"
              />
              <button
                type="button"
                className="auth-pw-toggle"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={t("auth.showPassword")}
                tabIndex={-1}
              >
                {showPassword ? <EyeOffIcon /> : <EyeIcon />}
              </button>
            </div>
            {activeTab === "register" && password.length > 0 && (
              <div className="auth-strength">
                <div className="auth-strength-bar">
                  <div
                    className={`auth-strength-fill auth-strength--${pwStrength <= 1 ? "weak" : pwStrength <= 2 ? "fair" : pwStrength <= 3 ? "good" : "strong"}`}
                    style={{ width: `${(pwStrength / 4) * 100}%` }}
                  />
                </div>
                <span className={`auth-strength-label auth-strength--${pwStrength <= 1 ? "weak" : pwStrength <= 2 ? "fair" : pwStrength <= 3 ? "good" : "strong"}`}>
                  {t(`auth.strength${pwStrength <= 1 ? "Weak" : pwStrength <= 2 ? "Fair" : pwStrength <= 3 ? "Good" : "Strong"}`)}
                </span>
              </div>
            )}
          </div>

          <div className="captcha-row">
            <div className="captcha-row-input">
              <input
                type="text"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                required
                maxLength={4}
                placeholder={t("auth.captchaPlaceholder")}
                className="auth-input"
                autoComplete="off"
              />
            </div>
            <div className="captcha-row-image">
              {captchaSvg ? (
                <div className="captcha-svg" dangerouslySetInnerHTML={{ __html: captchaSvg }} />
              ) : (
                <div className="captcha-svg captcha-placeholder" onClick={refreshCaptcha}>
                  {captchaError ? "!" : "..."}
                </div>
              )}
              <button type="button" className="captcha-row-refresh" onClick={refreshCaptcha} aria-label={t("auth.captchaRefresh")}>
                <RefreshIcon />
              </button>
            </div>
          </div>

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

          <p className="auth-terms-notice">
            {t("auth.agreeTermsPrefix")}
            <a href={EXTERNAL_LINKS.termsOfService} target="_blank" rel="noopener noreferrer" className="auth-terms-link">
              {t("auth.termsOfService")}
            </a>
            {t("auth.agreeTermsMiddle")}
            <a href={EXTERNAL_LINKS.privacyPolicy} target="_blank" rel="noopener noreferrer" className="auth-terms-link">
              {t("auth.privacyPolicy")}
            </a>
          </p>
        </form>
      </div>
    </Modal>
  );
}
