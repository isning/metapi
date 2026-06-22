import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createInstance } from 'i18next';
import { I18nextProvider } from 'react-i18next';
import { webI18nResources } from './i18n/resources/index.js';

export type Language = 'zh' | 'en';

const LANGUAGE_STORAGE_KEY = 'app_language';

const i18nextInstance = createInstance();

i18nextInstance.init({
  lng: 'zh',
  fallbackLng: 'zh',
  initAsync: false,
  keySeparator: false,
  nsSeparator: false,
  interpolation: {
    escapeValue: false,
  },
  resources: {
    zh: {
      translation: webI18nResources.zh,
    },
    en: {
      translation: webI18nResources.en,
    },
  },
});

function resolveStoredLanguage(): Language {
  const stored = localStorage.getItem(LANGUAGE_STORAGE_KEY);
  if (stored === 'zh' || stored === 'en') return stored;
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
}

let runtimeLanguage: Language = 'zh';

function translateExact(text: string, language: Language): string | undefined {
  return i18nextInstance.getResource(language, 'translation', text) as string | undefined;
}

export function translateText(text: string, language: Language): string {
  if (!text) return text;
  return translateExact(text, language) ?? text;
}

export function tr(text: string): string {
  return translateText(text, runtimeLanguage);
}

type I18nContextValue = {
  language: Language;
  setLanguage: (next: Language) => void;
  toggleLanguage: () => void;
  t: (text: string) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [language, setLanguageState] = useState<Language>(() => {
    const resolved = resolveStoredLanguage();
    runtimeLanguage = resolved;
    return resolved;
  });

  useEffect(() => {
    runtimeLanguage = language;
    i18nextInstance.changeLanguage(language);
    document.documentElement.setAttribute('lang', language === 'zh' ? 'zh-CN' : 'en');
  }, [language]);

  const setLanguage = useCallback((next: Language) => {
    runtimeLanguage = next;
    i18nextInstance.changeLanguage(next);
    setLanguageState(next);
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    document.documentElement.setAttribute('lang', next === 'zh' ? 'zh-CN' : 'en');
  }, []);

  const toggleLanguage = useCallback(() => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  }, [language, setLanguage]);

  const t = useCallback((text: string) => translateText(text, language), [language]);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage,
    toggleLanguage,
    t,
  }), [language, setLanguage, toggleLanguage, t]);

  return (
    <I18nextProvider i18n={i18nextInstance}>
      <I18nContext.Provider value={value}>{children}</I18nContext.Provider>
    </I18nextProvider>
  );
}

export function useI18n() {
  const value = useContext(I18nContext);
  if (!value) {
    throw new Error('useI18n must be used within I18nProvider');
  }
  return value;
}
