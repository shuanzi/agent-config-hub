//! Tauri IPC 边缘（ARC-02b/ARC-02c）。
//!
//! - 唯一生产 command：`frontend_gateway_read`；
//! - ingress 依次校验大小上限、wireVersion、payload shape，再转 domain 调用
//!   `GatewayCore::read`；任何 wire fault 归一化为
//!   `ReadFailed(GATEWAY_UNAVAILABLE, retryRead)`，异常字符串不出本模块；
//! - domain 结果（含 ReadFailed）作为成功 command response 的 payload 返回，
//!   command 本身只对“连 envelope 都无法产出”的极端情况报错；
//! - 事件 helper 发送 `acm://workspace-invalidation`，payload 只含
//!   wireVersion + 最小事件，不携带任何事实内容或路径明文。

use serde_json::Value;

use crate::core::GatewayCore;
use crate::domain;
#[cfg(any(feature = "test-harness", test))]
use crate::wire::WorkspaceEventEnvelope;
use crate::wire::{
    ReadFailedWire, ReadRequestEnvelope, ReadResponseEnvelope, ReadResponsePayload, ReasonCodeWire,
    RecoveryActionWire, GATEWAY_WIRE_VERSION,
};

/// request envelope 序列化后的大小上限（ARC-02b ingress 约束）。
pub const MAX_REQUEST_BYTES: usize = 64 * 1024;

/// 唯一 invalidation event 名（ARC-02b）。
pub const WORKSPACE_INVALIDATION_EVENT: &str = "acm://workspace-invalidation";

/// 归一化后的 wire fault 响应（ARC-02c：UI 只消费 GATEWAY_UNAVAILABLE）。
fn gateway_unavailable(request_id: &str) -> ReadResponseEnvelope {
    ReadResponseEnvelope {
        wire_version: GATEWAY_WIRE_VERSION,
        request_id: request_id.to_string(),
        payload: ReadResponsePayload::ReadFailed(ReadFailedWire {
            reason_code: ReasonCodeWire::GatewayUnavailable,
            message: "本地 gateway 暂时不可用，请重试。".to_string(),
            recovery_action: Some(RecoveryActionWire::RetryRead),
        }),
    }
}

/// 纯 ingress 处理：可脱离 Tauri runtime 直接被 L1 测试调用。
pub fn handle_read(core: &GatewayCore, raw: &Value) -> ReadResponseEnvelope {
    // requestId 只用于脱敏关联；取不到时用空串，不影响归一化结果。
    let request_id = raw
        .get("requestId")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();

    // 1. 大小上限
    let oversized = serde_json::to_string(raw)
        .map(|text| text.len() > MAX_REQUEST_BYTES)
        .unwrap_or(true);
    if oversized {
        return gateway_unavailable(&request_id);
    }

    // 2. wireVersion 必须在进入 core 前封闭失败
    let version_ok = raw
        .get("wireVersion")
        .and_then(Value::as_u64)
        .map(|version| version == u64::from(GATEWAY_WIRE_VERSION))
        .unwrap_or(false);
    if !version_ok {
        return gateway_unavailable(&request_id);
    }

    // 3. payload shape：deny_unknown_fields 拒绝未知 tag/字段/缺失字段
    let envelope: ReadRequestEnvelope = match serde_json::from_value(raw.clone()) {
        Ok(envelope) => envelope,
        Err(_) => return gateway_unavailable(&request_id),
    };

    // 4. domain 结果作为成功 payload；domain ReadFailed 原样携带稳定原因码
    let query = domain::Query::from(envelope.payload);
    let result = core.read(&query);
    ReadResponseEnvelope {
        wire_version: GATEWAY_WIRE_VERSION,
        request_id: envelope.request_id,
        payload: result.into(),
    }
}

/// ARC-02b 唯一生产 verb command（FE-01 不实现 prepare/apply）。
#[tauri::command]
pub async fn frontend_gateway_read(
    core: tauri::State<'_, GatewayCore>,
    request: Value,
) -> Result<Value, Value> {
    let response = handle_read(&core, &request);
    serde_json::to_value(&response)
        .map_err(|_| serde_json::to_value(gateway_unavailable("")).unwrap_or(Value::Null))
}

/// 生产 adapter 的唯一 invalidation event（事件失败不改变已确定的 domain
/// 结果，调用方最多因此少一次提示重读，事件丢失/重复本就是允许语义）。
#[cfg(any(feature = "test-harness", test))]
pub fn emit_workspace_event(app: &tauri::AppHandle, event: &domain::WorkspaceEvent) {
    use tauri::Emitter;
    let envelope = WorkspaceEventEnvelope {
        wire_version: GATEWAY_WIRE_VERSION,
        event: event.clone().into(),
    };
    let _ = app.emit(WORKSPACE_INVALIDATION_EVENT, envelope);
}

// ---------------------------------------------------------------------------
// test-harness 专用 command（只在 feature 下编译进 harness 二进制）
// ---------------------------------------------------------------------------

/// L3 测试驱动：向隔离 fixture 根的 SKILL.md 追加一行确定性的合成标记注释，
/// 随后发送 `assetsInvalidated`。仅在 `test-harness` feature 下编译；
/// 运行时要求 `ACM_NATIVE_ROOT` 已设置，且只允许写该根内的 fixture 文件。
#[cfg(feature = "test-harness")]
#[tauri::command]
pub async fn test_fx01_external_change(
    app: tauri::AppHandle,
    counter: tauri::State<'_, Fx01ExternalChangeCounter>,
) -> Result<String, String> {
    use std::fmt::Write as _;
    use std::io::Write as _;

    let root = std::env::var_os("ACM_NATIVE_ROOT")
        .filter(|value| !value.is_empty())
        .map(std::path::PathBuf::from)
        .ok_or_else(|| "ACM_NATIVE_ROOT not set; refusing external change".to_string())?;

    let skill_md = root.join("skills").join("demo-skill").join("SKILL.md");
    if !skill_md.is_file() {
        return Err("fixture SKILL.md not found under ACM_NATIVE_ROOT".to_string());
    }

    let n = counter.next();
    let mut line = String::new();
    let _ = write!(line, "\n<!-- fx01-external-change-{n} -->\n");
    let mut file = std::fs::OpenOptions::new()
        .append(true)
        .open(&skill_md)
        .map_err(|_| "failed to open fixture SKILL.md for append".to_string())?;
    file.write_all(line.as_bytes())
        .map_err(|_| "failed to append fixture marker".to_string())?;

    emit_workspace_event(
        &app,
        &domain::WorkspaceEvent::AssetsInvalidated {
            asset_type: Some(domain::AssetType::Skill),
        },
    );
    Ok(format!("fx01-external-change-{n}"))
}

/// 合成标记序号（每个 harness 进程从 1 开始，确定性）。
#[cfg(feature = "test-harness")]
pub struct Fx01ExternalChangeCounter(std::sync::atomic::AtomicU64);

#[cfg(feature = "test-harness")]
impl Fx01ExternalChangeCounter {
    fn next(&self) -> u64 {
        self.0.fetch_add(1, std::sync::atomic::Ordering::SeqCst) + 1
    }
}

#[cfg(feature = "test-harness")]
impl Default for Fx01ExternalChangeCounter {
    fn default() -> Self {
        Self(std::sync::atomic::AtomicU64::new(0))
    }
}
