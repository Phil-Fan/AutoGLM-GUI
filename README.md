# AutoGLM-GUI

AutoGLM 手机助手的现代化 Web 图形界面 - 让 AI 自动化操作手机设备变得简单

![Python](https://img.shields.io/badge/python-3.10+-blue.svg)
![License](https://img.shields.io/badge/license-Apache%202.0-green.svg)
[![PyPI](https://img.shields.io/pypi/v/autoglm-gui)](https://pypi.org/project/autoglm-gui/)
<br/>
  <a href="https://qm.qq.com/q/J5eAs9tn0W" target="__blank">
    <strong>欢迎加入讨论交流群</strong>
  </a>
## ✨ 特性

- **多设备并发控制** - 同时管理和控制多个设备，设备间状态完全隔离
- **双平台支持** - 支持 Android（scrcpy 视频流）和 iOS（截图轮询）
- **对话式任务管理** - 通过聊天界面控制设备
- **实时屏幕预览** - Android 设备支持 scrcpy 低延迟视频流，iOS 设备支持截图轮询
- **直接操控手机** - 在画面上直接点击、滑动操作，支持精准坐标转换和视觉反馈
- **零配置部署** - 支持任何 OpenAI 兼容的 LLM API
- **ADB 深度集成** - 通过 Android Debug Bridge 直接控制 Android 设备
- **WDA iOS 控制** - 通过 WebDriverAgent 控制 iOS 设备
- **模块化界面** - 清晰的侧边栏 + 设备面板设计，功能分离明确

## 📸 界面预览

### 任务开始
![任务开始](https://github.com/user-attachments/assets/b8cb6fbc-ca5b-452c-bcf4-7d5863d4577a)

### 任务执行完成
![任务结束](https://github.com/user-attachments/assets/b32f2e46-5340-42f5-a0db-0033729e1605)

### 多设备控制
![多设备控制](https://github.com/user-attachments/assets/f826736f-c41f-4d64-bf54-3ca65c69068d)

## 🚀 快速开始

## 🎯 模型服务配置

AutoGLM-GUI 只需要一个 OpenAI 兼容的模型服务。你可以：

- 使用官方已托管的第三方服务
  - 智谱 BigModel：`--base-url https://open.bigmodel.cn/api/paas/v4`，`--model autoglm-phone`，`--apikey <你的 API Key>`
  - ModelScope：`--base-url https://api-inference.modelscope.cn/v1`，`--model ZhipuAI/AutoGLM-Phone-9B`，`--apikey <你的 API Key>`
- 或自建服务：参考上游项目的[部署文档](https://github.com/zai-org/Open-AutoGLM/blob/main/README.md)用 vLLM/SGLang 部署 `zai-org/AutoGLM-Phone-9B`，启动 OpenAI 兼容端口后将 `--base-url` 指向你的服务。

示例：

```bash
# 使用智谱 BigModel
pip install autoglm-gui
autoglm-gui \
  --base-url https://open.bigmodel.cn/api/paas/v4 \
  --model autoglm-phone \
  --apikey sk-xxxxx

# 使用 ModelScope
pip install autoglm-gui
autoglm-gui \
  --base-url https://api-inference.modelscope.cn/v1 \
  --model ZhipuAI/AutoGLM-Phone-9B \
  --apikey sk-xxxxx

# 指向你自建的 vLLM/SGLang 服务
pip install autoglm-gui
autoglm-gui --base-url http://localhost:8000/v1 --model autoglm-phone-9b
```

### 前置要求

#### Android 设备
- Python 3.10+
- 已开启 USB 调试的 Android 设备
- 已安装 ADB 并添加到系统 PATH

#### iOS 设备
- Python 3.10+
- macOS 系统（WebDriverAgent 依赖）
- Xcode 命令行工具
- 已配置好 WebDriverAgent 的 iOS 设备
- 已安装 libimobiledevice（`brew install libimobiledevice`）
- 一个 OpenAI 兼容的 API 端点

### 快捷运行（推荐）

**无需手动准备环境，直接安装运行：**

```bash
# 通过 pip 安装并启动
pip install autoglm-gui
autoglm-gui --base-url http://localhost:8080/v1
```

也可以使用 uvx 免安装启动，自动启动最新版（需已安装 uv，[安装教程](https://docs.astral.sh/uv/getting-started/installation/)）：

```bash
uvx autoglm-gui --base-url http://localhost:8080/v1
```

### 传统安装

```bash
# 从源码安装
git clone https://github.com/your-repo/AutoGLM-GUI.git
cd AutoGLM-GUI
uv sync

# 构建前端（必须）
uv run python scripts/build.py

# 启动服务
uv run autoglm-gui --base-url http://localhost:8080/v1
```

启动后，在浏览器中打开 http://localhost:8000 即可开始使用！

## 🔄 升级指南

### 检查当前版本

```bash
# 查看已安装的版本
pip show autoglm-gui

# 或使用命令行参数
autoglm-gui --version
```

### 升级到最新版本

**使用 pip 升级：**

```bash
# 升级到最新版本
pip install --upgrade autoglm-gui
```

## 📖 使用说明

### 多设备管理

AutoGLM-GUI 支持同时控制多个 Android/iOS 设备：

1. **设备列表** - 左侧边栏自动显示所有已连接的设备
2. **设备类型标识** - Android 设备显示 `Android` 图标，iOS 设备显示 `iOS` 图标
3. **设备选择** - 点击设备卡片切换到对应的控制面板
4. **状态指示** - 清晰显示每个设备的在线状态和初始化状态
5. **状态隔离** - 每个设备有独立的对话历史、配置和显示模式

**设备状态说明**：
- 🟢 绿点：设备在线
- ⚪ 灰点：设备离线
- ✓ 标记：设备已初始化
- 🤖 机器人图标：Android 设备
- 🍎 苹果图标：iOS 设备

### AI 自动化模式

1. **连接设备**
   - Android：启用 USB 调试并通过 ADB 连接设备（支持 USB 和 WiFi）
   - iOS：确保 WDA 已启动并通过 iproxy 转发端口（默认 8100）
2. **选择设备** - 在左侧边栏选择要控制的设备
3. **初始化** - 点击"初始化设备"按钮配置 Agent
4. **对话** - 描述你想要做什么（例如："去美团点一杯霸王茶姬的伯牙绝弦"）
5. **观察** - Agent 会逐步执行操作，每一步的思考过程和动作都会实时显示

### 手动控制模式

除了 AI 自动化，你也可以直接在画面上操控手机：

1. **实时画面**
   - Android：基于 scrcpy 的实时视频流
   - iOS：基于 WDA 的截图轮询（500ms 间隔）
2. **点击操作** - 直接点击画面中的任意位置，操作会立即发送到设备
3. **滑动手势** - 按住鼠标拖动实现滑动操作（支持滚轮滚动）
4. **视觉反馈** - 每次操作都会显示涟漪动画和成功/失败提示
5. **精准转换** - 自动处理屏幕缩放和坐标转换，确保操作位置准确
6. **显示模式切换** - Android 支持自动/视频流/截图三种模式，iOS 固定使用截图模式

**技术细节**：
- Android：使用 scrcpy 提供低延迟（~30-50ms）的 H.264 视频流
- iOS：通过 WDA HTTP API 获取截图和执行手势操作
- 前端自动获取设备实际分辨率（如 1080x2400）
- 智能处理视频流缩放（如 576x1280）与设备分辨率的映射
- 支持 letterbox 黑边的精确坐标计算
- 颗粒化触摸事件支持（DOWN、MOVE、UP）实现流畅的手势操作

## 🏗️ 架构设计

### 多设备并发架构

AutoGLM-GUI 采用简化的多设备并发架构，支持同时管理多个 Android/iOS 设备：

**后端设计**：
- 使用字典管理多个 `PhoneAgent` 实例：`agents: dict[str, PhoneAgent]`
- 每个设备有独立的操作实例（Android: `ADBOps`，iOS: `IOSOps`）
- Android 设备使用 `scrcpy` 视频流，iOS 设备使用 WDA 截图轮询
- 设备级别的锁机制，避免不同设备间的阻塞
- 所有 API 接口支持 `device_id` 参数进行设备路由

**前端设计**：
- 使用 `Map<string, DeviceState>` 管理每个设备的独立状态
- 组件化设计，功能职责清晰分离：
  - `DeviceCard` - 单个设备信息卡片（带平台标识）
  - `DeviceSidebar` - 设备列表侧边栏
  - `DevicePanel` - 设备操作面板（ChatBox + Screen Monitor）
- 设备状态完全隔离，互不影响
- iOS 设备自动使用截图模式，不显示视频流选项

**核心特点**：
- ✅ 无任务队列，简化设计
- ✅ 无复杂调度，每个设备独立运行
- ✅ 实时 WebSocket 通信，支持流式响应
- ✅ 自动设备发现和状态同步（每 3 秒刷新）
- ✅ 平台抽象层，统一 Android/iOS 操作接口

## 🍎 iOS 配置指南

如果你已经配置了 WebDriverAgent，可以跳过下面的步骤。

1. XCode
2. WebDriverAgent
3. libimobiledevice

```bash
# 运行 iOS 设置脚本
./scripts/ios_setup/install.sh
```

1. 会自动打开 `WebDriverAgent.xcodeproj`
2. 选择你的开发团队（Team）
3. 修改 Bundle Identifier 为唯一标识（如 `com.yourcompany.WebDriverAgent`）

签名之后，运行下面的脚本配置 WebDriverAgent

```bash
uv run python scripts/ios_setup/setup.py
```

## 🛠️ 开发指南

### 快速开发

```bash
# 后端开发（自动重载）
uv run autoglm-gui --base-url http://localhost:8080/v1 --reload

# 前端开发服务器（热重载）
cd frontend && pnpm dev

### 构建和打包

```bash
# 仅构建前端
uv run python scripts/build.py

# 构建完整包
uv run python scripts/build.py --pack
```

## 📝 开源协议

Apache License 2.0


### 许可证说明

AutoGLM-GUI 使用 MIT 许可证。但是，它打包了 ADB Keyboard APK (`com.android.adbkeyboard`)，该组件使用 GPL-2.0 许可证。ADB Keyboard 组件作为独立工具使用，不影响 AutoGLM-GUI 本身的 MIT 许可。

详见：`AutoGLM_GUI/resources/apks/ADBKeyBoard.LICENSE.txt`

## 🙏 致谢

本项目基于 [Open-AutoGLM](https://github.com/zai-org/Open-AutoGLM) 构建，感谢 zai-org 团队在 AutoGLM 上的卓越工作。
