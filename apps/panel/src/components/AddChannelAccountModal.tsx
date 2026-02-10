import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { createChannelAccount, updateChannelAccount } from "../api.js";
import { CHANNEL_SCHEMAS } from "../channel-schemas.js";

export interface AddChannelAccountModalProps {
  isOpen: boolean;
  onClose: () => void;
  channelId: string;
  channelLabel: string;
  existingAccount?: {
    accountId: string;
    name?: string;
    config: Record<string, unknown>;
  };
  onSuccess: () => void;
}

export function AddChannelAccountModal({
  isOpen,
  onClose,
  channelId,
  channelLabel,
  existingAccount,
  onSuccess,
}: AddChannelAccountModalProps) {
  const { t } = useTranslation();
  const isEdit = !!existingAccount;
  const schema = CHANNEL_SCHEMAS[channelId];

  const [accountId, setAccountId] = useState(existingAccount?.accountId || "");
  const [name, setName] = useState(existingAccount?.name || "");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [enabled, setEnabled] = useState((existingAccount?.config.enabled as boolean) ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form data when channel or existing account changes
  useEffect(() => {
    if (!schema) return;

    // Update account ID, name, and enabled state
    setAccountId(existingAccount?.accountId || "");
    setName(existingAccount?.name || "");
    setEnabled((existingAccount?.config.enabled as boolean) ?? true);

    const initialData: Record<string, any> = {};
    schema.fields.forEach(field => {
      if (existingAccount?.config[field.id] !== undefined) {
        initialData[field.id] = existingAccount.config[field.id];
      } else if (field.defaultValue !== undefined) {
        initialData[field.id] = field.defaultValue;
      } else {
        initialData[field.id] = "";
      }
    });
    setFormData(initialData);
  }, [channelId, existingAccount, schema]);

  function resetForm() {
    setAccountId("");
    setName("");
    setEnabled(true);
    setFormData({});
    setError(null);
    setSaving(false);
  }

  async function handleSave() {
    // Validation
    if (!accountId.trim()) {
      setError(t("channels.errorAccountIdRequired"));
      return;
    }

    if (!schema) {
      setError(t("channels.errorChannelNotSupported", { channelId }));
      return;
    }

    // Validate required fields
    for (const field of schema.fields) {
      if (field.required) {
        const value = formData[field.id];
        // For create mode, always require the field
        // For edit mode with secrets, allow empty (keeps existing value)
        if (!isEdit || !field.isSecret) {
          if (!value || (typeof value === "string" && !value.trim())) {
            setError(t("channels.errorFieldRequired", { field: t(field.label) }));
            return;
          }
        } else if (isEdit && field.isSecret && field.required) {
          // For edit mode with required secrets, at least one secret must be provided on create
          // On edit, we can skip if empty (keeps existing)
          // This is already handled - just don't validate
        }
      }
    }

    setSaving(true);
    setError(null);

    try {
      // Separate config and secrets based on schema
      const config: Record<string, unknown> = {};
      const secrets: Record<string, string> = {};

      // Add enabled flag if schema supports it
      if (schema.commonFields?.enabled) {
        config.enabled = enabled;
      }

      schema.fields.forEach(field => {
        const value = formData[field.id];
        if (value !== undefined && value !== "") {
          if (field.isSecret) {
            secrets[field.id] = String(value);
          } else {
            // Handle boolean conversion for select fields with true/false values
            if (field.type === "select" && (value === "true" || value === "false")) {
              config[field.id] = value === "true";
            } else {
              config[field.id] = value;
            }
          }
        }
      });

      if (isEdit) {
        await updateChannelAccount(channelId, accountId, {
          name: name.trim() || undefined,
          config,
          secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
        });
      } else {
        await createChannelAccount({
          channelId,
          accountId: accountId.trim(),
          name: name.trim() || undefined,
          config,
          secrets,
        });
      }

      resetForm();
      onSuccess();
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  function handleCancel() {
    resetForm();
    onClose();
  }

  // Handle unknown channel
  if (!schema) {
    return (
      <Modal
        isOpen={isOpen}
        onClose={handleCancel}
        title={t("channels.errorLabel")}
        maxWidth={500}
      >
        <div>
          <p>{t("channels.errorChannelNotSupported", { channelId })}</p>
          <button
            className="btn btn-primary"
            onClick={handleCancel}
            style={{ marginTop: 16 }}
          >
            {t("channels.buttonCancel")}
          </button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal
      isOpen={isOpen}
      onClose={handleCancel}
      title={isEdit ? t("channels.modalTitleEdit", { channel: channelLabel }) : t("channels.modalTitleAdd", { channel: channelLabel })}
      maxWidth={600}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {/* Account ID */}
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#666", marginBottom: 6 }}>
            {t("channels.fieldAccountIdRequired")}
          </label>
          <input
            type="text"
            name="accountId"
            autoComplete="off"
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
            disabled={isEdit}
            placeholder={t("channels.fieldAccountIdPlaceholder")}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 4,
              border: "1px solid #e0e0e0",
              fontSize: 14,
              backgroundColor: isEdit ? "#f5f5f5" : "#fff",
            }}
          />
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
            {isEdit ? t("channels.fieldAccountIdHintEdit") : t("channels.fieldAccountIdHintCreate")}
          </div>
        </div>

        {/* Display Name */}
        <div>
          <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#666", marginBottom: 6 }}>
            {t("channels.fieldDisplayName")}
          </label>
          <input
            type="text"
            name="displayName"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("channels.fieldDisplayNamePlaceholder")}
            style={{
              width: "100%",
              padding: "8px 12px",
              borderRadius: 4,
              border: "1px solid #e0e0e0",
              fontSize: 14,
            }}
          />
          <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
            {t("channels.fieldDisplayNameHint")}
          </div>
        </div>

        {/* Dynamic channel-specific fields */}
        {schema.fields.map(field => (
          <div key={field.id}>
            <label style={{ display: "block", fontSize: 13, fontWeight: 500, color: "#666", marginBottom: 6 }}>
              {t(field.label)}{field.required && !isEdit && " *"}
              {field.required && isEdit && field.isSecret && ""}
            </label>
            {field.type === "select" ? (
              <select
                value={formData[field.id] || ""}
                onChange={(e) => setFormData({...formData, [field.id]: e.target.value})}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "1px solid #e0e0e0",
                  fontSize: 14,
                  backgroundColor: "#fff",
                }}
              >
                {field.options?.map(opt => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label.startsWith("channels.") ? t(opt.label) : opt.label}
                  </option>
                ))}
              </select>
            ) : field.type === "textarea" ? (
              <textarea
                value={formData[field.id] || ""}
                onChange={(e) => setFormData({...formData, [field.id]: e.target.value})}
                placeholder={field.placeholder ? t(field.placeholder) : ""}
                rows={4}
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "1px solid #e0e0e0",
                  fontSize: 14,
                  resize: "vertical",
                }}
              />
            ) : (
              <input
                type={field.type}
                name={field.id}
                autoComplete={field.type === "password" ? "off" : undefined}
                value={formData[field.id] || ""}
                onChange={(e) => setFormData({...formData, [field.id]: e.target.value})}
                placeholder={
                  field.placeholder
                    ? t(field.placeholder)
                    : isEdit && field.isSecret
                    ? t("channels.fieldBotTokenPlaceholderEdit")
                    : ""
                }
                style={{
                  width: "100%",
                  padding: "8px 12px",
                  borderRadius: 4,
                  border: "1px solid #e0e0e0",
                  fontSize: 14,
                  fontFamily: field.type === "password" ? "monospace" : "inherit",
                }}
              />
            )}
            {field.hint && (
              <div style={{ fontSize: 11, color: "#888", marginTop: 4 }}>
                {t(field.hint)}
              </div>
            )}
          </div>
        ))}

        {/* Enabled Toggle (if supported by channel) */}
        {schema.commonFields?.enabled && (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              style={{ width: 16, height: 16 }}
            />
            <label htmlFor="enabled" style={{ fontSize: 13, fontWeight: 500, color: "#666", cursor: "pointer" }}>
              {t("channels.fieldEnableAccount")}
            </label>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div
            style={{
              padding: "12px",
              backgroundColor: "#ffebee",
              color: "#c62828",
              borderRadius: 4,
              fontSize: 13,
              borderLeft: "3px solid #f44336",
            }}
          >
            <strong>{t("channels.errorLabel")}</strong> {error}
          </div>
        )}

        {/* Action Buttons */}
        <div style={{ display: "flex", gap: 12, justifyContent: "flex-end", marginTop: 8 }}>
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
            disabled={saving}
            style={{ padding: "8px 16px", fontSize: 14 }}
          >
            {t("channels.buttonCancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
            style={{ padding: "8px 16px", fontSize: 14 }}
          >
            {saving ? t("channels.buttonSaving") : isEdit ? t("channels.buttonUpdate") : t("channels.buttonCreate")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
