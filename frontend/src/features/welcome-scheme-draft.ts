import type { WelcomePresentation } from '@/services/system-branding.service';

export interface WelcomeSchemeDraft {
  welcomeTitle: string;
  welcomeGuest: string;
  welcomeTagline: string;
  welcomeTitleSize: number | null;
  welcomeGuestSize: number | null;
  // 场馆名/英文/两行落款的输入框文本 (表单态: 空串=默认); "隐藏该行"由编辑器隐藏状态表达, 保存时再转三态
  welcomeVenue: string;
  welcomeVenueEn: string;
  welcomeOrg1: string;
  welcomeOrg2: string;
  welcomeBgMediaId: number | null;
  welcomeLogoMediaId: number | null;
  presentation: WelcomePresentation;
}

/** Immutable updates make asset switches visible to Vue and keep the saved draft deterministic. */
export function chooseWelcomeLogo(
  draft: WelcomeSchemeDraft,
  mediaId: number | null,
): WelcomeSchemeDraft {
  return { ...draft, welcomeLogoMediaId: mediaId };
}

export function chooseWelcomeBackground(
  draft: WelcomeSchemeDraft,
  mediaId: number | null,
): WelcomeSchemeDraft {
  return { ...draft, welcomeBgMediaId: mediaId };
}

export function changeWelcomePresentation<K extends keyof WelcomePresentation>(
  draft: WelcomeSchemeDraft,
  key: K,
  value: WelcomePresentation[K],
): WelcomeSchemeDraft {
  return {
    ...draft,
    presentation: { ...draft.presentation, [key]: value },
  };
}
