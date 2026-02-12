import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { fetchSettings, updateSettings } from "../api.js";
import type { SttProvider } from "@easyclaw/core";
import { Select } from "../components/Select.js";

export function SttPage() {
  const { t, i18n } = useTranslation();
  const defaultProvider: SttProvider = i18n.language === "zh" ? "volcengine" : "groq";
  const [enabled, setEnabled] = useState(false);
  const [provider, setProvider] = useState<SttProvider>(defaultProvider);
  const [groqApiKey, setGroqApiKey] = useState("");
  const [volcengineAppKey, setVolcengineAppKey] = useState("");
  const [volcengineAccessKey, setVolcengineAccessKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasGroqKey, setHasGroqKey] = useState(false);
  const [hasVolcengineKeys, setHasVolcengineKeys] = useState(false);

  useEffect(() => {
    loadSettings();
  }, []);

  async function loadSettings() {
    try {
      const settings = await fetchSettings();
      setEnabled(settings["stt.enabled"] === "true");
      setProvider((settings["stt.provider"] as SttProvider) || defaultProvider);

      // Check if credentials exist in keychain
      try {
        const credentialsRes = await fetch("/api/stt/credentials");
        if (credentialsRes.ok) {
          const contentType = credentialsRes.headers.get("content-type");
          if (contentType?.includes("application/json")) {
            const credentials = await credentialsRes.json() as { groq: boolean; volcengine: boolean };
            setHasGroqKey(credentials.groq);
            setHasVolcengineKeys(credentials.volcengine);
          }
        }
      } catch (credErr) {
        // Silently ignore credential check errors (might happen if desktop app isn't running yet)
        console.warn("Failed to check credentials:", credErr);
      }

      setError(null);
    } catch (err) {
      setError(t("stt.failedToLoad") + String(err));
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSaved(false);

    try {
      // Validate credentials
      if (enabled) {
        if (provider === "groq" && !groqApiKey.trim()) {
          setError(t("stt.groqApiKeyRequired"));
          setSaving(false);
          return;
        }
        if (provider === "volcengine") {
          if (!volcengineAppKey.trim() || !volcengineAccessKey.trim()) {
            setError(t("stt.volcengineKeysRequired"));
            setSaving(false);
            return;
          }
        }
      }

      // Save settings
      await updateSettings({
        "stt.enabled": enabled.toString(),
        "stt.provider": provider,
      });

      // Save credentials to keychain (via API)
      if (enabled) {
        if (provider === "groq" && groqApiKey.trim()) {
          const res = await fetch("/api/stt/credentials", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "groq",
              apiKey: groqApiKey.trim(),
            }),
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to save Groq credentials: ${res.status} ${errorText}`);
          }

          setHasGroqKey(true);
          setGroqApiKey(""); // Clear after save
        }
        if (provider === "volcengine" && volcengineAppKey.trim() && volcengineAccessKey.trim()) {
          const res = await fetch("/api/stt/credentials", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              provider: "volcengine",
              appKey: volcengineAppKey.trim(),
              accessKey: volcengineAccessKey.trim(),
            }),
          });

          if (!res.ok) {
            const errorText = await res.text();
            throw new Error(`Failed to save Volcengine credentials: ${res.status} ${errorText}`);
          }

          setHasVolcengineKeys(true);
          setVolcengineAppKey(""); // Clear after save
          setVolcengineAccessKey("");
        }
      }

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      setError(t("stt.failedToSave") + String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div>
      <h1>{t("stt.title")}</h1>
      <p>{t("stt.description")}</p>

      {error && (
        <div className="error-alert">{error}</div>
      )}

      <div className="section-card" style={{ maxWidth: 680 }}>
        {/* Enable toggle */}
        <div className="form-group">
          <label className="stt-checkbox-label">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
            />
            <span className="stt-enable-text">{t("stt.enableStt")}</span>
          </label>
          <p className="form-help" style={{ margin: "6px 0 0 24px" }}>{t("stt.enableHelp")}</p>
        </div>

        {enabled && (
          <>
            {/* Provider select */}
            <div className="form-group">
              <div className="form-label">{t("stt.provider")}</div>
              <Select
                value={provider}
                onChange={(v) => setProvider(v as SttProvider)}
                options={[
                  { value: "groq", label: "Groq (Whisper)" },
                  { value: "volcengine", label: "Volcengine (\u706B\u5C71\u5F15\u64CE)" },
                ]}
              />
              <p className="form-help">{t("stt.providerHelp")}</p>
            </div>

            {/* Groq credentials */}
            {provider === "groq" && (
              <div className="form-group">
                <div className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  {t("stt.groqApiKey")}
                  {hasGroqKey && !groqApiKey && (
                    <span className="badge-saved">
                      ✓ {t("stt.keySaved")}
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  className="input-full input-mono"
                  value={groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder={hasGroqKey ? `${t("stt.groqApiKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.groqApiKeyPlaceholder")}
                />
                <p className="form-help">
                  {t("stt.groqHelp")}{" "}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    console.groq.com/keys
                  </a>
                </p>
              </div>
            )}

            {/* Volcengine credentials */}
            {provider === "volcengine" && (
              <>
                <div className="info-box info-box-blue">
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>{t("stt.volcengineFreeTier")}</span>
                    <a
                      href="https://console.volcengine.com/speech/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="font-medium"
                    >
                      {t("stt.volcentineFreeLink")}
                    </a>
                    <span style={{ position: "relative", display: "inline-block" }}>
                      <span
                        className="volcengine-help-trigger stt-help-icon"
                      >
                        ?
                      </span>
                      <div className="volcengine-help-tooltip">
                        <div style={{ fontWeight: 600, marginBottom: 6 }}>{t("stt.volcengineStepsTitle")}</div>
                        <div>{t("stt.volcengineStep1")}</div>
                        <div>{t("stt.volcengineStep2")}</div>
                        <div>{t("stt.volcengineStep3")}</div>
                      </div>
                    </span>
                  </div>
                </div>

                <div style={{ marginBottom: 12 }}>
                  <div className="form-label" style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    {t("stt.volcengineAppKey")}
                    {hasVolcengineKeys && !volcengineAppKey && (
                      <span className="badge-saved">
                        ✓ {t("stt.keySaved")}
                      </span>
                    )}
                  </div>
                  <input
                    type="password"
                    className="input-full input-mono"
                    value={volcengineAppKey}
                    onChange={(e) => setVolcengineAppKey(e.target.value)}
                    placeholder={hasVolcengineKeys ? `${t("stt.volcengineAppKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.volcengineAppKeyPlaceholder")}
                  />
                </div>

                <div className="form-group">
                  <div className="form-label">{t("stt.volcengineAccessKey")}</div>
                  <input
                    type="password"
                    className="input-full input-mono"
                    value={volcengineAccessKey}
                    onChange={(e) => setVolcengineAccessKey(e.target.value)}
                    placeholder={hasVolcengineKeys ? `${t("stt.volcengineAccessKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.volcengineAccessKeyPlaceholder")}
                  />
                </div>

                <p className="form-help" style={{ margin: "0 0 16px" }}>
                  {t("stt.volcengineHelp")}{" "}
                  <a
                    href="https://console.volcengine.com/speech/app"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    console.volcengine.com/speech/app
                  </a>
                </p>
              </>
            )}
          </>
        )}

        {/* Save button */}
        <div className="form-actions">
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t("common.loading") : (
              (enabled && ((provider === "groq" && hasGroqKey) || (provider === "volcengine" && hasVolcengineKeys)))
                ? t("stt.update")
                : t("common.save")
            )}
          </button>
          {saved && <span className="text-success">{t("common.saved")}</span>}
        </div>
      </div>

      {/* Info section */}
      <div className="section-card" style={{ maxWidth: 680 }}>
        <h3>{t("stt.whatIsStt")}</h3>
        <p className="text-secondary" style={{ fontSize: 13, marginBottom: 12 }}>{t("stt.sttExplanation")}</p>
        <ul className="text-secondary" style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.8 }}>
          <li>{t("stt.feature1")}</li>
          <li>{t("stt.feature2")}</li>
          <li>{t("stt.feature3")}</li>
        </ul>
      </div>
    </div>
  );
}
