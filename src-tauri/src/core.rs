//! ARC-03 GatewayCore 的 FE-01 最小切片：只实现 `read`。
//!
//! 不实现 prepare/apply，也不预留 stub command（FE-01 硬边界）。
//! core 只使用 domain 类型，不知道 Tauri、wire DTO 或 IPC 细节。

use crate::catalog::{mask_synthetic_secrets, Catalog};
use crate::domain::{Query, ReadFailure, ReadResult, ReasonCode, RecoveryAction, Snapshot};
use crate::{
    adapter_registry::AdapterRegistry, project_applicability::ProjectApplicabilityResolver,
};

pub struct GatewayCore {
    catalog: Catalog,
    adapter_registry: AdapterRegistry,
}

impl GatewayCore {
    pub fn new(catalog: Catalog) -> Self {
        GatewayCore {
            catalog,
            adapter_registry: AdapterRegistry::from_env(),
        }
    }

    pub fn with_adapter_registry(catalog: Catalog, adapter_registry: AdapterRegistry) -> Self {
        GatewayCore {
            catalog,
            adapter_registry,
        }
    }

    /// 唯一 verb（FE-01）。domain 失败统一为稳定原因码 + retryRead。
    pub fn read(&self, query: &Query) -> ReadResult<Snapshot> {
        match query {
            Query::AssetList(list_query) => {
                ReadResult::Succeeded(Snapshot::AssetList(self.catalog.asset_list(list_query)))
            }
            Query::ProjectApplicability(query) => {
                let resolver = ProjectApplicabilityResolver::new(self.adapter_registry.clone());
                match resolver.read(query) {
                    Ok(snapshot) => ReadResult::Succeeded(Snapshot::ProjectApplicability(snapshot)),
                    Err(failure) => ReadResult::Failed(failure),
                }
            }
            Query::AssetDetail(detail_query) => {
                match self.catalog.asset_detail(&detail_query.asset) {
                    Some(snapshot) => ReadResult::Succeeded(Snapshot::AssetDetail(snapshot)),
                    None => Self::read_failed("资产不存在或当前不可读，请重读。"),
                }
            }
            Query::NativeFile(file_query) => {
                match self
                    .catalog
                    .native_file(&file_query.asset, &file_query.file_id)
                {
                    Some(snapshot) => ReadResult::Succeeded(Snapshot::NativeFile(snapshot)),
                    None => Self::read_failed("文件不存在或当前不可读，请重读。"),
                }
            }
        }
    }

    fn read_failed(message: &str) -> ReadResult<Snapshot> {
        ReadResult::Failed(ReadFailure {
            reason_code: ReasonCode::ReadFailed,
            // 人类可读 message 统一过出口遮蔽（当前为固定文案，遮蔽是恒等防御）。
            message: mask_synthetic_secrets(message),
            recovery_action: Some(RecoveryAction::RetryRead),
        })
    }
}
