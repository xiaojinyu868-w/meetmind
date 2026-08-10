/**
 * settings/AboutYouSection — 「关于你」区：学习档案（结构化身份）与教练画像
 * （bio + goals 自然语言沉淀）拆成两张卡片。2026-08 前两者挤在同一张卡里，
 * 静态行、画像、目标、四个操作按钮混作一团，是设置页"乱"的主要来源。
 */

'use client';

import { COPY } from '@/lib/ui/copy';
import { LEARNER_STAGE_LABELS, type LearnerProfile, type LearnerStage } from '@/types/user';
import {
  ActionButtonRow,
  GroupDivider,
  GroupLabel,
  SettingGroup,
  SettingSection,
  StaticRow,
} from './primitives';

const S = COPY.settings.about;

type CoachBio = { headline: string; detail?: string; updatedAt?: string };
type CoachGoal = { id: string; title: string; summary?: string; status?: string; horizon?: 'near' | 'term' | 'long' };

const HORIZON_LABELS = {
  near: COPY.intent.horizonNear,
  term: COPY.intent.horizonTerm,
  long: COPY.intent.horizonLong,
} as const;

export function AboutYouSection({
  profile,
  saveLearnerProfile,
  onEditProfile,
  onOpenCoach,
}: {
  profile: LearnerProfile | null | undefined;
  saveLearnerProfile: (profile: LearnerProfile) => Promise<unknown>;
  onEditProfile: () => void;
  onOpenCoach: () => void;
}) {
  const bio = (profile as { bio?: CoachBio } | undefined)?.bio;
  const goals = (profile as { goals?: CoachGoal[] } | undefined)?.goals ?? [];
  const hasBio = Boolean(bio?.headline);
  const hasGoals = goals.length > 0;
  const hasCoachSediment = hasBio || hasGoals;

  const handleClearBio = async () => {
    if (!window.confirm(S.clearBioConfirm)) return;
    if (!profile) return;
    const next = { ...(profile as object) } as Record<string, unknown>;
    delete next.bio;
    await saveLearnerProfile(next as unknown as LearnerProfile);
  };

  return (
    <SettingSection id="about" caption={S.caption} description={S.description}>
      <GroupLabel>{S.profileCardLabel}</GroupLabel>
      <SettingGroup>
        {profile ? (
          <>
            <StaticRow
              label={S.identityLabel}
              value={LEARNER_STAGE_LABELS[profile.stage as LearnerStage] || profile.stage}
            />
            {profile.stage === 'k12' && (
              <>
                <GroupDivider />
                <StaticRow label={S.gradeLabel} value={(profile as { gradeLevel?: string }).gradeLevel || S.notSet} />
              </>
            )}
            {profile.stage === 'university' && (
              <>
                <GroupDivider />
                <StaticRow label={S.majorLabel} value={(profile as { major?: string }).major || S.notSet} />
                <GroupDivider />
                <StaticRow label={S.gradeLabel} value={(profile as { year?: string }).year || S.notSet} />
              </>
            )}
            {profile.stage === 'graduate' && (
              <>
                <GroupDivider />
                <StaticRow label={S.directionLabel} value={(profile as { field?: string }).field || S.notSet} />
              </>
            )}
            {profile.stage === 'working' && (
              <>
                <GroupDivider />
                <StaticRow label={S.industryLabel} value={(profile as { industry?: string }).industry || S.notSet} />
                <GroupDivider />
                <StaticRow label={S.goalLabel} value={(profile as { learningGoal?: string }).learningGoal || S.notSet} />
              </>
            )}
            {(profile as { otherInterests?: string }).otherInterests ? (
              <>
                <GroupDivider />
                <StaticRow label={S.alsoLearningLabel} value={(profile as { otherInterests?: string }).otherInterests!} />
              </>
            ) : null}
            <GroupDivider />
            <ActionButtonRow label={S.editProfile} tone="default" onClick={onEditProfile} />
          </>
        ) : (
          <>
            <div className="px-5 py-4 text-[13.5px] leading-relaxed text-ink-secondary">
              {S.emptyProfile}
            </div>
            <GroupDivider />
            <ActionButtonRow label={S.fillProfile} tone="default" onClick={onEditProfile} />
          </>
        )}
      </SettingGroup>

      <div className="pt-5" />
      <GroupLabel>{S.coachCardLabel}</GroupLabel>
      <SettingGroup>
        {hasCoachSediment ? (
          <>
            {hasBio && bio ? (
              <div className="px-5 py-4">
                <p className="font-mono text-[10.5px] font-semibold uppercase tracking-caps text-ink-muted">
                  {S.coachBioTitle}
                </p>
                <p className="mt-2 text-[15px] font-medium leading-7 text-ink">{bio.headline}</p>
                {bio.detail ? (
                  <p className="mt-2 text-[13.5px] leading-relaxed text-ink-secondary">{bio.detail}</p>
                ) : null}
                {bio.updatedAt ? (
                  <p className="mt-2 font-mono text-[10.5px] uppercase tracking-caps text-ink-muted">
                    {S.coachUpdatedAt(new Date(bio.updatedAt).toLocaleDateString('zh-CN'))}
                  </p>
                ) : null}
              </div>
            ) : null}
            {hasGoals ? (
              <>
                {hasBio ? <GroupDivider /> : null}
                <div className="px-5 py-4">
                  <p className="font-mono text-[10.5px] font-semibold uppercase tracking-caps text-ink-muted">
                    {S.coachGoalsTitle}
                  </p>
                  <ul className="mt-2 space-y-2.5">
                    {goals.map((goal) => (
                      <li key={goal.id}>
                        <p className="flex items-center gap-2 text-[14.5px] font-medium leading-6 text-ink">
                          <span className="min-w-0 flex-1">{goal.title}</span>
                          {goal.horizon ? (
                            <span className="inline-flex shrink-0 items-center rounded-full bg-pine-mist/50 px-2 py-0.5 text-[10.5px] font-medium text-pine">
                              {HORIZON_LABELS[goal.horizon]}
                            </span>
                          ) : null}
                        </p>
                        {goal.summary ? (
                          <p className="mt-1 text-[13px] leading-relaxed text-ink-secondary">{goal.summary}</p>
                        ) : null}
                      </li>
                    ))}
                  </ul>
                </div>
              </>
            ) : null}
            <GroupDivider />
            <ActionButtonRow label={S.chatAgain} tone="default" onClick={onOpenCoach} />
            {hasBio ? (
              <>
                <GroupDivider />
                <ActionButtonRow label={S.clearBio} tone="danger" onClick={handleClearBio} />
              </>
            ) : null}
          </>
        ) : (
          <>
            <div className="px-5 py-4 text-[13.5px] leading-relaxed text-ink-secondary">
              {S.emptyCoach}
            </div>
            <GroupDivider />
            <ActionButtonRow label={S.chatStart} tone="default" onClick={onOpenCoach} />
          </>
        )}
      </SettingGroup>
    </SettingSection>
  );
}
