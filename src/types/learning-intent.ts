export type LearningIntentApproach = 'understand' | 'practice' | 'synthesize' | 'create';
export type LearningContextFocus = 'personal' | 'current' | 'mixed';
export type LearningIntentQuestionKind = 'single' | 'multiple';

export interface LearningIntentOption {
  id: string;
  label: string;
}

export interface LearningIntentQuestion {
  id: string;
  prompt: string;
  kind: LearningIntentQuestionKind;
  options: LearningIntentOption[];
}

export interface LearningIntentAnswer {
  questionId: string;
  question: string;
  optionIds: string[];
  optionLabels: string[];
}

export interface LearningIntentPlan {
  title: string;
  outcome: string;
  approach: LearningIntentApproach;
  contextFocus: LearningContextFocus;
  checkpoints: string[];
  confidence: 'high' | 'medium' | 'low';
  questions?: LearningIntentQuestion[];
}

export interface ConfirmLearningIntentInput {
  query: string;
  learnerContext?: string;
  recentContext?: string;
  activeContext?: string;
  answers?: LearningIntentAnswer[];
}
