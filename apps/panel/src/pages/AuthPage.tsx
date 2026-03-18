import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../providers/AuthProvider.js";
import { formatError } from "@rivonclaw/core";

export function AuthPage({ onNavigate }: { onNavigate: (path: string) => void }) {
  const { t } = useTranslation();
  const { login, register } = useAuth();
  const [activeTab, setActiveTab] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (activeTab === "login") {
        await login({ email, password });
      } else {
        await register({ email, password, name: name || null });
      }
      onNavigate("/");
    } catch (err) {
      setError(formatError(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="page-enter auth-page">
      <div className="auth-page-container">
        <div className="section-card auth-card">
          <h1>{t("auth.title")}</h1>
          <p className="auth-subtitle">{t("auth.subtitle")}</p>

          <div className="tab-bar tab-bar--spread" role="tablist">
            <button
              className={`tab-btn${activeTab === "login" ? " tab-btn-active" : ""}`}
              onClick={() => { setActiveTab("login"); setError(null); }}
              role="tab"
              aria-selected={activeTab === "login"}
            >
              {t("auth.login")}
            </button>
            <button
              className={`tab-btn${activeTab === "register" ? " tab-btn-active" : ""}`}
              onClick={() => { setActiveTab("register"); setError(null); }}
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
            </label>

            {activeTab === "register" && (
              <label className="form-label-block">
                {t("auth.name")}
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  autoComplete="name"
                  className="auth-input"
                />
                <span className="form-hint">{t("auth.nameHint")}</span>
              </label>
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
      </div>
    </div>
  );
}
