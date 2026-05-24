import { describe, expect, it } from 'vitest';
import { buildClassroomCompanionPanelModel } from './ClassroomCompanionPanel.model';

describe('buildClassroomCompanionPanelModel', () => {
  it('keeps foresights out of the main conversation state', () => {
    const model = buildClassroomCompanionPanelModel({
      mode: 'listening',
      messages: [],
      streamingMessage: null,
      foresights: [{ id: 'f1', label: '可能问', text: '这里容易混', createdAt: 1 }],
    });

    expect(model.hasMainContent).toBe(false);
    expect(model.showListeningStarter).toBe(true);
    expect(model.latestForesight?.text).toBe('这里容易混');
  });

  it('does not let foresights hide the listening starter when only the opening message exists', () => {
    const model = buildClassroomCompanionPanelModel({
      mode: 'listening',
      messages: [{ id: 'auto-listening', role: 'companion', content: '我在听', createdAt: 1 }],
      streamingMessage: null,
      foresights: [{ id: 'f1', label: '可能问', text: '这里容易混', createdAt: 1 }],
    });

    expect(model.showListeningStarter).toBe(true);
  });
});
