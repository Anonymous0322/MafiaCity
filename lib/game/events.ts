import type { Language } from "@/lib/types";

/**
 * Match log lines are stored as `key` + `params` so one persisted match reads
 * correctly in every supported language. The server never ships a
 * pre-rendered sentence.
 */
export const EVENT_KEYS = [
  "event.gameStarted",
  "event.nightFalls",
  "event.nightNoKill",
  "event.mafiaKill",
  "event.doctorSaved",
  "event.mafiaDisagreement",
  "event.dayBreaks",
  "event.eliminatedByVote",
  "event.voteTie",
  "event.mafiaWin",
  "event.townWin",
  "event.playerJoined",
  "event.playerLeft",
  "event.playerReconnected",
  "event.gameCancelled",
] as const;

export type EventKey = (typeof EVENT_KEYS)[number];

type Templates = Record<EventKey, Record<Language, string>>;

export const EVENT_TEMPLATES: Templates = {
  "event.gameStarted": {
    uz: "O‘yin boshlandi! Rollar taqsimlandi.",
    ru: "Игра началась! Роли распределены.",
    en: "The game has begun! Roles have been assigned.",
  },
  "event.nightFalls": {
    uz: "Tun tushdi. Maxfiy harakatlar vaqti.",
    ru: "Наступила ночь. Время тайных действий.",
    en: "Night falls. Time for secret actions.",
  },
  "event.nightNoKill": {
    uz: "Tunda hech kim o‘yindan chiqilmadi.",
    ru: "Ночью никто не выбыл.",
    en: "No one was eliminated tonight.",
  },
  "event.mafiaKill": {
    uz: "{player} tunda o‘yindan chiqarildi.",
    ru: "{player} был выбыт ночью.",
    en: "{player} was eliminated during the night.",
  },
  "event.doctorSaved": {
    uz: "Shifokor nishonni qutqardi. Kechasi hech kim chiqilmadi.",
    ru: "Доктор спас цель. Ночью никто не выбыл.",
    en: "The doctor saved the target. No one was eliminated.",
  },
  "event.mafiaDisagreement": {
    uz: "Mafiya ichida kelishuvga kelinmadi. Kechasi hech kim nishonlanmadi.",
    ru: "Мафия не договорилась. Ночью цель не выбрана.",
    en: "The mafia could not agree on a target.",
  },
  "event.dayBreaks": {
    uz: "Kun bo‘ldi. Shahar aholisi yig‘ildi.",
    ru: "Наступил день. Жители города собрались.",
    en: "Day breaks. The townsfolk have gathered.",
  },
  "event.eliminatedByVote": {
    uz: "{player} ovoz berish orqali chiqarildi.",
    ru: "{player} выбыл по итогам голосования.",
    en: "{player} was eliminated by vote.",
  },
  "event.voteTie": {
    uz: "Ovozlar teng bo‘ldi. Bu safar hech kim chiqarilmadi.",
    ru: "Голоса разделились. В этот раз никто не выбыл.",
    en: "The vote was tied. No one was eliminated.",
  },
  "event.mafiaWin": {
    uz: "Mafiya shaharda nazoratni qo‘lga oldi.",
    ru: "Мафия захватила город.",
    en: "The mafia has taken over the city.",
  },
  "event.townWin": {
    uz: "Shahar aholisi mafiyani fosh qildi.",
    ru: "Горожане раскрыли мафию.",
    en: "The townsfolk uncovered the mafia.",
  },
  "event.playerJoined": {
    uz: "{player} xonaga qo‘shildi.",
    ru: "{player} присоединился к комнате.",
    en: "{player} joined the room.",
  },
  "event.playerLeft": {
    uz: "{player} xonadan chiqdi.",
    ru: "{player} покинул комнату.",
    en: "{player} left the room.",
  },
  "event.playerReconnected": {
    uz: "{player} qayta ulandi.",
    ru: "{player} снова на связи.",
    en: "{player} reconnected.",
  },
  "event.gameCancelled": {
    uz: "O‘yin bekor qilindi.",
    ru: "Игра отменена.",
    en: "The game was cancelled.",
  },
};

export function translateEvent(
  key: string,
  params: Record<string, string | number | boolean | string[]>,
  language: Language,
): string {
  const template = EVENT_TEMPLATES[key as EventKey]?.[language];
  if (!template) return "";
  return template.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name];
    if (value === undefined || value === null) return match;
    if (Array.isArray(value)) return value.join(", ");
    return String(value);
  });
}

/** Short inline phase descriptions used on the round banner. */
export const PHASE_TAG: Record<string, Record<Language, string>> = {
  nightQuiet: {
    uz: "Shahar jimjitlikka cho‘mdi",
    ru: "Город погрузился в тишину",
    en: "The city has gone quiet",
  },
  dayGather: {
    uz: "Shahar aholisining yig‘ilishi",
    ru: "Жители города собрались",
    en: "The townsfolk have gathered",
  },
};
