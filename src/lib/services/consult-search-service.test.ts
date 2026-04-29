import { describe, expect, it } from 'vitest';
import { planAcademicSearchQueries, planProgramRequirementQueries } from './consult-search-service';

describe('planAcademicSearchQueries', () => {
  it('splits broad advisor discovery across schools', () => {
    const queries = planAcademicSearchQueries('NTU NUS HKUST HKU NLP professor 2025 2026 research advisor');

    expect(queries).toHaveLength(4);
    expect(queries[0]).toContain('Nanyang Technological University');
    expect(queries[1]).toContain('National University of Singapore');
    expect(queries[2]).toContain('Hong Kong University of Science and Technology');
    expect(queries[3]).toContain('University of Hong Kong');
    expect(queries.every((query) => query.includes('natural language processing'))).toBe(true);
  });

  it('keeps ordinary factual searches as a single query', () => {
    expect(planAcademicSearchQueries('Percy Liang CRFM recent papers 2026')).toEqual([
      'Percy Liang CRFM recent papers 2026',
    ]);
  });
});

describe('planProgramRequirementQueries', () => {
  it('builds official requirement searches for multiple schools', () => {
    const queries = planProgramRequirementQueries({
      schools: ['Stanford University', 'National University of Singapore'],
      field: 'NLP',
      degree: 'PhD',
      intakeYear: 2027,
      focus: 'requirements',
    });

    expect(queries).toEqual([
      'Stanford University NLP PhD application requirements admissions eligibility materials 2027 official site',
      'National University of Singapore NLP PhD application requirements admissions eligibility materials 2027 official site',
    ]);
  });

  it('keeps a raw query but adds admission-quality constraints', () => {
    const queries = planProgramRequirementQueries({
      query: 'HKUST computer science phd',
      focus: 'deadline',
    });

    expect(queries).toEqual([
      'HKUST computer science phd graduate application deadline admissions timeline official site',
    ]);
  });
});
