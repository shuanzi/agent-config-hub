/** 仅 L2/PF test harness 使用；production bundle 不导入此模块。 */
export function canRecordPf01Startup({
  loadState,
  aggregateTotal,
  representativeRowVisible,
}: {
  loadState: string;
  aggregateTotal: number;
  representativeRowVisible: boolean;
}): boolean {
  return (
    (loadState === 'ready' || loadState === 'stale') &&
    aggregateTotal > 0 &&
    representativeRowVisible
  );
}
