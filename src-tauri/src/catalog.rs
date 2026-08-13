//! FE-01 最小只读 catalog。
//!
//! 数据源只有环境变量 `ACM_NATIVE_ROOT` 指向的隔离 fixture 根（Skill、
//! 长期指令和 Subagent 的约定子路径）；未设置时为空 catalog（fresh、0 资产）。
//! 只接受根内非 symlink 的普通文件，除此之外的任何文件系统路径一律不触碰。每次 read 直接重读磁盘事实，
//! 因此 revision 与内容天然反映外部变化；事件只负责提醒 UI 重读。
//!
//! fixture 身份的合成约定（与 fixtures/fx-01/fixture.json 一致）：
//! - assetId / nativeUnitRef：`asset-fx01-<dir>` / `nunit-fx01-<dir>`；
//! - fileId：`file-fx01-<fileName 小写，非字母数字折为 '-'> `；
//! - segmentId：`KEY=SYNTHETIC-SECRET-…` 行取 KEY 小写（`_`→`-`）得
//!   `seg-fx01-<key>`，否则 `seg-fx01-<三位序号>`；
//! - revision：`rev-` + 文件内容 sha256 的前 16 个 hex 字符。

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};
use unicode_casefold::{Locale, UnicodeCaseFold, Variant};
use unicode_normalization::UnicodeNormalization;

use crate::domain::{
    derive_workbench_status_memberships, ActionAvailability, AgentId, AssetCapabilities,
    AssetContextHint, AssetDetail, AssetDetailSnapshot, AssetGroupBy, AssetListFilters,
    AssetListQuery, AssetListScope, AssetListSnapshot, AssetReadSurface, AssetRef, AssetScope,
    AssetStatusFilter, AssetSummary, AssetType, CompatibilityStatus, EffectiveContext, FileKind,
    FileTreeNode, GlobalLocatorQuery, GlobalLocatorSnapshot, IndexStatus, InspectorData,
    LocatorGroup, LocatorMatchedField, LocatorResult, MaskedSourceContent, MvpAssetType,
    NativeFileContent, NativeFileRef, NativeFileSnapshot, NativeOwnership, NativeUnitKind,
    ReadFailure, ReasonCode, RecoveryAction, SegmentSource, SensitiveDisplayState,
    SensitiveSegmentRef, SkillActivation, SkillCellAvailability, SkillPresence, SkillTargetState,
    SourceAnchor, SourceTier, ViewContext, WorkbenchActualReadSnapshot, WorkbenchQuery,
    WorkbenchRow, WorkbenchSegment, WorkbenchStatusFacts,
};

/// 与 fixtures/sensitive-masking.ts 相同的固定遮蔽标记。
pub const SENSITIVE_MASK: &str = "••••••••";

const SYNTHETIC_SECRET_PREFIX: &str = "SYNTHETIC-SECRET-";
const ADAPTER_IDENTITY: &str = "claude-code@fixture";
const SOURCE_TIER_ID: &str = "user-global-root";
const SOURCE_TIER_LABEL: &str = "User global root (synthetic)";

fn read_failed() -> ReadFailure {
    ReadFailure {
        reason_code: ReasonCode::ReadFailed,
        message: "读取条件无效或当前不可读，请重读。".to_string(),
        recovery_action: Some(RecoveryAction::RetryRead),
    }
}

fn valid_opaque_ids(ids: &Option<Vec<String>>) -> bool {
    ids.as_ref()
        .is_none_or(|values| values.iter().all(|value| !value.trim().is_empty()))
}

fn skill_target_states() -> Vec<SkillTargetState> {
    vec![
        SkillTargetState {
            agent: AgentId::ClaudeCode,
            presence: SkillPresence::Present,
            activation: SkillActivation::Enabled,
            applicability: crate::domain::ApplicabilityResolution::Resolved,
            enable_availability: SkillCellAvailability::Disabled {
                reason_code: ReasonCode::ReadOnlyPolicy,
            },
            disable_availability: SkillCellAvailability::Allowed,
            pending: None,
            stable_reason: None,
        },
        SkillTargetState {
            agent: AgentId::Codex,
            presence: SkillPresence::Absent,
            activation: SkillActivation::NotApplicable,
            applicability: crate::domain::ApplicabilityResolution::Resolved,
            enable_availability: SkillCellAvailability::Allowed,
            disable_availability: SkillCellAvailability::Disabled {
                reason_code: ReasonCode::UnsupportedCapability,
            },
            pending: None,
            stable_reason: None,
        },
        SkillTargetState {
            agent: AgentId::GeminiCli,
            presence: SkillPresence::Absent,
            activation: SkillActivation::NotApplicable,
            applicability: crate::domain::ApplicabilityResolution::Resolved,
            enable_availability: SkillCellAvailability::Allowed,
            disable_availability: SkillCellAvailability::Disabled {
                reason_code: ReasonCode::UnsupportedCapability,
            },
            pending: None,
            stable_reason: None,
        },
        SkillTargetState {
            agent: AgentId::Opencode,
            presence: SkillPresence::Absent,
            activation: SkillActivation::NotApplicable,
            applicability: crate::domain::ApplicabilityResolution::Resolved,
            enable_availability: SkillCellAvailability::Allowed,
            disable_availability: SkillCellAvailability::Disabled {
                reason_code: ReasonCode::UnsupportedCapability,
            },
            pending: None,
            stable_reason: None,
        },
    ]
}

/// Locator only sees metadata which has already crossed the core masking boundary.
/// The compare order is contract-visible and `str::contains` operates at UTF-8
/// char boundaries, never arbitrary byte offsets.
pub struct LocatorDisplayFields {
    pub display_name: String,
    pub asset_type_label: String,
    pub agents: Vec<String>,
    pub ownership: String,
    pub project_hint: Option<String>,
    pub redacted_summary: Option<String>,
}

fn normalize_locator_text(value: &str) -> String {
    value
        .trim()
        .nfc()
        .case_fold_with(Variant::Full, Locale::NonTurkic)
        .collect()
}

pub fn locator_match_field(query: &str, fields: &LocatorDisplayFields) -> Option<&'static str> {
    let needle = normalize_locator_text(query);
    if needle.is_empty() {
        return None;
    }
    let contains = |value: &str| normalize_locator_text(value).contains(&needle);
    if contains(&fields.display_name) {
        Some("displayName")
    } else if contains(&fields.asset_type_label) {
        Some("assetType")
    } else if fields.agents.iter().any(|agent| contains(agent)) {
        Some("agent")
    } else if contains(&fields.ownership) {
        Some("ownership")
    } else if fields.project_hint.as_deref().is_some_and(contains) {
        Some("projectHint")
    } else if fields.redacted_summary.as_deref().is_some_and(contains) {
        Some("redactedSummary")
    } else {
        None
    }
}

/// FE-01 status seam consumes the same detail/capability authority exported by
/// this catalog. It intentionally never maps `AssetSummary::availability` to
/// editability. The remaining status flags are explicit known facts of this
/// fixed FX-01 fixture, rather than defaults for absent upstream fields.
fn status_facts_for_catalog_detail(detail: &AssetDetail) -> WorkbenchStatusFacts {
    WorkbenchStatusFacts {
        edit_asset_availability: Some(detail.capabilities.edit.clone()),
        compatibility: Some(detail.compatibility),
        normal: Some(detail.compatibility == CompatibilityStatus::VerifiedWritable),
        overridden: Some(false),
        conflict: Some(false),
        drift: Some(false),
    }
}

fn agent_label(agent: &AgentId) -> &'static str {
    match agent {
        AgentId::ClaudeCode => "claude-code",
        AgentId::Codex => "codex",
        AgentId::GeminiCli => "gemini-cli",
        AgentId::Opencode => "opencode",
    }
}

fn asset_type_label(asset_type: AssetType) -> &'static str {
    match asset_type {
        AssetType::Skill => "skill",
        AssetType::LongTermInstruction => "longTermInstruction",
        AssetType::Subagent => "subagent",
        AssetType::Hook => "hook",
    }
}

fn locator_fields(
    summary: &AssetSummary,
    redacted_summary: Option<String>,
) -> LocatorDisplayFields {
    let (ownership, project_hint) = match &summary.asset.native_ownership {
        NativeOwnership::Global => (
            "global".to_string(),
            match &summary.context_hint {
                AssetContextHint::Path { path_hint } => Some(path_hint.clone()),
                AssetContextHint::Project { project_name } => Some(project_name.clone()),
            },
        ),
        NativeOwnership::Project { project_id } => {
            ("project".to_string(), Some(project_id.clone()))
        }
    };
    LocatorDisplayFields {
        display_name: summary.display_name.clone(),
        asset_type_label: asset_type_label(summary.asset.asset_type).to_string(),
        agents: summary
            .agents
            .iter()
            .map(agent_label)
            .map(str::to_string)
            .collect(),
        ownership,
        project_hint,
        redacted_summary,
    }
}

fn locator_matched_field(
    query: &str,
    fields: &LocatorDisplayFields,
) -> Option<LocatorMatchedField> {
    match locator_match_field(query, fields) {
        Some("displayName") => Some(LocatorMatchedField::DisplayName),
        Some("assetType") => Some(LocatorMatchedField::AssetType),
        Some("agent") => Some(LocatorMatchedField::Agent),
        Some("ownership") => Some(LocatorMatchedField::Ownership),
        Some("projectHint") => Some(LocatorMatchedField::ProjectHint),
        Some("redactedSummary") => Some(LocatorMatchedField::RedactedSummary),
        _ => None,
    }
}

/// 离开 core 的 maskedText 必须已经过本函数遮蔽（票据硬边界）。
/// 语义与 fixtures/sensitive-masking.ts 一致：把
/// `SYNTHETIC-SECRET-[A-Za-z0-9][A-Za-z0-9-]*` 替换为固定遮蔽标记。
pub fn mask_synthetic_secrets(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut rest = raw;
    while let Some(start) = rest.find(SYNTHETIC_SECRET_PREFIX) {
        let suffix_start = start + SYNTHETIC_SECRET_PREFIX.len();
        let suffix = &rest[suffix_start..];
        let mut chars = suffix.char_indices();
        // 占位值要求 suffix 至少一个 [A-Za-z0-9] 起始字符，否则视为普通文本。
        let end = match chars.next() {
            Some((_, c)) if c.is_ascii_alphanumeric() => {
                let mut last = c.len_utf8();
                for (i, c) in chars {
                    if c.is_ascii_alphanumeric() || c == '-' {
                        last = i + c.len_utf8();
                    } else {
                        break;
                    }
                }
                last
            }
            _ => {
                // 不是合法占位值：原样搬运前缀的第一个字符后继续扫描。
                out.push_str(&rest[..start]);
                let mut iter = rest[start..].chars();
                if let Some(c) = iter.next() {
                    out.push(c);
                    rest = &rest[start + c.len_utf8()..];
                } else {
                    rest = &rest[start..];
                }
                continue;
            }
        };
        out.push_str(&rest[..start]);
        out.push_str(SENSITIVE_MASK);
        rest = &rest[suffix_start + end..];
    }
    out.push_str(rest);
    out
}

/// 当前 UTC 时间，ISO 8601（与 `Date.prototype.toISOString()` 同形：毫秒 + Z）。
/// 只用 std::time 手工换算，不引入 time/chrono 依赖。
pub fn now_iso8601() -> String {
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default();
    let secs = now.as_secs() as i64;
    let millis = now.subsec_millis();
    let days = secs.div_euclid(86_400);
    let secs_of_day = secs.rem_euclid(86_400);
    let (hour, minute, second) = (
        secs_of_day / 3600,
        (secs_of_day % 3600) / 60,
        secs_of_day % 60,
    );
    // Howard Hinnant 的 civil_from_days
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };
    format!("{year:04}-{month:02}-{day:02}T{hour:02}:{minute:02}:{second:02}.{millis:03}Z")
}

fn revision_of(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("rev-{}", &hex[..16])
}

fn revision_of_parts(parts: impl IntoIterator<Item = Vec<u8>>) -> String {
    let mut hasher = Sha256::new();
    for part in parts {
        hasher.update((part.len() as u64).to_be_bytes());
        hasher.update(part);
    }
    let digest = hasher.finalize();
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    format!("rev-{}", &hex[..16])
}

/// 供不透明公开身份使用的、不可逆且稳定的区分后缀。
///
/// 若两个不同的原生名字都被遮蔽为同一显示值，不能让其公开 ID 碰撞；完整摘要
/// 只用于精确回环，不恢复原生路径或名称。
fn opaque_identity_component(raw: &str) -> String {
    let masked = mask_synthetic_secrets(raw);
    if masked == raw {
        return raw.to_string();
    }
    let digest = Sha256::digest(raw.as_bytes());
    let suffix: String = digest.iter().map(|byte| format!("{byte:02x}")).collect();
    format!("{masked}-{suffix}")
}

fn file_id_for(prefix: &str, relative_path: &str) -> String {
    let slug: String = opaque_identity_component(relative_path)
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() {
                c.to_ascii_lowercase()
            } else {
                '-'
            }
        })
        .collect();
    format!("file-{prefix}-{slug}")
}

fn is_text_bytes(bytes: &[u8]) -> bool {
    std::str::from_utf8(bytes).is_ok() && !bytes.contains(&0)
}

/// `Path::is_file` 会跟随 symlink，不能用于隔离根边界。
fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| metadata.file_type().is_file())
        .unwrap_or(false)
}

fn file_kind_for(bytes: &[u8]) -> FileKind {
    if bytes.starts_with(b"SYNTHETIC-NON-TEXT-BINARY") {
        FileKind::NonText
    } else if is_text_bytes(bytes) {
        FileKind::Text
    } else {
        FileKind::NonText
    }
}

/// 仅遍历隔离 fixture 根内的普通文件；符号链接、绝对路径和用户路径均不进入。
fn collect_native_files(root: &Path) -> Option<Vec<LoadedNativeFile>> {
    fn walk(root: &Path, current: &Path, files: &mut Vec<LoadedNativeFile>) -> Option<()> {
        let mut entries: Vec<_> = fs::read_dir(current).ok()?.flatten().collect();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            let file_type = entry.file_type().ok()?;
            if file_type.is_symlink() {
                continue;
            }
            let path = entry.path();
            if file_type.is_dir() {
                walk(root, &path, files)?;
            } else if file_type.is_file() {
                let relative_path = path
                    .strip_prefix(root)
                    .ok()?
                    .to_str()?
                    .replace(std::path::MAIN_SEPARATOR, "/");
                files.push(LoadedNativeFile {
                    relative_path,
                    raw_bytes: fs::read(path).ok()?,
                });
            }
        }
        Some(())
    }

    let mut files = Vec::new();
    walk(root, root, &mut files)?;
    (!files.is_empty()).then_some(files)
}

fn file_tree_children(skill: &LoadedSkill, prefix: &str) -> Vec<FileTreeNode> {
    let mut names = BTreeSet::new();
    for file in &skill.files {
        if let Some(rest) = file.relative_path.strip_prefix(prefix) {
            if let Some(name) = rest.split('/').next() {
                if !name.is_empty() {
                    names.insert(name.to_string());
                }
            }
        }
    }
    names
        .into_iter()
        .map(|name| {
            let path = format!("{prefix}{name}");
            if let Some(file) = skill.files.iter().find(|file| file.relative_path == path) {
                FileTreeNode {
                    name: mask_synthetic_secrets(&name),
                    file: Some(skill.file_ref(file)),
                    children: None,
                }
            } else {
                FileTreeNode {
                    name: mask_synthetic_secrets(&name),
                    file: None,
                    children: Some(file_tree_children(skill, &format!("{path}/"))),
                }
            }
        })
        .collect()
}

/// 隔离 fixture 根中的 Skill 原生目录事实（一次 read 周期内加载）。
struct LoadedSkill {
    fixture_prefix: String,
    name: String,
    files: Vec<LoadedNativeFile>,
    revision: String,
}

#[derive(Clone)]
struct LoadedNativeFile {
    relative_path: String,
    raw_bytes: Vec<u8>,
}

struct LoadedStaticAsset {
    fixture_prefix: String,
    asset_type: AssetType,
    slug: String,
    display_name: String,
    agent: AgentId,
    relative_path: String,
    raw_bytes: Vec<u8>,
}

impl LoadedStaticAsset {
    fn asset_ref(&self) -> AssetRef {
        let opaque_slug = opaque_identity_component(&self.slug);
        AssetRef {
            asset_id: format!("asset-{}-{opaque_slug}", self.fixture_prefix),
            asset_type: self.asset_type,
            native_unit_ref: format!("nunit-{}-{opaque_slug}", self.fixture_prefix),
            adapter_identity: ADAPTER_IDENTITY.to_string(),
            native_ownership: NativeOwnership::Global,
        }
    }

    fn file_ref(&self) -> NativeFileRef {
        NativeFileRef {
            file_id: file_id_for(&self.fixture_prefix, &self.relative_path),
            name: mask_synthetic_secrets(self.relative_path.rsplit('/').next().unwrap_or_default()),
            relative_path: mask_synthetic_secrets(&self.relative_path),
            file_kind: file_kind_for(&self.raw_bytes),
            is_primary: true,
            can_preview: ActionAvailability::Allowed,
            can_edit: ActionAvailability::Disabled {
                reason_code: ReasonCode::ReadOnlyPolicy,
                recovery_action: None,
            },
            has_draft_changes: false,
        }
    }

    fn revision(&self) -> String {
        revision_of(&self.raw_bytes)
    }

    fn summary(&self) -> AssetSummary {
        AssetSummary {
            asset: self.asset_ref(),
            display_name: mask_synthetic_secrets(&self.display_name),
            anomalies: Vec::new(),
            agents: vec![self.agent],
            scope: AssetScope::Global,
            context_hint: AssetContextHint::Path {
                path_hint: mask_synthetic_secrets(&format!("~/…/{}", self.relative_path)),
            },
            source_tier: SourceTier {
                id: SOURCE_TIER_ID.to_string(),
                label: mask_synthetic_secrets(SOURCE_TIER_LABEL),
            },
            availability: ActionAvailability::Disabled {
                reason_code: ReasonCode::ReadOnlyPolicy,
                recovery_action: None,
            },
        }
    }
}

impl LoadedSkill {
    /// 人类可读出口遮蔽：目录名是磁盘事实，可能含有占位明文形状（如
    /// `SYNTHETIC-SECRET-evil-1`），显示字段一律不含该明文。
    fn safe_name(&self) -> String {
        mask_synthetic_secrets(&self.name)
    }

    fn asset_id(&self) -> String {
        format!(
            "asset-{}-{}",
            self.fixture_prefix,
            opaque_identity_component(&self.name)
        )
    }

    fn native_unit_ref(&self) -> String {
        format!(
            "nunit-{}-{}",
            self.fixture_prefix,
            opaque_identity_component(&self.name)
        )
    }

    fn file_id_for(&self, relative_path: &str) -> String {
        file_id_for(&self.fixture_prefix, relative_path)
    }

    fn primary(&self) -> Option<&LoadedNativeFile> {
        self.files
            .iter()
            .find(|file| file.relative_path == "SKILL.md")
    }

    fn file_ref(&self, file: &LoadedNativeFile) -> NativeFileRef {
        let file_kind = file_kind_for(&file.raw_bytes);
        let is_primary = file.relative_path == "SKILL.md";
        let can_preview = if file_kind == FileKind::Text {
            ActionAvailability::Allowed
        } else {
            ActionAvailability::Disabled {
                reason_code: ReasonCode::NonTextUnpreviewable,
                recovery_action: None,
            }
        };
        NativeFileRef {
            file_id: self.file_id_for(&file.relative_path),
            name: mask_synthetic_secrets(file.relative_path.rsplit('/').next().unwrap_or_default()),
            relative_path: mask_synthetic_secrets(&file.relative_path),
            file_kind,
            is_primary,
            can_preview,
            can_edit: if file_kind == FileKind::Text {
                ActionAvailability::Allowed
            } else {
                ActionAvailability::Disabled {
                    reason_code: ReasonCode::ReadOnlyPolicy,
                    recovery_action: None,
                }
            },
            has_draft_changes: false,
        }
    }

    fn display_name(&self) -> String {
        // 先遮蔽再做命名美化：直接美化会把 '-' 折成空格，破坏占位模式使遮蔽失效。
        self.safe_name()
            .split('-')
            .filter(|part| !part.is_empty())
            .map(|part| {
                let mut chars = part.chars();
                match chars.next() {
                    Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
                    None => String::new(),
                }
            })
            .collect::<Vec<_>>()
            .join(" ")
    }

    fn asset_ref(&self) -> AssetRef {
        AssetRef {
            asset_id: self.asset_id(),
            asset_type: AssetType::Skill,
            native_unit_ref: self.native_unit_ref(),
            adapter_identity: ADAPTER_IDENTITY.to_string(),
            native_ownership: NativeOwnership::Global,
        }
    }

    fn primary_file_ref(&self) -> NativeFileRef {
        self.primary()
            .map(|file| self.file_ref(file))
            .expect("LoadedSkill must contain SKILL.md")
    }

    fn effective_contexts(&self) -> Vec<EffectiveContext> {
        vec![EffectiveContext {
            agent: AgentId::ClaudeCode,
            scope: AssetScope::Global,
            // 人类可读标签统一过出口遮蔽（当前为常量，遮蔽是恒等防御）。
            source_tier_label: mask_synthetic_secrets(SOURCE_TIER_LABEL),
            precedence: 0,
        }]
    }

    fn capabilities() -> AssetCapabilities {
        AssetCapabilities {
            edit: ActionAvailability::Allowed,
            convert: ActionAvailability::Allowed,
            export: ActionAvailability::Allowed,
            delete: ActionAvailability::Allowed,
        }
    }
}

/// 最小只读 catalog（ARC-03 CatalogIndex 的 FE-01 切片）。
pub struct Catalog {
    native_root: Option<PathBuf>,
}

impl Catalog {
    /// 生产入口：读取 `ACM_NATIVE_ROOT`；未设置时为空 catalog。
    pub fn from_env() -> Self {
        let root = std::env::var_os("ACM_NATIVE_ROOT")
            .filter(|value| !value.is_empty())
            .map(PathBuf::from);
        Catalog { native_root: root }
    }

    /// 测试入口：显式指定根（或 None 表示空 catalog）。
    pub fn new(native_root: Option<PathBuf>) -> Self {
        Catalog { native_root }
    }

    fn fixture_prefix(&self) -> String {
        self.native_root
            .as_ref()
            .and_then(|root| root.parent())
            .and_then(Path::file_name)
            .and_then(|name| name.to_str())
            .and_then(|name| name.strip_prefix("fx-"))
            .map(|suffix| format!("fx{suffix}"))
            .unwrap_or_else(|| "fixture".to_string())
    }

    fn skill_dir_names(&self) -> Vec<String> {
        let Some(root) = &self.native_root else {
            return Vec::new();
        };
        let skills_dir = root.join("skills");
        let Ok(entries) = fs::read_dir(&skills_dir) else {
            return Vec::new();
        };
        let mut names: Vec<String> = entries
            .flatten()
            .filter(|entry| entry.file_type().map(|t| t.is_dir()).unwrap_or(false))
            .filter(|entry| is_regular_file(&entry.path().join("SKILL.md")))
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();
        names
    }

    fn static_assets(&self) -> Vec<LoadedStaticAsset> {
        let Some(root) = &self.native_root else {
            return Vec::new();
        };
        let prefix = self.fixture_prefix();
        let mut assets = Vec::new();
        let instructions_dir = root.join("long-term-instructions");
        if let Ok(entries) = fs::read_dir(&instructions_dir) {
            let mut paths: Vec<_> = entries
                .flatten()
                .filter(|entry| {
                    entry
                        .file_type()
                        .map(|kind| kind.is_file())
                        .unwrap_or(false)
                })
                .collect();
            paths.sort_by_key(|entry| entry.file_name());
            for entry in paths {
                let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                let Ok(raw_bytes) = fs::read(entry.path()) else {
                    continue;
                };
                let stem = name.strip_suffix(".md").unwrap_or(&name);
                assets.push(LoadedStaticAsset {
                    fixture_prefix: prefix.clone(),
                    asset_type: AssetType::LongTermInstruction,
                    slug: format!("long-term-{stem}"),
                    display_name: "长期指令".to_string(),
                    agent: AgentId::Codex,
                    relative_path: format!("long-term-instructions/{name}"),
                    raw_bytes,
                });
            }
        }
        let subagents_dir = root.join("subagents");
        if let Ok(entries) = fs::read_dir(&subagents_dir) {
            let mut directories: Vec<_> = entries
                .flatten()
                .filter(|entry| entry.file_type().map(|kind| kind.is_dir()).unwrap_or(false))
                .collect();
            directories.sort_by_key(|entry| entry.file_name());
            for entry in directories {
                let Some(name) = entry.file_name().to_str().map(str::to_string) else {
                    continue;
                };
                let path = entry.path().join("SUBAGENT.md");
                if !is_regular_file(&path) {
                    continue;
                }
                let Ok(raw_bytes) = fs::read(path) else {
                    continue;
                };
                assets.push(LoadedStaticAsset {
                    fixture_prefix: prefix.clone(),
                    asset_type: AssetType::Subagent,
                    slug: format!("subagent-{name}"),
                    display_name: mask_synthetic_secrets(&name),
                    agent: AgentId::Codex,
                    relative_path: format!("subagents/{name}/SUBAGENT.md"),
                    raw_bytes,
                });
            }
        }
        assets
    }

    fn static_asset_by_id(&self, asset_id: &str) -> Option<LoadedStaticAsset> {
        self.static_assets()
            .into_iter()
            .find(|asset| asset.asset_ref().asset_id == asset_id)
    }

    fn load(&self, name: &str) -> Option<LoadedSkill> {
        let root = self.native_root.as_ref()?;
        // 名字只允许简单目录名，杜绝路径穿越；数据源本就仅限 ACM_NATIVE_ROOT。
        if name.is_empty()
            || name
                .chars()
                .any(|c| !(c.is_ascii_alphanumeric() || c == '-' || c == '_'))
        {
            return None;
        }
        let skill_root = root.join("skills").join(name);
        let primary = skill_root.join("SKILL.md");
        if !is_regular_file(&primary) {
            return None;
        }
        let files = collect_native_files(&skill_root)?;
        if !files.iter().any(|file| file.relative_path == "SKILL.md") {
            return None;
        }
        let revision = revision_of_parts(files.iter().flat_map(|file| {
            [
                file.relative_path.as_bytes().to_vec(),
                file.raw_bytes.clone(),
            ]
        }));
        Some(LoadedSkill {
            fixture_prefix: self.fixture_prefix(),
            name: name.to_string(),
            files,
            revision,
        })
    }

    fn load_by_asset_id(&self, asset_id: &str) -> Option<LoadedSkill> {
        // assetId 由遮蔽后的目录名派生；按同一规则逐一比对以完成身份回环
        // （正常 fixture 名不含占位模式，遮蔽是恒等，行为不变）。
        let name = self.skill_dir_names().into_iter().find(|name| {
            format!(
                "asset-{}-{}",
                self.fixture_prefix(),
                opaque_identity_component(name)
            ) == asset_id
        })?;
        self.load(&name)
    }

    fn skill_file_tree(&self, skill: &LoadedSkill) -> Option<FileTreeNode> {
        (skill.files.len() > 1).then(|| FileTreeNode {
            name: skill.safe_name(),
            file: None,
            children: Some(file_tree_children(skill, "")),
        })
    }

    /// 派生状态维度（FX-01：verifiedWritable + allowed → editable + normal）。
    fn derived_statuses() -> Vec<AssetStatusFilter> {
        vec![AssetStatusFilter::Editable, AssetStatusFilter::Normal]
    }

    fn matches_list_query(summary: &AssetSummary, query: &AssetListQuery) -> bool {
        if let AssetListScope::CurrentAssetType { asset_type } = &query.scope {
            if *asset_type != summary.asset.asset_type {
                return false;
            }
        }
        if let Some(search) = &query.search_text {
            let needle = search.trim().to_lowercase();
            if !needle.is_empty() && !summary.display_name.to_lowercase().contains(&needle) {
                return false;
            }
        }
        if let Some(filters) = &query.filters {
            return Self::matches_filters(summary, filters);
        }
        true
    }

    fn matches_filters(summary: &AssetSummary, filters: &AssetListFilters) -> bool {
        if let Some(agents) = &filters.agents {
            if !agents.is_empty() && !agents.iter().any(|agent| summary.agents.contains(agent)) {
                return false;
            }
        }
        if let Some(projects) = &filters.projects {
            if !projects.is_empty() {
                // projects 匹配 context_hint 的项目名；FX-01 无项目事实（path hint），
                // 任一非空 projects 筛选都排除该资产。
                let in_project = match &summary.context_hint {
                    AssetContextHint::Project { project_name } => projects.contains(project_name),
                    AssetContextHint::Path { .. } => false,
                };
                if !in_project {
                    return false;
                }
            }
        }
        if let Some(scopes) = &filters.scopes {
            if !scopes.is_empty() && !scopes.contains(&summary.scope) {
                return false;
            }
        }
        if let Some(sources) = &filters.sources {
            // sources 匹配来源层级的不透明身份 source_tier.id。
            if !sources.is_empty() && !sources.iter().any(|id| id == &summary.source_tier.id) {
                return false;
            }
        }
        if let Some(statuses) = &filters.statuses {
            if !statuses.is_empty() {
                let derived = Self::derived_statuses();
                if !statuses.iter().any(|status| derived.contains(status)) {
                    return false;
                }
            }
        }
        // group_by 只影响展示分组（FE-02），不改变结果集。
        let _ = filters.group_by.unwrap_or(AssetGroupBy::None);
        true
    }

    pub fn asset_list(&self, query: &AssetListQuery) -> AssetListSnapshot {
        let queried_at = now_iso8601();
        let mut assets: Vec<_> = self
            .skill_dir_names()
            .into_iter()
            .filter_map(|name| self.load(&name))
            .map(|skill| AssetSummary {
                asset: skill.asset_ref(),
                display_name: skill.display_name(),
                anomalies: Vec::new(),
                agents: vec![AgentId::ClaudeCode],
                scope: AssetScope::Global,
                context_hint: AssetContextHint::Path {
                    // 人类可读路径提示统一过出口遮蔽。
                    path_hint: mask_synthetic_secrets(&format!("~/…/skills/{}", skill.name)),
                },
                source_tier: SourceTier {
                    id: SOURCE_TIER_ID.to_string(),
                    label: mask_synthetic_secrets(SOURCE_TIER_LABEL),
                },
                availability: ActionAvailability::Allowed,
            })
            .filter(|summary| Self::matches_list_query(summary, query))
            .collect();
        assets.extend(
            self.static_assets()
                .into_iter()
                .map(|asset| asset.summary())
                .filter(|summary| Self::matches_list_query(summary, query)),
        );
        AssetListSnapshot {
            assets,
            index_status: IndexStatus::Fresh,
            scope: query.scope.clone(),
            index_updated_at: queried_at.clone(),
            queried_at,
        }
    }

    /// FE-01 B2 workbench snapshot：筛选后按固定段序返回；本 catalog 只拥有
    /// FX-01 的 global native Skill，故 project view 不从名称或路径猜测投影。
    pub fn workbench(
        &self,
        query: &WorkbenchQuery,
    ) -> Result<WorkbenchActualReadSnapshot, ReadFailure> {
        let filters = query.filters.clone().unwrap_or_default();
        if !valid_opaque_ids(&filters.source_ids)
            || !valid_opaque_ids(&filters.project_ids)
            || (matches!(
                query.view_context,
                ViewContext::Global | ViewContext::Project { .. }
            ) && filters
                .project_ids
                .as_ref()
                .is_some_and(|ids| !ids.is_empty()))
            || matches!(&query.view_context, ViewContext::Project { project_id } if project_id.trim().is_empty())
        {
            return Err(read_failed());
        }
        let legacy = AssetListQuery {
            scope: AssetListScope::CurrentAssetType {
                asset_type: match query.asset_type {
                    MvpAssetType::Skill => AssetType::Skill,
                    MvpAssetType::LongTermInstruction => AssetType::LongTermInstruction,
                    MvpAssetType::Subagent => AssetType::Subagent,
                },
            },
            search_text: None,
            filters: Some(AssetListFilters {
                agents: filters.agents.clone(),
                projects: None,
                scopes: None,
                sources: filters.source_ids.clone(),
                // summary.availability 不是 FE-01 workbench status 的权威输入。
                statuses: None,
                group_by: None,
            }),
        };
        let list = self.asset_list(&legacy);
        let rows: Vec<WorkbenchRow> = list
            .assets
            .into_iter()
            .filter_map(|summary| {
                let detail = self.asset_detail(&summary.asset)?;
                let facts = status_facts_for_catalog_detail(&detail.detail);
                let memberships = derive_workbench_status_memberships(&facts);
                filters
                    .statuses
                    .as_ref()
                    .is_none_or(|statuses| {
                        statuses.is_empty()
                            || statuses.iter().any(|status| memberships.contains(status))
                    })
                    .then_some((summary, memberships))
            })
            .enumerate()
            .map(
                |(authoritative_input_order, (summary, status_memberships))| WorkbenchRow {
                    sort_base_name: summary.display_name.clone(),
                    authoritative_input_order: authoritative_input_order as u32,
                    status_memberships,
                    skill_target_states: (summary.asset.asset_type == AssetType::Skill)
                        .then(skill_target_states)
                        .unwrap_or_default(),
                    redacted_summary: Some(
                        match summary.asset.asset_type {
                            AssetType::Skill => "结构化只读 Skill 摘要",
                            AssetType::LongTermInstruction => "长期指令只读 Markdown 摘要",
                            AssetType::Subagent => "Subagent 只读结构化摘要",
                            AssetType::Hook => unreachable!(),
                        }
                        .to_string(),
                    ),
                    summary,
                },
            )
            .collect();
        let segments = match &query.view_context {
            ViewContext::All | ViewContext::Global if !rows.is_empty() => vec![WorkbenchSegment {
                id: "segment-fx01-global-applicable".to_string(),
                source: SegmentSource::GlobalApplicable,
                display_label: "Global".to_string(),
                project_id: None,
                rows,
            }],
            ViewContext::All | ViewContext::Global | ViewContext::Project { .. } => Vec::new(),
        };
        let aggregate_total = segments
            .iter()
            .map(|segment| segment.rows.len() as u32)
            .sum();
        Ok(WorkbenchActualReadSnapshot {
            query: query.clone(),
            authoritative_read_revision: list.queried_at.clone(),
            segments,
            effective_contexts: Vec::new(),
            findings: Vec::new(),
            aggregate_total,
            index_status: list.index_status,
            read_at: list.queried_at,
        })
    }

    /// Global locator 固定返回三类 MVP groups；它只匹配已遮蔽的列表摘要，
    /// 不读取源码，也不创建草稿、prepare 或 apply。
    pub fn global_locator(
        &self,
        query: &GlobalLocatorQuery,
    ) -> Result<GlobalLocatorSnapshot, ReadFailure> {
        if query.asset_types.as_slice()
            != [
                MvpAssetType::Skill,
                MvpAssetType::LongTermInstruction,
                MvpAssetType::Subagent,
            ]
        {
            return Err(read_failed());
        }
        let list = self.asset_list(&AssetListQuery {
            scope: AssetListScope::AllAssets,
            search_text: None,
            filters: None,
        });
        let mut aggregate_total = 0_u32;
        let groups = [
            (MvpAssetType::Skill, AssetType::Skill),
            (
                MvpAssetType::LongTermInstruction,
                AssetType::LongTermInstruction,
            ),
            (MvpAssetType::Subagent, AssetType::Subagent),
        ]
        .into_iter()
        .map(|(asset_type, domain_type)| {
            let results: Vec<_> = list
                .assets
                .iter()
                .filter(|summary| summary.asset.asset_type == domain_type)
                .enumerate()
                .filter_map(|(authoritative_input_order, summary)| {
                    let detail = self.asset_detail(&summary.asset)?;
                    let status_memberships = derive_workbench_status_memberships(
                        &status_facts_for_catalog_detail(&detail.detail),
                    );
                    let redacted_summary = match domain_type {
                        AssetType::Skill => "结构化只读 Skill 摘要",
                        AssetType::LongTermInstruction => "长期指令只读 Markdown 摘要",
                        AssetType::Subagent => "Subagent 只读结构化摘要",
                        AssetType::Hook => return None,
                    }
                    .to_string();
                    let matched_field = locator_matched_field(
                        &query.search_text,
                        &locator_fields(summary, Some(redacted_summary.clone())),
                    )?;
                    let asset = summary.asset.clone();
                    let destination = if domain_type == AssetType::Skill {
                        crate::domain::LocatorDestination::SkillDetail { asset }
                    } else {
                        crate::domain::LocatorDestination::TypeSpecificDetail { asset }
                    };
                    Some(LocatorResult {
                        row: WorkbenchRow {
                            sort_base_name: summary.display_name.clone(),
                            authoritative_input_order: authoritative_input_order as u32,
                            status_memberships,
                            summary: summary.clone(),
                            skill_target_states: (domain_type == AssetType::Skill)
                                .then(skill_target_states)
                                .unwrap_or_default(),
                            redacted_summary: Some(redacted_summary),
                        },
                        destination_view_context: ViewContext::Global,
                        destination,
                        matched_field,
                    })
                })
                .collect();
            aggregate_total += results.len() as u32;
            LocatorGroup {
                asset_type,
                results,
            }
        })
        .collect();
        Ok(GlobalLocatorSnapshot {
            groups,
            aggregate_total,
            read_at: list.queried_at,
        })
    }

    pub fn asset_detail(&self, asset: &AssetRef) -> Option<AssetDetailSnapshot> {
        if asset.asset_type == AssetType::Skill {
            let skill = self.load_by_asset_id(&asset.asset_id)?;
            let primary_file = skill.primary_file_ref();
            let detail = AssetDetail {
                asset: skill.asset_ref(),
                display_name: skill.display_name(),
                native_unit_kind: if skill.files.len() == 1 {
                    NativeUnitKind::SingleFile
                } else {
                    NativeUnitKind::MultiFileDirectory
                },
                revision: skill.revision.clone(),
                compatibility: CompatibilityStatus::VerifiedWritable,
                capabilities: LoadedSkill::capabilities(),
                effective_contexts: skill.effective_contexts(),
                primary_file,
                file_tree_root: self.skill_file_tree(&skill),
                read_surface: AssetReadSurface::Skill {
                    agent_target_states: skill_target_states(),
                    source_read_availability: ActionAvailability::Allowed,
                    unknown_content_reason: (skill.files.len() > 1)
                        .then_some(ReasonCode::UnknownFieldPreserved),
                },
            };
            let inspector = InspectorData {
                agents: vec![AgentId::ClaudeCode],
                scope: AssetScope::Global,
                effective_contexts: skill.effective_contexts(),
                source_anchor: SourceAnchor::UserHome,
                path_display: mask_synthetic_secrets(&format!(
                    "~/…/skills/{}/SKILL.md",
                    skill.name
                )),
                compatibility: CompatibilityStatus::VerifiedWritable,
                overrides: Vec::new(),
            };
            return Some(AssetDetailSnapshot {
                revision: skill.revision.clone(),
                detail,
                inspector,
            });
        }

        let loaded = self.static_asset_by_id(&asset.asset_id)?;
        let file = loaded.file_ref();
        let revision = loaded.revision();
        let (native_unit_kind, read_surface) = match loaded.asset_type {
            AssetType::LongTermInstruction => (
                NativeUnitKind::SingleFile,
                AssetReadSurface::LongTermInstruction {
                    markdown_file: file.clone(),
                },
            ),
            AssetType::Subagent => (
                NativeUnitKind::ConfigBlock,
                AssetReadSurface::Subagent {
                    model: Some("synthetic-research-model".to_string()),
                    tools: vec!["read".to_string()],
                    permissions: vec!["readOnly".to_string()],
                    body_file: file.clone(),
                    read_only_reason: Some(ReasonCode::UnknownFieldPreserved),
                },
            ),
            AssetType::Skill | AssetType::Hook => return None,
        };
        let compatibility = CompatibilityStatus::RecognizedReadOnly;
        let detail = AssetDetail {
            asset: loaded.asset_ref(),
            display_name: loaded.display_name.clone(),
            native_unit_kind,
            revision: revision.clone(),
            compatibility,
            capabilities: read_only_capabilities(),
            effective_contexts: vec![EffectiveContext {
                agent: loaded.agent,
                scope: AssetScope::Global,
                source_tier_label: mask_synthetic_secrets(SOURCE_TIER_LABEL),
                precedence: 0,
            }],
            primary_file: file,
            file_tree_root: None,
            read_surface,
        };
        let inspector = InspectorData {
            agents: vec![loaded.agent],
            scope: AssetScope::Global,
            effective_contexts: detail.effective_contexts.clone(),
            source_anchor: SourceAnchor::UserHome,
            path_display: mask_synthetic_secrets(&format!("~/…/{}", loaded.relative_path)),
            compatibility,
            overrides: Vec::new(),
        };
        Some(AssetDetailSnapshot {
            detail,
            inspector,
            revision,
        })
    }

    pub fn native_file(&self, asset: &AssetRef, file_id: &str) -> Option<NativeFileSnapshot> {
        if asset.asset_type == AssetType::Skill {
            let skill = self.load_by_asset_id(&asset.asset_id)?;
            let file = skill
                .files
                .iter()
                .find(|file| skill.file_id_for(&file.relative_path) == file_id)?;
            let file_ref = skill.file_ref(file);
            let content = native_file_content(
                &file_ref,
                &file.raw_bytes,
                sensitive_segments_for(&file_ref, &file.raw_bytes, &skill.fixture_prefix),
            );
            return Some(NativeFileSnapshot {
                file: file_ref,
                revision: revision_of(&file.raw_bytes),
                asset_revision: skill.revision.clone(),
                content,
                structured_view: ActionAvailability::Disabled {
                    reason_code: ReasonCode::UnknownFieldPreserved,
                    recovery_action: None,
                },
            });
        }
        let loaded = self.static_asset_by_id(&asset.asset_id)?;
        let file = loaded.file_ref();
        (file.file_id == file_id).then(|| NativeFileSnapshot {
            file,
            revision: loaded.revision(),
            asset_revision: loaded.revision(),
            content: native_file_content(
                &loaded.file_ref(),
                &loaded.raw_bytes,
                sensitive_segments_for(
                    &loaded.file_ref(),
                    &loaded.raw_bytes,
                    &loaded.fixture_prefix,
                ),
            ),
            structured_view: ActionAvailability::Disabled {
                reason_code: ReasonCode::ReadOnlyPolicy,
                recovery_action: None,
            },
        })
    }
}

fn read_only_capabilities() -> AssetCapabilities {
    let disabled = || ActionAvailability::Disabled {
        reason_code: ReasonCode::ReadOnlyPolicy,
        recovery_action: None,
    };
    AssetCapabilities {
        edit: disabled(),
        convert: disabled(),
        export: disabled(),
        delete: disabled(),
    }
}

/// 扫描任意只读文本文件中的合成敏感占位值。片段只含 opaque metadata，
/// 严格绑定当前文件及其 revision，绝不携带原值或成为执行输入。
fn sensitive_segments_for(
    file: &NativeFileRef,
    raw_bytes: &[u8],
    fixture_prefix: &str,
) -> Vec<SensitiveSegmentRef> {
    if file.file_kind != FileKind::Text {
        return Vec::new();
    }
    let raw = String::from_utf8_lossy(raw_bytes);
    let revision = revision_of(raw_bytes);
    let mut segments = Vec::new();
    let mut offset = 0;
    while let Some(found) = raw[offset..].find(SYNTHETIC_SECRET_PREFIX) {
        let start = offset + found;
        let suffix_start = start + SYNTHETIC_SECRET_PREFIX.len();
        let suffix = &raw[suffix_start..];
        let mut chars = suffix.chars();
        if !matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric()) {
            offset = suffix_start;
            continue;
        }
        let line_start = raw[..start].rfind('\n').map(|index| index + 1).unwrap_or(0);
        let line_prefix = &raw[line_start..start];
        let segment_id = match line_prefix.strip_suffix('=') {
            Some(key)
                if !key.is_empty()
                    && key
                        .chars()
                        .all(|character| character.is_ascii_alphanumeric() || character == '_') =>
            {
                format!(
                    "seg-{}-{}",
                    fixture_prefix,
                    key.to_ascii_lowercase().replace('_', "-")
                )
            }
            _ => format!("seg-{fixture_prefix}-{:03}", segments.len() + 1),
        };
        segments.push(SensitiveSegmentRef {
            segment_id,
            file_id: file.file_id.clone(),
            revision: revision.clone(),
            display_state: SensitiveDisplayState::Masked,
        });
        offset = suffix_start;
    }
    segments
}

fn native_file_content(
    file: &NativeFileRef,
    raw_bytes: &[u8],
    sensitive_segments: Vec<SensitiveSegmentRef>,
) -> NativeFileContent {
    match file.file_kind {
        FileKind::Text => NativeFileContent::Source(MaskedSourceContent {
            masked_text: mask_synthetic_secrets(&String::from_utf8_lossy(raw_bytes)),
            sensitive_segments,
        }),
        FileKind::NonText | FileKind::Unknown => {
            NativeFileContent::NonTextMetadata(crate::domain::NonTextMetadataContent {
                file_kind_label: "非文本二进制文件".to_string(),
                size_bytes: raw_bytes.len() as u64,
                path_display: mask_synthetic_secrets(&file.relative_path),
                reason_code: ReasonCode::NonTextUnpreviewable,
                reason: "此文件不是可安全展示的文本内容。".to_string(),
            })
        }
    }
}
