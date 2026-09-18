import { useSyncExternalStore } from 'react';
import './messages.js';
import './core.js';

type Language = 'sv' | 'da' | 'nb' | 'en' | 'de';
declare global {
  var TrainMeetI18n: {
    languages: [Language, string][];
    t: (source: string, values?: Record<string, string | number>) => string;
    getLanguage: () => Language;
    getLocale: () => string;
    setLanguage: (language: string) => void;
    subscribe: (callback: () => void) => () => void;
  };
}
export const t = (source: string, values?: Record<string, string | number>) => globalThis.TrainMeetI18n.t(source, values);
export const locale = () => globalThis.TrainMeetI18n.getLocale();
export function useLanguage() {
  return useSyncExternalStore(TrainMeetI18n.subscribe, TrainMeetI18n.getLanguage, () => 'sv');
}
export function LanguagePicker() {
  const language = useLanguage();
  return <label className="language-picker"><span>{t('Språk')}</span><select aria-label={t('Språk')} value={language} onChange={(event) => TrainMeetI18n.setLanguage(event.target.value)}>{TrainMeetI18n.languages.map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>;
}
