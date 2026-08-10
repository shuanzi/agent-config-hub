//! FE-01 最小只读 catalog。
//!
//! 数据源只有环境变量 `ACM_NATIVE_ROOT` 指向的隔离 fixture 根
//! （`skills/<name>/SKILL.md`）；未设置时为空 catalog（fresh、0 资产）。
//! 除此之外的任何文件系统路径一律不触碰。每次 read 直接重读磁盘事实，
//! 因此 revision 与内容天然反映外部变化；事件只负责提醒 UI 重读。
//!
//! fixture 身份的合成约定（与 fixtures/fx-01/fixture.json 一致）：
//! - assetId / nativeUnitRef：`asset-fx01-<dir>` / `nunit-fx01-<dir>`；
//! - fileId：`file-fx01-<fileName 小写，非字母数字折为 '-'> `；
//! - segmentId：`KEY=SYNTHETIC-SECRET-…` 行取 KEY 小写（`_`→`-`）得
//!   `seg-fx01-<key>`，否则 `seg-fx01-<三位序号>`；
//! - revision：`rev-` + 文件内容 sha256 的前 16 个 hex 字符。

use std::fs;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use sha2::{Digest, Sha256};

use crate::domain::{
    ActionAvailability, AgentId, AssetCapabilities, AssetContextHint, AssetDetail,
    AssetDetailSnapshot, AssetGroupBy, AssetListFilters, AssetListQuery, AssetListScope,
    AssetListSnapshot, AssetRef, AssetScope, AssetStatusFilter, AssetSummary, AssetType,
    CompatibilityStatus, EffectiveContext, FileKind, IndexStatus, InspectorData,
    MaskedSourceContent, NativeFileContent, NativeFileRef, NativeFileSnapshot, NativeOwnership,
    NativeUnitKind, ReasonCode, SensitiveDisplayState, SensitiveSegmentRef, SourceAnchor,
    SourceTier,
};

/// 与 fixtures/sensitive-masking.ts 相同的固定遮蔽标记。
pub const SENSITIVE_MASK: &str = "••••••••";

const SYNTHETIC_SECRET_PREFIX: &str = "SYNTHETIC-SECRET-";
const ADAPTER_IDENTITY: &str = "claude-code@fixture";
const SOURCE_TIER_ID: &str = "user-global-root";
const SOURCE_TIER_LABEL: &str = "User global root (synthetic)";

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

/// fixture 形状下的单文件 skill 事实（一次 read 周期内加载）。
struct LoadedSkill {
    name: String,
    raw_bytes: Vec<u8>,
    revision: String,
}

impl LoadedSkill {
    fn raw_text(&self) -> String {
        String::from_utf8_lossy(&self.raw_bytes).into_owned()
    }

    /// 出口遮蔽：目录名是磁盘事实，可能含有占位明文形状（如
    /// `SYNTHETIC-SECRET-evil-1`）；一切由它派生的输出字符串（含不透明 id）
    /// 一律以遮蔽后的名字为底，保证任何离开 core 的序列化都不含占位明文。
    fn safe_name(&self) -> String {
        mask_synthetic_secrets(&self.name)
    }

    fn asset_id(&self) -> String {
        format!("asset-fx01-{}", self.safe_name())
    }

    fn native_unit_ref(&self) -> String {
        format!("nunit-fx01-{}", self.safe_name())
    }

    fn file_id(&self) -> String {
        let slug: String = "SKILL.md"
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect();
        format!("file-fx01-{slug}")
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
        NativeFileRef {
            file_id: self.file_id(),
            name: "SKILL.md".to_string(),
            relative_path: "SKILL.md".to_string(),
            file_kind: FileKind::Text,
            is_primary: true,
            can_preview: ActionAvailability::Allowed,
            can_edit: ActionAvailability::Allowed,
            has_draft_changes: false,
        }
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

    /// 扫描合成占位值，生成不含明文的片段元数据。
    fn sensitive_segments(&self) -> Vec<SensitiveSegmentRef> {
        let raw = self.raw_text();
        let mut segments = Vec::new();
        let mut offset = 0;
        while let Some(found) = raw[offset..].find(SYNTHETIC_SECRET_PREFIX) {
            let start = offset + found;
            let suffix_start = start + SYNTHETIC_SECRET_PREFIX.len();
            let suffix = &raw[suffix_start..];
            let mut chars = suffix.chars();
            let valid = matches!(chars.next(), Some(c) if c.is_ascii_alphanumeric());
            if !valid {
                offset = suffix_start;
                continue;
            }
            let line_start = raw[..start].rfind('\n').map(|i| i + 1).unwrap_or(0);
            let line_prefix = &raw[line_start..start];
            let segment_id = match line_prefix.strip_suffix('=') {
                Some(key)
                    if !key.is_empty()
                        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '_') =>
                {
                    format!("seg-fx01-{}", key.to_ascii_lowercase().replace('_', "-"))
                }
                _ => format!("seg-fx01-{:03}", segments.len() + 1),
            };
            segments.push(SensitiveSegmentRef {
                segment_id,
                file_id: self.file_id(),
                revision: self.revision.clone(),
                display_state: SensitiveDisplayState::Masked,
            });
            offset = suffix_start;
        }
        segments
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
            .filter(|entry| entry.path().join("SKILL.md").is_file())
            .filter_map(|entry| entry.file_name().into_string().ok())
            .collect();
        names.sort();
        names
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
        let path: &Path = &root.join("skills").join(name).join("SKILL.md");
        let raw_bytes = fs::read(path).ok()?;
        let revision = revision_of(&raw_bytes);
        Some(LoadedSkill {
            name: name.to_string(),
            raw_bytes,
            revision,
        })
    }

    fn load_by_asset_id(&self, asset_id: &str) -> Option<LoadedSkill> {
        // assetId 由遮蔽后的目录名派生；按同一规则逐一比对以完成身份回环
        // （正常 fixture 名不含占位模式，遮蔽是恒等，行为不变）。
        let name = self
            .skill_dir_names()
            .into_iter()
            .find(|name| format!("asset-fx01-{}", mask_synthetic_secrets(name)) == asset_id)?;
        self.load(&name)
    }

    /// 派生状态维度（FX-01：verifiedWritable + allowed → editable + normal）。
    fn derived_statuses() -> Vec<AssetStatusFilter> {
        vec![AssetStatusFilter::Editable, AssetStatusFilter::Normal]
    }

    fn matches_list_query(summary: &AssetSummary, query: &AssetListQuery) -> bool {
        if let AssetListScope::CurrentAssetType { asset_type } = &query.scope {
            if *asset_type != AssetType::Skill {
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
        let assets = self
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
        AssetListSnapshot {
            assets,
            index_status: IndexStatus::Fresh,
            scope: query.scope.clone(),
            index_updated_at: queried_at.clone(),
            queried_at,
        }
    }

    pub fn asset_detail(&self, asset: &AssetRef) -> Option<AssetDetailSnapshot> {
        let skill = self.load_by_asset_id(&asset.asset_id)?;
        let detail = AssetDetail {
            asset: skill.asset_ref(),
            display_name: skill.display_name(),
            native_unit_kind: NativeUnitKind::SingleFile,
            revision: skill.revision.clone(),
            compatibility: CompatibilityStatus::VerifiedWritable,
            capabilities: LoadedSkill::capabilities(),
            effective_contexts: skill.effective_contexts(),
            primary_file: skill.primary_file_ref(),
            file_tree_root: None,
        };
        let inspector = InspectorData {
            agents: vec![AgentId::ClaudeCode],
            scope: AssetScope::Global,
            effective_contexts: skill.effective_contexts(),
            source_anchor: SourceAnchor::UserHome,
            // 人类可读单行路径统一过出口遮蔽。
            path_display: mask_synthetic_secrets(&format!("~/…/skills/{}/SKILL.md", skill.name)),
            compatibility: CompatibilityStatus::VerifiedWritable,
            overrides: Vec::new(),
        };
        Some(AssetDetailSnapshot {
            detail,
            inspector,
            revision: skill.revision.clone(),
        })
    }

    pub fn native_file(&self, asset: &AssetRef, file_id: &str) -> Option<NativeFileSnapshot> {
        let skill = self.load_by_asset_id(&asset.asset_id)?;
        if file_id != skill.file_id() {
            return None;
        }
        // 遮蔽在 core 内完成；离开 core 的 maskedText 不再含占位明文。
        let masked_text = mask_synthetic_secrets(&skill.raw_text());
        Some(NativeFileSnapshot {
            file: skill.primary_file_ref(),
            revision: skill.revision.clone(),
            asset_revision: skill.revision.clone(),
            content: NativeFileContent::Source(MaskedSourceContent {
                masked_text,
                sensitive_segments: skill.sensitive_segments(),
            }),
            structured_view: ActionAvailability::Disabled {
                reason_code: ReasonCode::UnknownFieldPreserved,
                recovery_action: None,
            },
        })
    }
}
