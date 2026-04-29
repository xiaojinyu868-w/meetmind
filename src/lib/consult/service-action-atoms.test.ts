import { describe, expect, it } from 'vitest';
import {
  ATOM_TYPE_ORDER,
  SERVICE_ACTION_ATOMS,
  getServiceActionAtomSummary,
  type ServiceActionAtomType,
} from './service-action-atoms';

describe('service action atom registry', () => {
  it('covers all five first-principle atom types', () => {
    const summary = getServiceActionAtomSummary();

    for (const type of ATOM_TYPE_ORDER) {
      expect(summary.byType[type]).toBeGreaterThan(0);
    }
  });

  it('keeps every atom evaluable and user-visible', () => {
    for (const atom of SERVICE_ACTION_ATOMS) {
      expect(atom.serviceAction.length).toBeGreaterThan(0);
      expect(atom.inputState.length).toBeGreaterThan(0);
      expect(atom.outputArtifact.length).toBeGreaterThan(0);
      expect(atom.userVisibleResult.length).toBeGreaterThan(0);
      expect(atom.evalCriteria.length).toBeGreaterThan(0);
    }
  });

  it('does not regress live platform tool coverage', () => {
    const liveToolNames = SERVICE_ACTION_ATOMS
      .filter((atom) => atom.status === 'live' && atom.toolName)
      .map((atom) => atom.toolName)
      .sort();

    expect(liveToolNames).toEqual([
      'askOptions',
      'ctaWechat',
      'fileUpload',
      'readProfile',
      'searchProgramRequirements',
      'showAdvisorDiscovery',
      'showConsultantMove',
      'showDraft',
      'showOutreachWorkspace',
      'showServicePlan',
      'startVoiceCall',
      'useSkill',
      'webSearch',
      'writeProfile',
    ].sort());
  });

  it('keeps the model centered on actions, not media', () => {
    const mediaWords = /文本|语音|图片|富文本/;
    const atomTypes: ServiceActionAtomType[] = SERVICE_ACTION_ATOMS.map((atom) => atom.atomType);

    expect(new Set(atomTypes)).toEqual(new Set(ATOM_TYPE_ORDER));
    for (const atom of SERVICE_ACTION_ATOMS) {
      expect(atom.atomType).not.toMatch(mediaWords);
    }
  });
});
