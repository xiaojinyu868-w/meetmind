export type LearningIntentApproach = 'understand' | 'practice' | 'synthesize' | 'create';
export type LearningContextFocus = 'personal' | 'current' | 'mixed';

export interface LearningIntentPlan {
  title: string;
  outcome: string;
  approach: LearningIntentApproach;
  contextFocus: LearningContextFocus;
  checkpoints: string[];
  confidence: 'high' | 'medium' | 'low';
  clarification?: string;
}

export interface ConfirmLearningIntentInput {
  query: string;
  learnerContext?: string;
  recentContext?: string;
  activeContext?: string;
}
