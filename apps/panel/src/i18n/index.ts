import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.js";
import hi from "./hi.js";
import ja from "./ja.js";
import ko from "./ko.js";
import vi from "./vi.js";
import zh from "./zh.js";
import zhTW from "./zh-TW.js";

export const LANGUAGES = [
  { code: "en", label: "English" },
  { code: "zh", label: "中文" },
  { code: "zh-TW", label: "繁體中文" },
  { code: "ja", label: "日本語" },
  { code: "ko", label: "한국어" },
  { code: "vi", label: "Tiếng Việt" },
  { code: "hi", label: "हिन्दी" },
];

const browserLang = navigator.language;
const langPrefix = browserLang.split("-")[0];

function detectLanguage(): string {
  if (browserLang === "zh-TW" || browserLang === "zh-Hant") return "zh-TW";
  if (langPrefix === "zh") return "zh";
  if (langPrefix === "ja") return "ja";
  if (langPrefix === "ko") return "ko";
  if (langPrefix === "vi") return "vi";
  if (langPrefix === "hi") return "hi";
  return "en";
}

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
    "zh-TW": { translation: zhTW },
    ja: { translation: ja },
    ko: { translation: ko },
    vi: { translation: vi },
    hi: { translation: hi },
  },
  lng: detectLanguage(),
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
