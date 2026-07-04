# 设计记录

## 桌面端 Select

范围：`apps/desktop/src/renderer/src/components/ui/select`。

- `SelectTrigger` 支持 `variant="borderless"`，用于 composer 项目选择器这类内联控件。
- 无边框 trigger 不应出现可见边框、背景、阴影、hover 背景或 focus ring。
- 默认 trigger 变体保持原样，用于设置页等表单型控件。
- `SelectContent` 参考 context menu 的紧凑样式：圆角浮层、保留投影、无可见边框、无 focus outline，并使用紧凑内边距。
- `SelectItem` 保持紧凑的菜单项观感：允许轻量 focus 背景，但选项自身不应有 box shadow 或 outline。
- 已选项指示图标应保持低干扰、节省空间，让选项文本成为主要视觉锚点。
