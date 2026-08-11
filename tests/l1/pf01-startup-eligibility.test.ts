import { describe, expect, it } from 'vitest';

import { canRecordPf01Startup } from '../l2/pf01-startup-eligibility';

describe('PF-01 startup first-visible eligibility', () => {
  it('只在 ready/stale、非空且代表行实际可见时允许记录', () => {
    for (const state of ['ready', 'stale']) {
      expect(
        canRecordPf01Startup({
          loadState: state,
          aggregateTotal: 1,
          representativeRowVisible: true,
        }),
      ).toBe(true);
    }
  });

  it('loading、empty、readFailed/error 即使残留 role=option 也绝不记录', () => {
    for (const state of ['loading', 'empty', 'failed']) {
      expect(
        canRecordPf01Startup({
          loadState: state,
          aggregateTotal: 1,
          representativeRowVisible: true,
        }),
      ).toBe(false);
    }
    expect(
      canRecordPf01Startup({
        loadState: 'ready',
        aggregateTotal: 0,
        representativeRowVisible: true,
      }),
    ).toBe(false);
    expect(
      canRecordPf01Startup({
        loadState: 'ready',
        aggregateTotal: 1,
        representativeRowVisible: false,
      }),
    ).toBe(false);
  });
});
