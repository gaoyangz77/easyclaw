/** WebSocket protocol frame types */

export interface HelloFrame {
  type: "hello";
  gateway_id: string;
  auth_token: string;
}

export interface InboundFrame {
  type: "inbound";
  id: string;
  external_user_id: string;
  msg_type: string;
  content: string;
  timestamp: number;
  /** Base64-encoded media data (for voice/image messages). */
  media_data?: string;
  /** MIME type of the media (e.g. "audio/amr"). */
  media_mime?: string;
}

export interface ReplyFrame {
  type: "reply";
  id: string;
  external_user_id: string;
  content: string;
}

export interface ImageReplyFrame {
  type: "image_reply";
  id: string;
  external_user_id: string;
  /** Base64-encoded image data. */
  image_data: string;
  /** MIME type (e.g. "image/png"). */
  image_mime: string;
}

export interface AckFrame {
  type: "ack";
  id: string;
}

export interface ErrorFrame {
  type: "error";
  message: string;
}

export interface CreateBindingFrame {
  type: "create_binding";
  gateway_id: string;
}

export interface CreateBindingAckFrame {
  type: "create_binding_ack";
  token: string;
  customer_service_url: string;
}

export interface UnbindAllFrame {
  type: "unbind_all";
  gateway_id: string;
}

export interface BindingResolvedFrame {
  type: "binding_resolved";
  external_user_id: string;
  gateway_id: string;
}

export type WSFrame =
  | HelloFrame
  | InboundFrame
  | ReplyFrame
  | ImageReplyFrame
  | AckFrame
  | ErrorFrame
  | CreateBindingFrame
  | CreateBindingAckFrame
  | UnbindAllFrame
  | BindingResolvedFrame;

/** Parsed WeCom message types */

export interface WeComTextMessage {
  msgtype: "text";
  external_userid: string;
  text: string;
  msgid: string;
  send_time: number;
  open_kfid: string;
  origin: number;
}

export interface WeComImageMessage {
  msgtype: "image";
  external_userid: string;
  media_id: string;
  msgid: string;
  send_time: number;
  open_kfid: string;
  origin: number;
}

export interface WeComVoiceMessage {
  msgtype: "voice";
  external_userid: string;
  media_id: string;
  msgid: string;
  send_time: number;
  open_kfid: string;
  origin: number;
}

export interface WeComEventMessage {
  msgtype: "event";
  event_type: string;
  external_userid: string;
  open_kfid: string;
  send_time: number;
  scene?: string;
  scene_param?: string;
}

export type WeComMessage =
  | WeComTextMessage
  | WeComImageMessage
  | WeComVoiceMessage
  | WeComEventMessage;

/** Webhook XML event */
export interface WeComCallbackEvent {
  ToUserName: string;
  CreateTime: string;
  MsgType: string;
  Event?: string;
  Token?: string;
  OpenKfId?: string;
}
