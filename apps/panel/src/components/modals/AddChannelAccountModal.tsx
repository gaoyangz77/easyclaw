import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Modal } from "./Modal.js";
import { Select } from "../inputs/Select.js";
import { trackEvent } from "../../api/index.js";
import { useEntityStore } from "../../store/EntityStoreProvider.js";
import { CHANNEL_SCHEMAS } from "../../lib/channel-schemas.js";
import { TagInput } from "../inputs/TagInput.js";

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
  const entityStore = useEntityStore();
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
        const raw = existingAccount.config[field.id];
        if (field.type === "tags" && Array.isArray(raw)) {
          initialData[field.id] = (raw as any[]).map(String);
        } else if (field.type === "tags" && raw && typeof raw === "object" && !Array.isArray(raw)) {
          // OpenClaw stores some tags fields (e.g. "groups") as Record<string, {}>.
          // Convert object keys back to a string array for the TagInput.
          initialData[field.id] = Object.keys(raw as Record<string, unknown>);
        } else {
          initialData[field.id] = raw;
        }
      } else if (field.defaultValue !== undefined) {
        initialData[field.id] = field.defaultValue;
      } else {
        initialData[field.id] = field.type === "tags" ? [] : "";
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
    // No schema = name-only edit (e.g. QR login channels like WeChat)
    if (!schema) {
      if (!isEdit) {
        setError(t("channels.errorChannelNotSupported", { channelId }));
        return;
      }
      setSaving(true);
      setError(null);
      try {
        await entityStore.channelManager.updateAccount(channelId, existingAccount!.accountId, {
          name: name.trim() || undefined,
          config: {},
        });
        await onSuccess();
        resetForm();
        onClose();
      } catch (err: unknown) {
        setError(String(err));
      } finally {
        setSaving(false);
      }
      return;
    }

    // Validate required fields (skip hidden fields)
    for (const field of schema.fields) {
      if (field.showWhen) {
        const depValue = formData[field.showWhen.field];
        const matches = Array.isArray(field.showWhen.value)
          ? field.showWhen.value.includes(depValue)
          : depValue === field.showWhen.value;
        if (!matches) continue;
      }
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
        // Skip fields hidden by showWhen
        if (field.showWhen) {
          const depValue = formData[field.showWhen.field];
          const matches = Array.isArray(field.showWhen.value)
            ? field.showWhen.value.includes(depValue)
            : depValue === field.showWhen.value;
          if (!matches) return;
        }
        const value = formData[field.id];
        // Tags fields: include as array only if non-empty.
        // The "groups" field must be converted to Record<string, {}> for OpenClaw.
        if (field.type === "tags") {
          if (Array.isArray(value) && value.length > 0) {
            if (field.id === "groups") {
              const groupsObj: Record<string, Record<string, never>> = {};
              for (const id of value) {
                groupsObj[id] = {};
              }
              config[field.id] = groupsObj;
            } else {
              config[field.id] = value;
            }
          }
          return;
        }
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
        await entityStore.channelManager.updateAccount(channelId, existingAccount!.accountId, {
          name: name.trim() || undefined,
          config,
          secrets: Object.keys(secrets).length > 0 ? secrets : undefined,
        });
      } else {
        const accountId = `acct_${Date.now().toString(36)}`;
        await entityStore.channelManager.createAccount({
          channelId,
          accountId,
          name: name.trim() || undefined,
          config,
          secrets,
        });
        trackEvent("channel.account_added", { channelType: channelId });
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

  // No schema: name-only edit for QR login channels, or error for unknown channels
  if (!schema) {
    if (!isEdit) {
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
        title={t("channels.modalTitleEdit", { channel: channelLabel })}
        maxWidth={500}
      >
        <div className="modal-form-col modal-form-relative">
          {saving && (
            <div className="modal-saving-overlay">
              <div className="modal-saving-spinner" />
              <span>{t("channels.buttonSaving")}</span>
            </div>
          )}
          <div className="form-group">
            <label className="form-label-block">{t("channels.fieldDisplayName")}</label>
            <input
              type="text"
              className="input-full"
              placeholder={t("channels.fieldDisplayNamePlaceholder")}
              value={name}
              onChange={e => setName(e.target.value)}
            />
          </div>
          {error && <div className="modal-error-box">{error}</div>}
          <div className="modal-actions">
            <button className="btn btn-secondary" onClick={handleCancel}>{t("channels.buttonCancel")}</button>
            <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? t("channels.buttonSaving") : t("channels.buttonUpdate")}
            </button>
          </div>
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
        {schema.fields.filter(field => {
          if (!field.showWhen) return true;
          const depValue = formData[field.showWhen.field];
          if (Array.isArray(field.showWhen.value)) {
            return field.showWhen.value.includes(depValue);
          }
          return depValue === field.showWhen.value;
        }).map(field => (
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
            ) : field.type === "tags" ? (
              <TagInput
                tags={Array.isArray(formData[field.id]) ? formData[field.id] as string[] : []}
                onChange={(tags) => setFormData({...formData, [field.id]: tags})}
                placeholder={field.placeholder ? t(field.placeholder) : ""}
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
