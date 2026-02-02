---
name: login-page-enhancement
overview: 优化登录页面：1) 用户未设置密码时自动跳转到验证码登录；2) 给登录卡片增加透明毛玻璃效果。
todos:
  - id: handle-no-password
    content: 优化用户未设置密码场景：添加状态检测、隐藏密码框、显示友好提示和跳转按钮
    status: completed
  - id: enhance-transparency
    content: 增强登录卡片透明度：调整背景色不透明度和边框样式，实现更明显的毛玻璃效果
    status: completed
  - id: test-verify
    content: 测试验证：确保两种场景正常工作，检查视觉效果和交互逻辑
    status: completed
    dependencies:
      - handle-no-password
      - enhance-transparency
---

## 用户需求

### 1. 用户未设置密码场景优化

**当前问题**：用户在密码登录模式下，如果账户未设置密码，会显示红色错误提示"该账户未设置密码，请使用验证码登录"，但密码输入框仍然可用，用户体验不佳。

**期望效果**：

- 隐藏密码输入框
- 显示友好的提示文字说明账户未设置密码
- 提供明显的跳转按钮，引导用户使用验证码登录或设置密码

### 2. 登录卡片透明度增强

**当前状态**：卡片已有轻微毛玻璃效果（`backdrop-blur-xl`, 背景色 `rgba(255,241,242,0.85)`）

**期望效果**：

- 保持现有布局和位置
- 增强卡片透明度，让背景更明显地透出来
- 类似参考图的半透明毛玻璃效果

## Tech Stack

- 前端框架：Next.js 14 + React + TypeScript
- 样式：Tailwind CSS + 内联样式
- 无需引入新依赖

## Implementation Approach

### 1. 用户未设置密码场景处理

**技术方案**：

- 新增状态 `noPasswordSet: boolean` 用于标识当前账户是否未设置密码
- 监听登录 API 返回的错误信息，当错误为"该账户未设置密码，请使用验证码登录"时设置该状态
- 当 `noPasswordSet` 为 true 时：
- 隐藏密码输入框
- 显示提示区块：包含提示文字和两个操作按钮（"使用验证码登录"、"设置密码"）
- 点击"使用验证码登录"自动切换 `loginMethod` 为 `'code'`
- 点击"设置密码"跳转到密码设置页面（需先验证码登录）
- 当用户切换登录方式或输入账号变化时，重置 `noPasswordSet` 状态

**错误检测逻辑**：

```
if (result.error === '该账户未设置密码，请使用验证码登录') {
  setNoPasswordSet(true);
  setError(''); // 清除通用错误，使用专门的 UI 展示
}
```

### 2. 登录卡片透明度增强

**技术方案**：

- 降低背景色不透明度：从 `rgba(255,241,242,0.85)` 调整为 `rgba(255,255,255,0.65)`
- 保持 `backdrop-blur-xl` 毛玻璃效果
- 优化边框：使用更明显的半透明白色边框 `border: 1px solid rgba(255,255,255,0.3)`
- 确保文字可读性：可能需要微调内部元素的背景色或文字阴影

**样式调整**：

```css
backgroundColor: 'rgba(255,255,255,0.65)'  /* 更透明的白色 */
border: '1px solid rgba(255,255,255,0.3)'  /* 更明显的边框 */
```

## Implementation Notes

### 性能考虑

- 状态变更仅影响局部 UI 重渲染，不影响整体性能
- `backdrop-blur` 已在使用，无额外性能开销

### 兼容性

- `backdrop-filter` 在现代浏览器支持良好
- 降级方案：不支持时显示半透明纯色背景

### 用户体验

- 未设置密码提示使用友好的提示框样式（非红色错误样式）
- 提供清晰的操作引导，减少用户困惑

## Directory Structure

```
src/app/(auth)/login/
└── page.tsx    # [MODIFY] 登录页面组件
                # 1. 新增 noPasswordSet 状态和处理逻辑
                # 2. 添加未设置密码时的提示 UI 组件
                # 3. 调整登录卡片的透明度和毛玻璃样式
```