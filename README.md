# 🚀 自动生成 Dockerfile 的神器

一个用 OpenAI GPT API 为指定的 Git 仓库生成 Dockerfile 的 Node.js 脚本。让你的项目容器化变得超简单！🎉

## 🌟 简介

这个项目提供了一个自动化工具，可以为任何给定的 Git 仓库生成适合生产环境的 Dockerfile。它利用了 OpenAI 的 GPT 模型来分析项目的结构和内容，从而生成高质量的 Dockerfile，帮助开发者们快速容器化应用程序。🤖

## ✨ 特性

- **自动化分析**：使用 GPT 模型智能分析项目，提取关键信息。🕵️‍♂️
- **生成高质量 Dockerfile**：根据最佳实践生成适合生产环境的 Dockerfile。🏆
- **支持多阶段构建**：可选择使用多阶段构建来优化镜像大小。📦
- **自定义模板**：支持使用自定义的 Dockerfile 模板。📝
- **重试机制**：内置 API 调用重试机制，增强稳定性。🔄

## 📥 安装

### 环境要求

- Node.js (版本 >= 14)
- npm 或 yarn 包管理器
- Git

### 克隆项目

```bash
git clone https://github.com/jianzhis/DockerGen
cd DockerGen
```

### 安装依赖

使用 npm：

```bash
npm install
```

或使用 yarn：

```bash
yarn install
```

## 🔧 配置

在项目根目录下创建一个 `.env` 文件，添加以下配置：

```dotenv
GPT_API_URL=<你的 GPT API URL>
GPT_MODEL=<使用的 GPT 模型名称，默认值为 'gpt-4o-mini'>
DEFAULT_USE_MULTI_STAGE=true  # 默认是否使用多阶段构建，设置为 'false' 则默认不使用
MAX_RETRIES=3                 # API 调用的最大重试次数
RETRY_DELAY=1000              # 重试前的延迟时间（毫秒）
TEMPLATE_PATH=<可选，自定义 Dockerfile 模板的路径>
```

请确保替换 `<你的 GPT API URL>` 和其他必要的配置。🌐

## 🚀 使用方法

基本命令格式：

```bash
node app.js <repo_url> [--multi-stage] [--template <template_path>]
```

- `<repo_url>`：必需参数，要克隆和分析的 Git 仓库的 URL。
- `--multi-stage`：可选参数，使用多阶段构建优化镜像大小。
- `--template <template_path>`：可选参数，指定自定义的 Dockerfile 模板路径。

### 参数说明

- **`<repo_url>`**：Git 仓库的 HTTPS 或 SSH 地址。🔗
- **`--multi-stage`**：添加此标志以启用多阶段构建。如果未指定，则使用 `.env` 文件中的配置或默认值。
- **`--template <template_path>`**：指定自定义 Dockerfile 模板的路径，以覆盖默认的生成逻辑。

## 🎯 示例

### 生成简单的 Dockerfile

```bash
node app.js https://github.com/example/repo.git
```

### 使用多阶段构建

```bash
node app.js https://github.com/example/repo.git --multi-stage
```

### 使用自定义模板

```bash
node app.js https://github.com/example/repo.git --template ./Dockerfile.template
```

## ⚠️ 注意事项

- **API 配额**：由于使用了 OpenAI 的 GPT API，请确保你的账户有足够的 API 调用配额。💰
- **安全性**：在克隆和分析未知的仓库时，请注意可能的安全风险。建议在隔离的环境中运行此脚本。🔒
- **性能**：对于大型仓库，分析过程可能需要一些时间。⏳

## 📄 许可证

[MIT 许可证](LICENSE)

## 👤 作者

Sekey