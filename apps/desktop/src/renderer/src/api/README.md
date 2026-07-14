# Desktop Renderer API 模块

本目录集中管理所有 `window.api.*` 调用，提供类型安全的 API 接口。

## 目录结构

```
api/
├── index.ts           # 统一导出入口
├── coding-agent.ts    # Coding Agent API 封装
├── updater.ts         # Updater API 封装
├── window-control.ts  # Window Control API 封装
├── file-system.ts     # File System API 封装
└── runtime.ts         # Runtime API 封装
```

## 使用方式

### 导入 API

```typescript
import { codingAgentApi, updaterApi, windowControlApi } from '@renderer/api'
```

### 示例

#### Coding Agent API

```typescript
// 获取项目列表
const projects = await codingAgentApi.listProjects()

// 创建新线程
const snapshot = await codingAgentApi.createThread({
  projectId: 'your-project-id',
  prompt: { message: 'Hello' }
})

// 监听事件
const unsubscribe = codingAgentApi.onEvent((event) => {
  console.log('Event:', event)
})
```

#### Updater API

```typescript
// 获取更新状态
const state = await updaterApi.getState()

// 检查更新
await updaterApi.check()

// 监听状态变化
updaterApi.onStateChanged((state) => {
  console.log('Update state:', state)
})
```

#### Window Control API

```typescript
// 最小化窗口
await windowControlApi.minimize()

// 获取平台信息
const platform = await windowControlApi.platform()
```

## 优势

1. **类型安全**：所有 API 调用都有完整的 TypeScript 类型支持
2. **集中管理**：所有 IPC 调用集中在一个目录，便于维护
3. **易于测试**：可以轻松 mock 整个 API 模块进行单元测试
4. **一致性**：统一的 API 调用方式，提高代码可读性

## 从旧代码迁移

旧代码：
```typescript
const projects = await window.api.codingAgent.listProjects()
```

新代码：
```typescript
import { codingAgentApi } from '@renderer/api'
const projects = await codingAgentApi.listProjects()
```

## 测试

在测试文件中，可以 mock 整个 API 模块：

```typescript
vi.mock('@renderer/api', () => ({
  codingAgentApi: {
    listProjects: vi.fn(),
    createThread: vi.fn(),
    // ... 其他方法
  }
}))
```
