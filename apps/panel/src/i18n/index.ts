import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.js";
import zh from "./zh.js";

const browserLang = navigator.language.split("-")[0];

const lng = browserLang === "zh" ? "zh" : "en";

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    zh: { translation: zh },
  },
  lng,
  fallbackLng: "en",
  interpolation: { escapeValue: false },
});

export default i18n;
