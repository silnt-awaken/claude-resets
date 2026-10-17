import type { Locale } from './index';
import { toolsEn, type ToolsMessages } from './tools-en';
import { toolsZhCN } from './tools-zh-CN';
import { toolsZhTW } from './tools-zh-TW';
import { toolsJa } from './tools-ja';
import { toolsKo } from './tools-ko';
export const toolDictionaries: Record<Locale, ToolsMessages> = { en: toolsEn, 'zh-CN': toolsZhCN, 'zh-TW': toolsZhTW, ja: toolsJa, ko: toolsKo };
export const toolDict = (locale: Locale): ToolsMessages => toolDictionaries[locale];
