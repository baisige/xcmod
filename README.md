# XCMOD - Game Memory Editor

[![License](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Platform](https://img.shields.io/badge/platform-Windows-blue.svg)](https://github.com/yourusername/xcmod)
[![Version](https://img.shields.io/badge/version-1.0.0-green.svg)](https://github.com/yourusername/xcmod)

一个基于 Electron 开发的游戏内存修改工具，支持内存扫描、地址搜索和单次内存修改功能。

---

## 💰 打赏支持

如果觉得这个工具对你有帮助，可以请作者喝杯咖啡 ☕

打赏图片请放置在项目根目录下的 `donate.png` 文件。

---

## ✨ 功能特性

- 🎮 **内存扫描** - 支持多种数据类型（int/float/double/byte/short）的精确扫描
- 🔍 **智能筛选** - 支持多次扫描缩小搜索范围，类似 Cheat Engine
- 💾 **插件系统** - 通过 JSON 配置文件管理游戏修改项
- 📝 **单次修改** - 安全的单次内存写入，不影响游戏进程
- 🌍 **多语言支持** - 支持中文和英文界面
- 🎯 **进程管理** - 自动获取系统进程列表，支持搜索和筛选

## 🛠️ 技术栈

- **框架**: Electron 28
- **语言**: JavaScript (ES6+)
- **UI**: 原生 HTML/CSS/JavaScript
- **内存操作**: Windows API via PowerShell/C#
- **国际化**: i18next

## 📥 安装与运行

### 环境要求

- Windows 10/11 (64位)
- Node.js 18+
- 管理员权限（用于内存操作）

### 开发模式

```bash
# 克隆仓库
git clone https://github.com/baisige/xcmod.git
cd xcmod

# 安装依赖
npm install

# 运行开发模式
npm start
```

### 打包发布

```bash
# 打包为可执行文件
npm run dist

# 生成的文件在 dist/ 目录下
```

## 📖 使用说明

### 基本使用流程

1. **选择目标进程**
    - 点击进程下拉框，选择目标游戏进程
    - 建议以管理员身份运行软件

2. **内存扫描**
    - 在内存扫描区域输入初始数值
    - 选择数据类型（通常使用 int）
    - 点击「开始扫描」

3. **筛选结果**
    - 回到游戏改变数值
    - 在「第二次值」输入框输入新数值
    - 点击「重新扫描」缩小范围

4. **添加修改项**
    - 点击扫描结果旁的「添加」按钮
    - 输入修改项名称并确认

5. **执行修改**
    - 在右侧修改项面板输入目标值
    - 点击「单次修改」按钮

### 插件配置格式

插件配置文件放置在 `games/` 目录下，格式如下：

```json
{
  "id": "game-id",
  "name": "游戏名称",
  "executable": "Game.exe",
  "description": "游戏描述",
  "online": false,
  "cheats": [
    {
      "id": "cheat-1",
      "name": "无限生命",
      "address": "0x12345678",
      "value": 999,
      "dataType": "int"
    }
  ]
}
```

### 数据类型说明

| 类型 | 说明 | 适用场景 |
|------|------|----------|
| int | 32位整数 | 生命值、金钱、等级 |
| float | 单精度浮点 | 百分比、坐标 |
| double | 双精度浮点 | 高精度数值 |
| byte | 8位字节 | 开关状态 |
| short | 16位整数 | 小范围数值 |

## ⚠️ 重要提示

1. **使用权限**: 必须以管理员身份运行才能进行内存操作
2. **联机游戏**: 请勿在联机游戏中使用，可能导致账号封禁
3. **数据安全**: 修改内存可能导致游戏崩溃，请提前存档
4. **责任声明**: 作者不对使用本工具造成的任何后果负责

## 📁 项目结构

```
xcmod/
├── games/          # 游戏插件配置目录
├── locales/        # 国际化翻译文件
├── Manual/         # 使用手册
├── app.js          # 渲染进程主逻辑
├── main.js         # 主进程入口
├── preload.js      # 预加载脚本
├── i18n.js         # 国际化配置
├── index.html      # 主界面
└── package.json    # 项目配置
```

## 🤝 贡献

欢迎提交 Issue 和 Pull Request！

## 📄 许可证

MIT License - 详见 [LICENSE](LICENSE)

## 💰 打赏支持

如果觉得这个工具对你有帮助，可以请作者喝杯咖啡 ☕

打赏图片请放置在项目根目录下的 `donate.png` 文件。

---

**⚠️ 免责声明**: 本工具仅用于学习和研究目的，请遵守游戏用户协议和相关法律法规。
