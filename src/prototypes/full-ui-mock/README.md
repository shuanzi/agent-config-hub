# 历史 Full UI Mock

本目录是保留用于回归测试的 throwaway 原型，不是当前产品或验收入口。现行行为见[产品说明](../../../docs/product/README.md)，可操作入口见[验收指南](../../../docs/acceptance/polished-ui.md)。

`npm run mock:ui` 启动历史原型；`prototype=full-ui` 的数据和操作仅存在于内存，不写入 Agent 文件。`variant=A|B|C|selected`、`journey`、`scenario`、`controls` 和 `inherit` 参数用于已有测试与历史方案回看，不承诺与正式 App 一致。

原型中的搜索、分页、转换、事务及候选布局不属于现行产品契约。代码与相关测试保留，历史影响台账和旧截图通过 Git 历史追溯。请勿把此页面的截图用作正式 App 已完成的证据。
