//! FE-07R 的只读 AdapterRegistry seam。
//!
//! registry 只从 `ACM_FX19_ROOT/fixture.json` 读取已登记的 built-in/active
//! Adapter 与 rule provenance；不加载 bundle、不切换 active version，也不写入。

use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use crate::domain::{AdapterProvenance, ProvenanceSource, RuleProvenance};

#[derive(Debug, Clone)]
pub struct AdapterRegistry {
    root: Option<PathBuf>,
}

impl AdapterRegistry {
    pub fn from_env() -> Self {
        Self {
            root: std::env::var_os("ACM_FX19_ROOT")
                .filter(|value| !value.is_empty())
                .map(PathBuf::from),
        }
    }

    pub fn from_root(root: PathBuf) -> Self {
        Self { root: Some(root) }
    }

    /// FE-01 仅据此选择是否组合既有 FE-07R resolver；不读取、修改或枚举 root。
    pub fn is_configured(&self) -> bool {
        self.root.is_some()
    }

    /// 只读读取 registry 当前事实。错误不携带磁盘路径或 serde 内部字符串，
    /// 由调用者归一化为稳定 ReadFailed。
    pub fn read(&self) -> Result<AdapterRegistrySnapshot, RegistryReadError> {
        let root = self.root.as_ref().ok_or(RegistryReadError)?;
        let bytes = fs::read(root.join("fixture.json")).map_err(|_| RegistryReadError)?;
        let fixture: Fixture = serde_json::from_slice(&bytes).map_err(|_| RegistryReadError)?;
        fixture.into_snapshot()
    }
}

#[derive(Debug, Clone)]
pub struct AdapterRegistrySnapshot {
    pub fixture_id: String,
    pub authoritative_read_revision: String,
    pub global_asset: FixtureAsset,
    pub projects: Vec<FixtureProject>,
    pub contexts: Vec<FixtureContext>,
    pub built_in_adapter: AdapterProvenance,
    pub built_in_rule: RuleProvenance,
    pub active_adapter: AdapterProvenance,
    pub active_rule: RuleProvenance,
}

#[derive(Debug, Clone)]
pub struct FixtureAsset {
    pub asset_id: String,
    pub native_unit_ref: String,
    pub display_name: String,
    pub source_tier_id: String,
    pub source_tier_label: String,
}

#[derive(Debug, Clone)]
pub struct FixtureProject {
    pub project_id: String,
    pub display_name: String,
}

#[derive(Debug, Clone)]
pub struct FixtureContext {
    pub project_id: String,
    pub adapter: RegistrySource,
    pub rule: RegistrySource,
    /// Resolver 解析此事实时观察到的 provenance/revision。只读 resolver
    /// 必须与当前 registry 精确比对，避免旧的 resolved 事实被误投影。
    pub bound_adapter: AdapterProvenance,
    pub bound_rule: RuleProvenance,
    pub bound_authoritative_read_revision: String,
    pub resolution: String,
    pub reason_code: Option<String>,
    pub load_order: u32,
    pub priority: i32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RegistrySource {
    BuiltIn,
    ActivePackage,
}

#[derive(Debug, Clone, Copy)]
pub struct RegistryReadError;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Fixture {
    fixture_id: String,
    authoritative_read_revision: String,
    global_asset: FixtureAssetRaw,
    projects: Vec<FixtureProjectRaw>,
    contexts: Vec<FixtureContextRaw>,
    adapter_registry: AdapterRegistryRaw,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureAssetRaw {
    asset_id: String,
    native_unit_ref: String,
    display_name: String,
    source_tier_id: String,
    source_tier_label: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureProjectRaw {
    project_id: String,
    display_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FixtureContextRaw {
    project_id: String,
    adapter: String,
    rule: String,
    bound: BoundContextRaw,
    resolution: String,
    #[serde(default)]
    reason_code: Option<String>,
    load_order: u32,
    priority: i32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundContextRaw {
    adapter: BoundProvenanceRaw,
    rule: BoundProvenanceRaw,
    authoritative_read_revision: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundProvenanceRaw {
    identity: String,
    version: String,
    source: BoundSourceRaw,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct BoundSourceRaw {
    kind: String,
    #[serde(default)]
    package_identity: Option<String>,
    #[serde(default)]
    package_version: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterRegistryRaw {
    built_in: AdapterRulePairRaw,
    active_package: ActivePackageRaw,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AdapterRulePairRaw {
    adapter: IdentityVersionRaw,
    rule: IdentityVersionRaw,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActivePackageRaw {
    package_identity: String,
    package_version: String,
    adapter: IdentityVersionRaw,
    rule: IdentityVersionRaw,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct IdentityVersionRaw {
    identity: String,
    version: String,
}

impl Fixture {
    fn into_snapshot(self) -> Result<AdapterRegistrySnapshot, RegistryReadError> {
        let non_empty = |value: &str| !value.trim().is_empty();
        if !non_empty(&self.fixture_id)
            || !non_empty(&self.authoritative_read_revision)
            || !non_empty(&self.global_asset.asset_id)
            || !non_empty(&self.global_asset.native_unit_ref)
            || !non_empty(&self.global_asset.display_name)
            || !non_empty(&self.global_asset.source_tier_id)
            || !non_empty(&self.global_asset.source_tier_label)
            || self.projects.is_empty()
        {
            return Err(RegistryReadError);
        }

        let built_in_source = ProvenanceSource::BuiltIn;
        let active_source = ProvenanceSource::ActivePackage {
            package_identity: self
                .adapter_registry
                .active_package
                .package_identity
                .clone(),
            package_version: self.adapter_registry.active_package.package_version.clone(),
        };
        let validate_identity = |identity: &IdentityVersionRaw| {
            non_empty(&identity.identity) && non_empty(&identity.version)
        };
        if !validate_identity(&self.adapter_registry.built_in.adapter)
            || !validate_identity(&self.adapter_registry.built_in.rule)
            || !validate_identity(&self.adapter_registry.active_package.adapter)
            || !validate_identity(&self.adapter_registry.active_package.rule)
            || !non_empty(&self.adapter_registry.active_package.package_identity)
            || !non_empty(&self.adapter_registry.active_package.package_version)
        {
            return Err(RegistryReadError);
        }

        let projects = self
            .projects
            .into_iter()
            .map(|project| {
                if !non_empty(&project.project_id) || !non_empty(&project.display_name) {
                    return Err(RegistryReadError);
                }
                Ok(FixtureProject {
                    project_id: project.project_id,
                    display_name: project.display_name,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        let bound_source = |source: BoundSourceRaw| match (
            source.kind.as_str(),
            source.package_identity,
            source.package_version,
        ) {
            ("builtIn", None, None) => Ok(ProvenanceSource::BuiltIn),
            ("activePackage", Some(package_identity), Some(package_version))
                if non_empty(&package_identity) && non_empty(&package_version) =>
            {
                Ok(ProvenanceSource::ActivePackage {
                    package_identity,
                    package_version,
                })
            }
            _ => Err(RegistryReadError),
        };
        let contexts = self
            .contexts
            .into_iter()
            .map(|context| {
                if !non_empty(&context.project_id)
                    || !matches!(context.adapter.as_str(), "builtIn" | "activePackage")
                    || !matches!(context.rule.as_str(), "builtIn" | "activePackage")
                    || !matches!(
                        context.resolution.as_str(),
                        "resolved" | "unknown" | "blocked" | "stale"
                    )
                    || (context.resolution == "resolved") != context.reason_code.is_none()
                {
                    return Err(RegistryReadError);
                }
                let bound_adapter_source = bound_source(context.bound.adapter.source)?;
                let bound_rule_source = bound_source(context.bound.rule.source)?;
                if !non_empty(&context.bound.adapter.identity)
                    || !non_empty(&context.bound.adapter.version)
                    || !non_empty(&context.bound.rule.identity)
                    || !non_empty(&context.bound.rule.version)
                    || !non_empty(&context.bound.authoritative_read_revision)
                {
                    return Err(RegistryReadError);
                }
                Ok(FixtureContext {
                    project_id: context.project_id,
                    adapter: if context.adapter == "builtIn" {
                        RegistrySource::BuiltIn
                    } else {
                        RegistrySource::ActivePackage
                    },
                    rule: if context.rule == "builtIn" {
                        RegistrySource::BuiltIn
                    } else {
                        RegistrySource::ActivePackage
                    },
                    bound_adapter: AdapterProvenance {
                        identity: context.bound.adapter.identity,
                        version: context.bound.adapter.version,
                        source: bound_adapter_source,
                    },
                    bound_rule: RuleProvenance {
                        identity: context.bound.rule.identity,
                        version: context.bound.rule.version,
                        source: bound_rule_source,
                    },
                    bound_authoritative_read_revision: context.bound.authoritative_read_revision,
                    resolution: context.resolution,
                    reason_code: context.reason_code,
                    load_order: context.load_order,
                    priority: context.priority,
                })
            })
            .collect::<Result<Vec<_>, _>>()?;
        if contexts.len() != projects.len()
            || contexts.iter().any(|context| {
                !projects
                    .iter()
                    .any(|project| project.project_id == context.project_id)
            })
        {
            return Err(RegistryReadError);
        }

        Ok(AdapterRegistrySnapshot {
            fixture_id: self.fixture_id,
            authoritative_read_revision: self.authoritative_read_revision,
            global_asset: FixtureAsset {
                asset_id: self.global_asset.asset_id,
                native_unit_ref: self.global_asset.native_unit_ref,
                display_name: self.global_asset.display_name,
                source_tier_id: self.global_asset.source_tier_id,
                source_tier_label: self.global_asset.source_tier_label,
            },
            projects,
            contexts,
            built_in_adapter: AdapterProvenance {
                identity: self.adapter_registry.built_in.adapter.identity,
                version: self.adapter_registry.built_in.adapter.version,
                source: built_in_source.clone(),
            },
            built_in_rule: RuleProvenance {
                identity: self.adapter_registry.built_in.rule.identity,
                version: self.adapter_registry.built_in.rule.version,
                source: built_in_source,
            },
            active_adapter: AdapterProvenance {
                identity: self.adapter_registry.active_package.adapter.identity,
                version: self.adapter_registry.active_package.adapter.version,
                source: active_source.clone(),
            },
            active_rule: RuleProvenance {
                identity: self.adapter_registry.active_package.rule.identity,
                version: self.adapter_registry.active_package.rule.version,
                source: active_source,
            },
        })
    }
}
