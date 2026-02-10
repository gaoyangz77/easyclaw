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
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}>
            <input
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <span style={{ fontSize: 14, fontWeight: 500 }}>{t("stt.enableStt")}</span>
          </label>
          <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0 24px" }}>{t("stt.enableHelp")}</p>
        </div>

        {enabled && (
          <>
            {/* Provider select */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("stt.provider")}</div>
              <Select
                value={provider}
                onChange={(v) => setProvider(v as SttProvider)}
                options={[
                  { value: "groq", label: "Groq (Whisper)" },
                  { value: "volcengine", label: "Volcengine (\u706B\u5C71\u5F15\u64CE)" },
                ]}
              />
              <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>{t("stt.providerHelp")}</p>
            </div>

            {/* Groq credentials */}
            {provider === "groq" && (
              <div style={{ marginBottom: 16 }}>
                <div style={{ fontSize: 12, marginBottom: 4, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
                  {t("stt.groqApiKey")}
                  {hasGroqKey && !groqApiKey && (
                    <span style={{
                      fontSize: 11,
                      color: "#28a745",
                      backgroundColor: "#d4edda",
                      padding: "2px 8px",
                      borderRadius: 3,
                      fontWeight: 500
                    }}>
                      ✓ {t("stt.keySaved")}
                    </span>
                  )}
                </div>
                <input
                  type="password"
                  value={groqApiKey}
                  onChange={(e) => setGroqApiKey(e.target.value)}
                  placeholder={hasGroqKey ? `${t("stt.groqApiKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.groqApiKeyPlaceholder")}
                  style={{
                    width: "100%",
                    padding: 8,
                    borderRadius: 4,
                    border: "1px solid #e0e0e0",
                    fontSize: 13,
                    fontFamily: "monospace",
                    boxSizing: "border-box",
                  }}
                />
                <p style={{ fontSize: 12, color: "#888", margin: "6px 0 0" }}>
                  {t("stt.groqHelp")}{" "}
                  <a
                    href="https://console.groq.com/keys"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1a73e8", fontSize: 12 }}
                  >
                    console.groq.com/keys
                  </a>
                </p>
              </div>
            )}

            {/* Volcengine credentials */}
            {provider === "volcengine" && (
              <>
                <div style={{
                  marginBottom: 14,
                  padding: "10px 14px",
                  backgroundColor: "#e8f4fd",
                  borderRadius: 6,
                  border: "1px solid #b3d9f2",
                  fontSize: 13,
                  color: "#1a5276",
                  lineHeight: 1.6,
                }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                    <span>{t("stt.volcengineFreeTier")}</span>
                    <a
                      href="https://console.volcengine.com/speech/app"
                      target="_blank"
                      rel="noopener noreferrer"
                      style={{ color: "#1a73e8", fontWeight: 500 }}
                    >
                      {t("stt.volcentineFreeLink")}
                    </a>
                    <span style={{ position: "relative", display: "inline-block" }}>
                      <span
                        className="volcengine-help-trigger"
                        style={{
                          display: "inline-flex",
                          alignItems: "center",
                          justifyContent: "center",
                          width: 18,
                          height: 18,
                          borderRadius: "50%",
                          backgroundColor: "#b3d9f2",
                          color: "#1a5276",
                          fontSize: 12,
                          fontWeight: 600,
                          cursor: "help",
                        }}
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
                  <div style={{ fontSize: 12, marginBottom: 4, color: "#555", display: "flex", alignItems: "center", gap: 8 }}>
                    {t("stt.volcengineAppKey")}
                    {hasVolcengineKeys && !volcengineAppKey && (
                      <span style={{
                        fontSize: 11,
                        color: "#28a745",
                        backgroundColor: "#d4edda",
                        padding: "2px 8px",
                        borderRadius: 3,
                        fontWeight: 500
                      }}>
                        ✓ {t("stt.keySaved")}
                      </span>
                    )}
                  </div>
                  <input
                    type="password"
                    value={volcengineAppKey}
                    onChange={(e) => setVolcengineAppKey(e.target.value)}
                    placeholder={hasVolcengineKeys ? `${t("stt.volcengineAppKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.volcengineAppKeyPlaceholder")}
                    style={{
                      width: "100%",
                      padding: 8,
                      borderRadius: 4,
                      border: "1px solid #e0e0e0",
                      fontSize: 13,
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: 12, marginBottom: 4, color: "#555" }}>{t("stt.volcengineAccessKey")}</div>
                  <input
                    type="password"
                    value={volcengineAccessKey}
                    onChange={(e) => setVolcengineAccessKey(e.target.value)}
                    placeholder={hasVolcengineKeys ? `${t("stt.volcengineAccessKeyPlaceholder")} (${t("stt.keyNotChanged")})` : t("stt.volcengineAccessKeyPlaceholder")}
                    style={{
                      width: "100%",
                      padding: 8,
                      borderRadius: 4,
                      border: "1px solid #e0e0e0",
                      fontSize: 13,
                      fontFamily: "monospace",
                      boxSizing: "border-box",
                    }}
                  />
                </div>

                <p style={{ fontSize: 12, color: "#888", margin: "0 0 16px" }}>
                  {t("stt.volcengineHelp")}{" "}
                  <a
                    href="https://console.volcengine.com/speech/app"
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: "#1a73e8", fontSize: 12 }}
                  >
                    console.volcengine.com/speech/app
                  </a>
                </p>
              </>
            )}
          </>
        )}

        {/* Save button */}
        <div style={{ display: "flex", justifyContent: "flex-end", alignItems: "center", gap: 12, marginTop: 8 }}>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "8px 20px", fontSize: 13 }}
          >
            {saving ? t("common.loading") : (
              (enabled && ((provider === "groq" && hasGroqKey) || (provider === "volcengine" && hasVolcengineKeys)))
                ? t("stt.update")
                : t("common.save")
            )}
          </button>
          {saved && <span style={{ color: "#1e7e34", fontSize: 13 }}>{t("common.saved")}</span>}
        </div>
      </div>

      {/* Info section */}
      <div className="section-card" style={{ maxWidth: 680 }}>
        <h3>{t("stt.whatIsStt")}</h3>
        <p style={{ fontSize: 13, color: "#555", marginBottom: 12 }}>{t("stt.sttExplanation")}</p>
        <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, color: "#555", lineHeight: 1.8 }}>
          <li>{t("stt.feature1")}</li>
          <li>{t("stt.feature2")}</li>
          <li>{t("stt.feature3")}</li>
        </ul>
      </div>
    </div>
  );
}
