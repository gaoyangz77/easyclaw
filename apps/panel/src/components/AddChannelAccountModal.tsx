import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { Select } from "./Select.js";
import { createChannelAccount, updateChannelAccount } from "../api/index.js";
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
  onSuccess: () => Promise<void>;
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

  const [name, setName] = useState(existingAccount?.name || "");
  const [formData, setFormData] = useState<Record<string, any>>({});
  const [enabled, setEnabled] = useState((existingAccount?.config.enabled as boolean) ?? true);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initialize form data when channel or existing account changes
  useEffect(() => {
    if (!schema) return;

    // Update name and enabled state
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
    setName("");
    setEnabled(true);
    setFormData({});
    setError(null);
    setSaving(false);
  }

  async function handleSave() {
    // Validation
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
        await updateChannelAccount(channelId, existingAccount!.accountId, {
          name: name.trim() || undefined,
          config,
          secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
        });
      } else {
        const accountId = `acct_${Date.now().toString(36)}`;
        await createChannelAccount({
          channelId,
          accountId,
          name: name.trim() || undefined,
          config,
          secrets,
        });
      }

      // Wait for parent to confirm gateway has reloaded
      await onSuccess();

      resetForm();
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
            className="btn btn-primary error-alert-actions"
            onClick={handleCancel}
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
      <div className="modal-form-col modal-form-relative">
        {saving && (
          <div className="modal-saving-overlay">
            <div className="modal-saving-spinner" />
            <span>{t("channels.buttonSaving")}</span>
          </div>
        )}
        {/* Display Name */}
        <div>
          <label className="form-label-block">
            {t("channels.fieldDisplayName")}
          </label>
          <input
            type="text"
            name="displayName"
            autoComplete="off"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("channels.fieldDisplayNamePlaceholder")}
            className="input-full"
          />
          <div className="form-hint">
            {t("channels.fieldDisplayNameHint")}
          </div>
        </div>

        {/* Dynamic channel-specific fields */}
        {schema.fields.map(field => (
          <div key={field.id}>
            <label className="form-label-block">
              {t(field.label)}{field.required && !isEdit && " *"}
              {field.required && isEdit && field.isSecret && ""}
            </label>
            {field.type === "select" ? (
              <Select
                value={formData[field.id] || ""}
                onChange={(v) => setFormData({...formData, [field.id]: v})}
                options={(field.options ?? []).map(opt => ({
                  value: opt.value,
                  label: opt.label.startsWith("channels.") ? t(opt.label) : opt.label,
                }))}
              />
            ) : field.type === "textarea" ? (
              <textarea
                value={formData[field.id] || ""}
                onChange={(e) => setFormData({...formData, [field.id]: e.target.value})}
                placeholder={field.placeholder ? t(field.placeholder) : ""}
                rows={4}
                className="input-full textarea-resize-vertical"
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
                className={`input-full${field.type === "password" ? " input-mono" : ""}`}
              />
            )}
            {field.hint && (
              <div className="form-hint">
                {t(field.hint)}
              </div>
            )}
          </div>
        ))}

        {/* Enabled Toggle (if supported by channel) */}
        {schema.commonFields?.enabled && (
          <div className="form-checkbox-row">
            <input
              type="checkbox"
              id="enabled"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              className="checkbox-sm"
            />
            <label htmlFor="enabled" className="form-checkbox-label">
              {t("channels.fieldEnableAccount")}
            </label>
          </div>
        )}

        {/* Error Display */}
        {error && (
          <div className="modal-error-box">
            <strong>{t("channels.errorLabel")}</strong> {error}
          </div>
        )}

        {/* Action Buttons */}
        <div className="modal-actions">
          <button
            className="btn btn-secondary"
            onClick={handleCancel}
            disabled={saving}
          >
            {t("channels.buttonCancel")}
          </button>
          <button
            className="btn btn-primary"
            onClick={handleSave}
            disabled={saving}
          >
            {saving ? t("channels.buttonSaving") : isEdit ? t("channels.buttonUpdate") : t("channels.buttonCreate")}
          </button>
        </div>
      </div>
    </Modal>
  );
}
