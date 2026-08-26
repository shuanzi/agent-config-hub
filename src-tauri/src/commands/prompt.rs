//! 长期指令文档命令层。

use crate::error::{format_structured_error, is_structured_error_payload, AppError};
use crate::services::instruction::{
    InstructionDocument, InstructionDocumentKind, InstructionDocumentService,
};
use crate::services::project::{ConfigContext, ScopeTarget};
use crate::AppState;

fn map_err(err: AppError) -> String {
    if let AppError::Message(payload) = &err {
        if is_structured_error_payload(payload) {
            return payload.clone();
        }
    }

    log::warn!("长期指令命令未映射错误: {err:#}");
    format_structured_error("INSTRUCTION_INTERNAL", &[], Some("checkLogs"))
}

/// 读取指定上下文的固定长期指令文档。`all` 中每一行自带其 mutation target。
#[tauri::command]
pub async fn get_instruction_documents(
    context: ConfigContext,
    state: tauri::State<'_, AppState>,
) -> Result<Vec<InstructionDocument>, String> {
    InstructionDocumentService::get_documents_for_context(&state, &context).map_err(map_err)
}

/// 保存一个固定长期指令文档；不支持按 Agent enable、预设 CRUD 或物理删除。
#[tauri::command]
pub async fn upsert_instruction_document(
    target: ScopeTarget,
    kind: InstructionDocumentKind,
    content: String,
    state: tauri::State<'_, AppState>,
) -> Result<(), String> {
    InstructionDocumentService::upsert_document(&state, &target, kind, &content).map_err(map_err)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn map_err_passes_through_structured_errors() {
        let structured = format_structured_error(
            "INSTRUCTION_PROJECTIONS_DIVERGED",
            &[],
            Some("resolveInstructionProjectionConflict"),
        );
        let err = AppError::Message(structured.clone());
        assert_eq!(map_err(err), structured);
    }

    #[test]
    fn map_err_masks_plain_errors() {
        let err = AppError::InvalidInput("raw details".to_string());
        let mapped = map_err(err);
        assert!(mapped.contains("INSTRUCTION_INTERNAL"));
        assert!(!mapped.contains("raw details"));
    }
}
