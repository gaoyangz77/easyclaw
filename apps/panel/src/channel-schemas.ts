export interface ChannelFieldConfig {
  id: string;                    // Field ID (e.g., "appId")
  label: string;                 // i18n key for label
  type: "text" | "password" | "number" | "select" | "textarea";
  required: boolean;
  placeholder?: string;          // i18n key for placeholder
  hint?: string;                 // i18n key for hint text
  isSecret?: boolean;            // Store in secrets (vs config)
  defaultValue?: string | number;
  options?: Array<{value: string; label: string}>; // For select fields
}

export interface ChannelSchema {
  fields: ChannelFieldConfig[];
  commonFields?: {               // Common fields like dmPolicy, enabled
    dmPolicy?: boolean;
    enabled?: boolean;
  };
}

export const CHANNEL_SCHEMAS: Record<string, ChannelSchema> = {
  telegram: {
    fields: [
      {
        id: "botToken",
        label: "channels.fieldBotToken",
        type: "password",
        required: true,
        placeholder: "channels.fieldBotTokenPlaceholder",
        hint: "channels.fieldBotTokenHintCreate",
        isSecret: true,
      },
      {
        id: "webhookUrl",
        label: "channels.fieldWebhookUrl",
        type: "text",
        required: false,
        placeholder: "channels.fieldWebhookUrlPlaceholder",
        hint: "channels.fieldWebhookUrlHint",
      },
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
          { value: "disabled", label: "channels.dmPolicyDisabled" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  feishu: {
    fields: [
      {
        id: "appId",
        label: "channels.feishuAppId",
        type: "text",
        required: true,
        placeholder: "channels.feishuAppIdPlaceholder",
        hint: "channels.feishuAppIdHint",
      },
      {
        id: "appSecret",
        label: "channels.feishuAppSecret",
        type: "password",
        required: true,
        placeholder: "channels.feishuAppSecretPlaceholder",
        hint: "channels.feishuAppSecretHint",
        isSecret: true,
      },
      {
        id: "domain",
        label: "channels.feishuDomain",
        type: "select",
        required: false,
        defaultValue: "feishu",
        options: [
          { value: "feishu", label: "Feishu (飞书)" },
          { value: "lark", label: "Lark (海外版)" },
        ],
        hint: "channels.feishuDomainHint",
      },
      {
        id: "connectionMode",
        label: "channels.feishuConnectionMode",
        type: "select",
        required: false,
        defaultValue: "websocket",
        options: [
          { value: "websocket", label: "WebSocket" },
          { value: "webhook", label: "Webhook" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  line: {
    fields: [
      {
        id: "channelAccessToken",
        label: "channels.lineChannelAccessToken",
        type: "password",
        required: true,
        placeholder: "channels.lineChannelAccessTokenPlaceholder",
        hint: "channels.lineChannelAccessTokenHint",
        isSecret: true,
      },
      {
        id: "channelSecret",
        label: "channels.lineChannelSecret",
        type: "password",
        required: true,
        placeholder: "channels.lineChannelSecretPlaceholder",
        hint: "channels.lineChannelSecretHint",
        isSecret: true,
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  matrix: {
    fields: [
      {
        id: "homeserver",
        label: "channels.matrixHomeserver",
        type: "text",
        required: true,
        placeholder: "channels.matrixHomeserverPlaceholder",
        hint: "channels.matrixHomeserverHint",
      },
      {
        id: "userId",
        label: "channels.matrixUserId",
        type: "text",
        required: true,
        placeholder: "channels.matrixUserIdPlaceholder",
        hint: "channels.matrixUserIdHint",
      },
      {
        id: "password",
        label: "channels.matrixPassword",
        type: "password",
        required: true,
        placeholder: "channels.matrixPasswordPlaceholder",
        hint: "channels.matrixPasswordHint",
        isSecret: true,
      },
      {
        id: "encryption",
        label: "channels.matrixEncryption",
        type: "select",
        required: false,
        defaultValue: "true",
        options: [
          { value: "true", label: "channels.enabledLabel" },
          { value: "false", label: "channels.disabledLabel" },
        ],
        hint: "channels.matrixEncryptionHint",
      },
    ],
    commonFields: { enabled: true },
  },

  mattermost: {
    fields: [
      {
        id: "botToken",
        label: "channels.mattermostBotToken",
        type: "password",
        required: true,
        placeholder: "channels.mattermostBotTokenPlaceholder",
        hint: "channels.mattermostBotTokenHint",
        isSecret: true,
      },
      {
        id: "baseUrl",
        label: "channels.mattermostBaseUrl",
        type: "text",
        required: true,
        placeholder: "channels.mattermostBaseUrlPlaceholder",
        hint: "channels.mattermostBaseUrlHint",
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  msteams: {
    fields: [
      {
        id: "appId",
        label: "channels.msteamsAppId",
        type: "text",
        required: true,
        placeholder: "channels.msteamsAppIdPlaceholder",
        hint: "channels.msteamsAppIdHint",
      },
      {
        id: "appPassword",
        label: "channels.msteamsAppPassword",
        type: "password",
        required: true,
        placeholder: "channels.msteamsAppPasswordPlaceholder",
        hint: "channels.msteamsAppPasswordHint",
        isSecret: true,
      },
      {
        id: "tenantId",
        label: "channels.msteamsTenantId",
        type: "text",
        required: false,
        placeholder: "channels.msteamsTenantIdPlaceholder",
        hint: "channels.msteamsTenantIdHint",
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  discord: {
    fields: [
      {
        id: "token",
        label: "channels.discordToken",
        type: "password",
        required: true,
        placeholder: "channels.discordTokenPlaceholder",
        hint: "channels.discordTokenHint",
        isSecret: true,
      },
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
          { value: "disabled", label: "channels.dmPolicyDisabled" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  slack: {
    fields: [
      {
        id: "botToken",
        label: "channels.slackBotToken",
        type: "password",
        required: true,
        placeholder: "channels.slackBotTokenPlaceholder",
        hint: "channels.slackBotTokenHint",
        isSecret: true,
      },
      {
        id: "appToken",
        label: "channels.slackAppToken",
        type: "password",
        required: false,
        placeholder: "channels.slackAppTokenPlaceholder",
        hint: "channels.slackAppTokenHint",
        isSecret: true,
      },
      {
        id: "mode",
        label: "channels.slackMode",
        type: "select",
        required: false,
        defaultValue: "socket",
        options: [
          { value: "socket", label: "Socket Mode" },
          { value: "http", label: "HTTP Mode" },
        ],
        hint: "channels.slackModeHint",
      },
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
          { value: "disabled", label: "channels.dmPolicyDisabled" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  googlechat: {
    fields: [
      {
        id: "serviceAccountFile",
        label: "channels.googlechatServiceAccountFile",
        type: "text",
        required: true,
        placeholder: "channels.googlechatServiceAccountFilePlaceholder",
        hint: "channels.googlechatServiceAccountFileHint",
      },
      {
        id: "webhookUrl",
        label: "channels.googlechatWebhookUrl",
        type: "text",
        required: false,
        placeholder: "channels.googlechatWebhookUrlPlaceholder",
        hint: "channels.googlechatWebhookUrlHint",
      },
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
          { value: "disabled", label: "channels.dmPolicyDisabled" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  whatsapp: {
    fields: [
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
        ],
        hint: "channels.whatsappSetupHint",
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  signal: {
    fields: [
      {
        id: "account",
        label: "channels.signalAccount",
        type: "text",
        required: true,
        placeholder: "channels.signalAccountPlaceholder",
        hint: "channels.signalAccountHint",
      },
      {
        id: "httpUrl",
        label: "channels.signalHttpUrl",
        type: "text",
        required: false,
        placeholder: "channels.signalHttpUrlPlaceholder",
        hint: "channels.signalHttpUrlHint",
      },
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
          { value: "disabled", label: "channels.dmPolicyDisabled" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },

  imessage: {
    fields: [
      {
        id: "service",
        label: "channels.imessageService",
        type: "select",
        required: false,
        defaultValue: "imessage",
        options: [
          { value: "imessage", label: "iMessage" },
          { value: "sms", label: "SMS" },
          { value: "auto", label: "Auto" },
        ],
        hint: "channels.imessageServiceHint",
      },
      {
        id: "dmPolicy",
        label: "channels.fieldDmPolicy",
        type: "select",
        required: false,
        defaultValue: "pairing",
        options: [
          { value: "pairing", label: "channels.dmPolicyPairing" },
          { value: "allowlist", label: "channels.dmPolicyAllowlist" },
          { value: "open", label: "channels.dmPolicyOpen" },
          { value: "disabled", label: "channels.dmPolicyDisabled" },
        ],
      },
    ],
    commonFields: { dmPolicy: true, enabled: true },
  },
};
