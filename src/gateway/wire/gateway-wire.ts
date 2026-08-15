/**
 * GENERATED FILE — DO NOT EDIT.
 *
 * 由 src-tauri 的 export-wire 从 Rust wire DTO 生成（ARC-06c：Rust 是 wire
 * shape 的唯一事实源）。变更请修改 src-tauri/src/wire.rs 后重新导出；
 * verify:static 在临时目录重新生成并逐字节比对，任何手工编辑都会造成漂移失败。
 */

export const GATEWAY_WIRE_VERSION = 3 as const;

export type AssetTypeWire = "skill" | "longTermInstruction" | "subagent" | "hook";
export type AgentIdWire = "claude-code" | "codex" | "gemini-cli" | "opencode";
export type AssetScopeWire = "global" | "project";
export type MvpAssetTypeWire = "skill" | "longTermInstruction" | "subagent";
export type SegmentSourceWire = "globalApplicable" | "projectNative";
export type SkillPresenceWire = "absent" | "present" | "unknown" | "blocked" | "stale";
export type SkillActivationWire = "notApplicable" | "enabled" | "disabled" | "unknown" | "blocked" | "stale";
export type ApplicabilityResolutionWire = "resolved" | "unknown" | "blocked" | "stale";
export type LocatorMatchedFieldWire = "displayName" | "assetType" | "agent" | "ownership" | "projectHint" | "redactedSummary";
export type ProjectApplicabilitySegmentKindWire = "projectNative" | "globalApplicable";
export type ReasonCodeWire = "UNKNOWN_AGENT_VERSION" | "INCOMPATIBLE_STRUCTURE" | "UNSUPPORTED_CAPABILITY" | "READ_ONLY_POLICY" | "PERMISSION_DENIED" | "OUTSIDE_MANAGED_SCOPE" | "PROJECT_UNAVAILABLE" | "UNKNOWN_FIELD_PRESERVED" | "NON_TEXT_UNPREVIEWABLE" | "VALIDATION_FAILED" | "EXECUTABLE_CONTENT_RISK" | "INDEX_STALE" | "EXTERNAL_CHANGE" | "REPREPARE_REQUIRED" | "MERGE_CONFLICT" | "TARGET_NAME_CONFLICT" | "CONVERSION_DEGRADED" | "CONVERSION_BLOCKED" | "READ_FAILED" | "SNAPSHOT_REQUIRED" | "SNAPSHOT_FAILED" | "SECURE_STORAGE_UNAVAILABLE" | "DISK_FULL" | "WRITE_FAILED" | "ROLLBACK_FAILED" | "RECOVERY_TARGET_OCCUPIED" | "ADAPTER_SIGNATURE_INVALID" | "ADAPTER_COMPATIBILITY_MISMATCH" | "ADAPTER_REGRESSION_FAILED" | "IMPORT_SOURCE_UNAVAILABLE" | "EXPORT_DESTINATION_INVALID" | "GATEWAY_UNAVAILABLE";
export type IndexStatusWire = "fresh" | "stale" | "rebuilding" | "failed";
export type CompatibilityStatusWire = "verifiedWritable" | "recognizedReadOnly" | "incompatibleBlocked";
export type SensitiveDisplayStateWire = "masked" | "temporarilyRevealed" | "changedMasked";
export type AnomalyKindWire = "readOnly" | "incompatible" | "conflict" | "drift";
export type AssetStatusFilterWire = "editable" | "readOnly" | "incompatible" | "normal" | "overridden" | "conflict" | "drift";
export type AssetGroupByWire = "none" | "agent" | "project" | "scope" | "source" | "status";
export type NativeUnitKindWire = "singleFile" | "multiFileDirectory" | "configBlock" | "pluginModule";
export type OverrideRelationKindWire = "overrides" | "overriddenBy" | "shadowed";
export type FileKindWire = "text" | "nonText" | "unknown";
export type RecoveryActionWire = { "kind": "retryRead" };
export type DisabledAvailabilityWire = { reasonCode: ReasonCodeWire, recoveryAction?: RecoveryActionWire, };
export type ActionAvailabilityWire = { "kind": "allowed" } | { "kind": "disabled" } & DisabledAvailabilityWire;
export type GlobalNativeOwnershipWire = Record<string, never>;
export type ProjectNativeOwnershipWire = { projectId: string, };
export type NativeOwnershipWire = { "kind": "global" } & GlobalNativeOwnershipWire | { "kind": "project" } & ProjectNativeOwnershipWire;
export type AssetRefWire = { assetId: string, assetType: AssetTypeWire, nativeUnitRef: string, adapterIdentity: string, nativeOwnership: NativeOwnershipWire, };
export type AnomalyWire = { kind: AnomalyKindWire, reasonCode: ReasonCodeWire, message: string, };
export type ProjectContextHintWire = { projectName: string, };
export type PathContextHintWire = { pathHint: string, };
export type AssetContextHintWire = { "kind": "project" } & ProjectContextHintWire | { "kind": "path" } & PathContextHintWire;
export type CurrentAssetTypeScopeWire = { assetType: AssetTypeWire, };
export type AllAssetsScopeWire = Record<string, never>;
export type AssetListScopeWire = { "kind": "currentAssetType" } & CurrentAssetTypeScopeWire | { "kind": "allAssets" } & AllAssetsScopeWire;
export type AssetListFiltersWire = { agents?: Array<AgentIdWire>, projects?: Array<string>, scopes?: Array<AssetScopeWire>, sources?: Array<string>, statuses?: Array<AssetStatusFilterWire>, groupBy?: AssetGroupByWire, };
export type AssetListQueryWire = { scope: AssetListScopeWire, searchText?: string, filters?: AssetListFiltersWire, };
export type AssetDetailQueryWire = { asset: AssetRefWire, };
export type NativeFileQueryWire = { asset: AssetRefWire, fileId: string, };
export type AllProjectApplicabilityViewWire = Record<string, never>;
export type GlobalProjectApplicabilityViewWire = Record<string, never>;
export type ProjectProjectApplicabilityViewWire = { projectId: string, };
export type ProjectApplicabilityViewWire = { "kind": "all" } & AllProjectApplicabilityViewWire | { "kind": "global" } & GlobalProjectApplicabilityViewWire | { "kind": "project" } & ProjectProjectApplicabilityViewWire;
export type ProjectApplicabilityQueryWire = { view: ProjectApplicabilityViewWire, };
export type AllViewContextWire = Record<string, never>;
export type GlobalViewContextWire = Record<string, never>;
export type ProjectViewContextWire = { projectId: string, };
export type ViewContextWire = { "kind": "all" } & AllViewContextWire | { "kind": "global" } & GlobalViewContextWire | { "kind": "project" } & ProjectViewContextWire;
export type WorkbenchFiltersWire = { agents?: Array<AgentIdWire>, sourceIds?: Array<string>, statuses?: Array<AssetStatusFilterWire>, projectIds?: Array<string>, };
export type WorkbenchQueryWire = { assetType: MvpAssetTypeWire, viewContext: ViewContextWire, filters?: WorkbenchFiltersWire, };
export type GlobalLocatorQueryWire = { searchText: string, assetTypes: Array<MvpAssetTypeWire>, };
export type ReadRequestPayload = { "kind": "assetList" } & AssetListQueryWire | { "kind": "workbench" } & WorkbenchQueryWire | { "kind": "globalLocator" } & GlobalLocatorQueryWire | { "kind": "projectApplicability" } & ProjectApplicabilityQueryWire | { "kind": "assetDetail" } & AssetDetailQueryWire | { "kind": "nativeFile" } & NativeFileQueryWire;
export type ReadRequestEnvelope = { wireVersion: number, requestId: string, payload: ReadRequestPayload, };
export type AssetSummaryWire = { asset: AssetRefWire, displayName: string, anomalies: Array<AnomalyWire>, agents: Array<AgentIdWire>, scope: AssetScopeWire, contextHint: AssetContextHintWire, sourceTier: SourceTierWire, availability: ActionAvailabilityWire, };
export type AssetListSnapshotWire = { assets: Array<AssetSummaryWire>, indexStatus: IndexStatusWire, scope: AssetListScopeWire, 
/**
 * ISO 8601
 */
queriedAt: string, 
/**
 * ISO 8601
 */
indexUpdatedAt: string, };
export type SkillCellUnavailableWire = { reasonCode: ReasonCodeWire, };
export type SkillCellAvailabilityWire = { "kind": "allowed" } | { "kind": "disabled" } & SkillCellUnavailableWire | { "kind": "blocked" } & SkillCellUnavailableWire;
export type SkillTargetPendingWire = { operationId: string, phase: string, };
export type SkillTargetStateWire = { agent: AgentIdWire, presence: SkillPresenceWire, activation: SkillActivationWire, applicability: ApplicabilityResolutionWire, enableAvailability: SkillCellAvailabilityWire, disableAvailability: SkillCellAvailabilityWire, pending?: SkillTargetPendingWire, stableReason?: string, };
export type WorkbenchRowWire = { summary: AssetSummaryWire, sortBaseName: string, authoritativeInputOrder: number, statusMemberships: Array<AssetStatusFilterWire>, skillTargetStates: Array<SkillTargetStateWire>, redactedSummary?: string, };
export type WorkbenchSegmentWire = { id: string, source: SegmentSourceWire, displayLabel: string, projectId?: string, rows: Array<WorkbenchRowWire>, };
export type EffectiveContextFactWire = { asset: AssetRefWire, assetId: string, projectId: string, projectDisplayName: string, adapter: AdapterProvenanceWire, rule: RuleProvenanceWire, authoritativeReadRevision: string, sourceTierId: string, loadOrder: number, priority: number, overrideRelation?: OverrideRelationWire, resolution: ApplicabilityResolutionWire, reasonCode?: ReasonCodeWire, };
export type WorkbenchFindingWire = { assetId: string, reasonCode: ReasonCodeWire, context: EffectiveContextFactWire, };
export type WorkbenchActualReadSnapshotWire = { query: WorkbenchQueryWire, authoritativeReadRevision: string, segments: Array<WorkbenchSegmentWire>, effectiveContexts: Array<EffectiveContextFactWire>, findings: Array<WorkbenchFindingWire>, aggregateTotal: number, indexStatus: IndexStatusWire, readAt: string, };
export type LocatorDestinationWire = { "kind": "skillDetail", assetRef: AssetRefWire, } | { "kind": "typeSpecificDetail", assetRef: AssetRefWire, } | { "kind": "unsupportedReadOnly", assetRef: AssetRefWire, reasonCode: ReasonCodeWire, };
export type LocatorResultWire = { row: WorkbenchRowWire, destinationViewContext: ViewContextWire, destination: LocatorDestinationWire, matchedField: LocatorMatchedFieldWire, };
export type LocatorGroupWire = { assetType: MvpAssetTypeWire, count: number, results: Array<LocatorResultWire>, };
export type GlobalLocatorSnapshotWire = { groups: Array<LocatorGroupWire>, aggregateTotal: number, readAt: string, };
export type BuiltInProvenanceSourceWire = Record<string, never>;
export type ActivePackageProvenanceSourceWire = { packageIdentity: string, packageVersion: string, };
export type ProvenanceSourceWire = { "kind": "builtIn" } & BuiltInProvenanceSourceWire | { "kind": "activePackage" } & ActivePackageProvenanceSourceWire;
export type AdapterProvenanceWire = { identity: string, version: string, source: ProvenanceSourceWire, };
export type RuleProvenanceWire = { identity: string, version: string, source: ProvenanceSourceWire, };
export type EffectiveProjectContextWire = { asset: AssetRefWire, projectId: string, projectDisplayName: string, adapter: AdapterProvenanceWire, rule: RuleProvenanceWire, authoritativeReadRevision: string, sourceTierId: string, loadOrder: number, priority: number, overrideRelation?: OverrideRelationWire, resolution: ApplicabilityResolutionWire, reasonCode?: ReasonCodeWire, };
export type ApplicabilityFindingWire = { asset: AssetRefWire, context: EffectiveProjectContextWire, };
export type ProjectApplicabilitySegmentWire = { id: string, kind: ProjectApplicabilitySegmentKindWire, displayLabel: string, projectId?: string, assets: Array<AssetSummaryWire>, };
export type ProjectApplicabilitySnapshotWire = { query: ProjectApplicabilityQueryWire, authoritativeReadRevision: string, segments: Array<ProjectApplicabilitySegmentWire>, findings: Array<ApplicabilityFindingWire>, effectiveContexts: Array<EffectiveProjectContextWire>, aggregateTotal: number, readAt: string, };
export type EffectiveContextWire = { agent: AgentIdWire, scope: AssetScopeWire, sourceTierLabel: string, precedence: number, };
export type AssetCapabilitiesWire = { edit: ActionAvailabilityWire, convert: ActionAvailabilityWire, export: ActionAvailabilityWire, delete: ActionAvailabilityWire, };
export type NativeFileRefWire = { fileId: string, name: string, relativePath: string, fileKind: FileKindWire, isPrimary: boolean, canPreview: ActionAvailabilityWire, canEdit: ActionAvailabilityWire, hasDraftChanges: boolean, };
export type FileTreeNodeWire = { name: string, file?: NativeFileRefWire, children?: Array<FileTreeNodeWire>, };
export type SkillReadSurfaceWire = { agentTargetStates: Array<SkillTargetStateWire>, sourceReadAvailability: ActionAvailabilityWire, unknownContentReason?: ReasonCodeWire, };
export type LongTermInstructionReadSurfaceWire = { markdownFile: NativeFileRefWire, };
export type SubagentReadSurfaceWire = { model?: string, tools: Array<string>, permissions: Array<string>, bodyFile: NativeFileRefWire, readOnlyReason?: ReasonCodeWire, };
export type AssetReadSurfaceWire = { "kind": "skill" } & SkillReadSurfaceWire | { "kind": "longTermInstruction" } & LongTermInstructionReadSurfaceWire | { "kind": "subagent" } & SubagentReadSurfaceWire;
export type AssetDetailWire = { asset: AssetRefWire, displayName: string, nativeUnitKind: NativeUnitKindWire, revision: string, compatibility: CompatibilityStatusWire, capabilities: AssetCapabilitiesWire, effectiveContexts: Array<EffectiveContextWire>, primaryFile: NativeFileRefWire, fileTreeRoot?: FileTreeNodeWire, readSurface: AssetReadSurfaceWire, };
export type OverrideRelationWire = { kind: OverrideRelationKindWire, otherAssetId: string, note: string, };
export type ProjectSourceAnchorWire = { projectName: string, };
export type GlobalRootSourceAnchorWire = { label: string, };
export type SourceAnchorWire = { "kind": "project" } & ProjectSourceAnchorWire | { "kind": "userHome" } | { "kind": "globalRoot" } & GlobalRootSourceAnchorWire;
export type InspectorDataWire = { agents: Array<AgentIdWire>, scope: AssetScopeWire, effectiveContexts: Array<EffectiveContextWire>, sourceAnchor: SourceAnchorWire, pathDisplay: string, compatibility: CompatibilityStatusWire, overrides: Array<OverrideRelationWire>, };
export type AssetDetailSnapshotWire = { detail: AssetDetailWire, inspector: InspectorDataWire, revision: string, };
export type SensitiveSegmentRefWire = { segmentId: string, fileId: string, revision: string, displayState: SensitiveDisplayStateWire, };
export type SourceContentWire = { maskedText: string, sensitiveSegments: Array<SensitiveSegmentRefWire>, };
export type NonTextMetadataContentWire = { fileKindLabel: string, 
/**
 * 受 JS safe-integer 约束；FE-01 fixture 文件远小于该上限。
 * serde 序列化为 JSON number，TS 侧同为 number（非 bigint）。
 */
sizeBytes: number, pathDisplay: string, reasonCode: ReasonCodeWire, reason: string, };
export type NativeFileContentWire = { "kind": "source" } & SourceContentWire | { "kind": "nonTextMetadata" } & NonTextMetadataContentWire;
export type NativeFileSnapshotWire = { file: NativeFileRefWire, revision: string, assetRevision: string, content: NativeFileContentWire, structuredView: ActionAvailabilityWire, };
export type SnapshotWire = { "kind": "assetList" } & AssetListSnapshotWire | { "kind": "workbench" } & WorkbenchActualReadSnapshotWire | { "kind": "globalLocator" } & GlobalLocatorSnapshotWire | { "kind": "projectApplicability" } & ProjectApplicabilitySnapshotWire | { "kind": "assetDetail" } & AssetDetailSnapshotWire | { "kind": "nativeFile" } & NativeFileSnapshotWire;
export type ReadSucceededWire = { snapshot: SnapshotWire, };
export type ReadFailedWire = { reasonCode: ReasonCodeWire, message: string, recoveryAction?: RecoveryActionWire, };
export type ReadResponsePayload = { "kind": "readSucceeded" } & ReadSucceededWire | { "kind": "readFailed" } & ReadFailedWire;
export type ReadResponseEnvelope = { wireVersion: number, requestId: string, payload: ReadResponsePayload, };
export type AssetsInvalidatedWire = { assetType?: AssetTypeWire, };
export type AssetDriftDetectedWire = { assetId: string, };
export type IndexStatusChangedWire = { indexStatus: IndexStatusWire, };
export type CompatibilityChangedWire = { assetId: string, };
export type WorkspaceEventWire = { "kind": "assetsInvalidated" } & AssetsInvalidatedWire | { "kind": "assetDriftDetected" } & AssetDriftDetectedWire | { "kind": "indexStatusChanged" } & IndexStatusChangedWire | { "kind": "compatibilityChanged" } & CompatibilityChangedWire;
export type WorkspaceEventEnvelope = { wireVersion: number, event: WorkspaceEventWire, };
export type SourceTierWire = { id: string, label: string, };
