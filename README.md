<a id="english"></a>

# Stock Trading Platform Next

[English](#english) | [中文](#中文)

Stock Trading Platform Next is a local stock research and trading-assistance
tool. It opens a web interface on your computer for viewing watchlists,
candlestick charts, account summaries, strategy signals, backtest results, and
AI-generated advice.

Data is stored on your computer by default and is not automatically uploaded to
the cloud. Public releases contain sample data only and do not include the
author's real accounts, positions, trade records, or API keys.

## Who it is for

- People who want to manage watchlists and trade records through a web interface.
- People who want daily, weekly, monthly, one-day intraday, and five-day intraday charts.
- People who prefer to keep private trading data on their own computer.
- People who do not use the command line: download the correct archive, extract it, and double-click the launcher.

## Download

Download a package from the
[Releases page](https://github.com/maoqiu77/stock-trading-platform-next/releases):

- Windows: `stock-trading-platform-next-v0.1.7-windows-x64.zip`
- Apple Silicon Mac (M1/M2/M3/M4): `stock-trading-platform-next-v0.1.7-macos-arm64.zip`
- Intel Mac: `stock-trading-platform-next-v0.1.7-macos-x64.zip`

Do not download GitHub's automatically generated `Source code (zip)` archive.
It contains source code for developers, not the ready-to-run application.

## Windows

1. Download `stock-trading-platform-next-v0.1.7-windows-x64.zip`.
2. Right-click the archive and select **Extract All**.
3. Open the extracted folder.
4. Double-click `启动股票交易平台.exe`.
5. Wait for the browser to open `http://127.0.0.1:3000/`.

Keep the console window open while using the application. Closing it stops the
local services.

## macOS

1. Download the package for your Mac's processor.
2. Double-click the archive to extract it.
3. Open the extracted folder.
4. Double-click `启动股票交易平台.command`.
5. Wait for the browser to open `http://127.0.0.1:3000/`.

If macOS prevents the launcher from opening:

1. Right-click `启动股票交易平台.command`.
2. Select **Open**.
3. Select **Open** again in the confirmation dialog.

Keep the Terminal window open while using the application. Closing it stops the
local services.

## Phone or tablet access

After starting the application, connect the computer and mobile device to the
same Wi-Fi network. Open the computer's local network address in the mobile
browser:

```text
http://<computer-local-IP>:3000
```

For example, if the computer's IP address is `192.168.1.20`, open:

```text
http://192.168.1.20:3000
```

This is a responsive web interface, not a native iOS or Android application.

## Data storage

Local runtime data is stored inside the extracted application folder at:

```text
storage/local/
```

This directory may contain account balances, positions, trade records, and AI
settings. Do not share `storage/local/` when backing up or distributing the
project.

Public sample data is stored at:

```text
storage/templates/
```

## Troubleshooting

### The browser does not open after launching

Wait up to one minute. If it still does not open, visit:

```text
http://127.0.0.1:3000/
```

### A port is already in use

Another process is using port `3000` or `8000`. Close the previous application
window, or restart the computer and try again.

### Windows displays a security warning

The launcher is not distributed through an app store and is not code-signed.
Confirm that the file came from this project's Releases page before running it.

### macOS cannot verify the developer

The launcher is not signed by an Apple Developer certificate. Use
**Right-click → Open** to start it.

## Development

To run from source:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
npm --prefix apps/web install
npm run dev:api
npm run dev:web
```

Before a release, run:

```bash
npm run check:public-safety
npm run check:release-readiness
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

## Contributing

Contributions are welcome. Before opening a pull request, read
[CONTRIBUTING.md](CONTRIBUTING.md) and run the required test and release checks.
Never include real account data, portfolio data, trade records, API keys, logs,
or local databases in an issue or contribution.

## Security

Do not report vulnerabilities or sensitive data in public issues. Follow the
private reporting instructions in [SECURITY.md](SECURITY.md).

## Maintainer

This repository is created and primarily maintained by
[@maoqiu77](https://github.com/maoqiu77), including architecture, releases,
public-data checks, and ongoing maintenance.

## License

Licensed under the [Apache License 2.0](LICENSE).

---

<a id="中文"></a>

# 股票交易平台 Next

[English](#english) | [中文](#中文)

这是一个本地运行的股票研究和交易辅助工具。它会在你的电脑上打开一个网页界面，用来查看自选股、K 线图、账户概览、策略信号、回测结果和 AI 建议。

数据默认保存在你自己的电脑里，不会自动上传到云端。公开版本只带示例数据，不包含作者的真实账户、持仓、交易记录或 API 密钥。

## 适合谁使用

- 想用网页界面管理自选股和交易记录的人。
- 想查看日 K、周 K、月 K、1 日分时、5 日分时的人。
- 想在本地保存自己的交易数据，不想把私密数据提交到网上的人。
- 不熟悉命令行也可以使用：下载对应系统的压缩包，解压后双击启动。

## 下载哪个文件

请到 Release 页面下载：

https://github.com/maoqiu77/stock-trading-platform-next/releases

根据自己的电脑选择一个压缩包：

- Windows 电脑：下载 `stock-trading-platform-next-v0.1.7-windows-x64.zip`
- Apple 芯片 Mac（M1/M2/M3/M4）：下载 `stock-trading-platform-next-v0.1.7-macos-arm64.zip`
- Intel 芯片 Mac：下载 `stock-trading-platform-next-v0.1.7-macos-x64.zip`

不要下载 GitHub 自动生成的 `Source code (zip)`，那个是给开发者看的源码包，不是一键运行包。

## Windows 使用方法

1. 下载 `stock-trading-platform-next-v0.1.7-windows-x64.zip`。
2. 右键压缩包，选择“全部解压”。
3. 打开解压后的文件夹。
4. 双击 `启动股票交易平台.exe`。
5. 等待浏览器自动打开 `http://127.0.0.1:3000/`。

启动后不要关闭黑色窗口。关闭窗口后，本地服务也会停止。

## Mac 使用方法

1. 下载适合自己芯片的 macOS 压缩包。
2. 双击压缩包解压。
3. 打开解压后的文件夹。
4. 双击 `启动股票交易平台.command`。
5. 等待浏览器自动打开 `http://127.0.0.1:3000/`。

如果 macOS 提示无法打开：

1. 右键点击 `启动股票交易平台.command`。
2. 选择“打开”。
3. 在弹窗里再次选择“打开”。

启动后不要关闭终端窗口。关闭窗口后，本地服务也会停止。

## 手机或平板访问

电脑启动成功后，手机和电脑连接同一个 Wi-Fi，可以用手机浏览器访问电脑的局域网地址：

```text
http://<电脑局域网 IP>:3000
```

例如电脑 IP 是 `192.168.1.20`，就在手机浏览器打开：

```text
http://192.168.1.20:3000
```

这是响应式网页端，不是原生 iOS/Android App。

## 数据保存在哪里

你的本地数据会保存在解压文件夹里的：

```text
storage/local/
```

这个文件夹可能包含你的账户金额、持仓、交易记录、AI 设置等私密数据。备份或分享项目时，不要把 `storage/local/` 发给别人。

公开示例数据在：

```text
storage/templates/
```

## 常见问题

### 双击后浏览器没有打开

先等 1 分钟。如果还没有打开，可以手动访问：

```text
http://127.0.0.1:3000/
```

### 提示端口被占用

说明电脑上已经有别的程序占用了 `3000` 或 `8000` 端口。可以先关闭旧的启动窗口，或者重启电脑后再试。

### Windows 提示有安全风险

这是因为启动器不是商店应用，也没有代码签名。请确认文件来自本项目 Release 页面后再运行。

### Mac 提示无法验证开发者

这是因为启动器没有 Apple 开发者签名。请使用“右键 → 打开”的方式启动。

## 给开发者

如果你想从源码运行：

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r apps/api/requirements.txt
npm --prefix apps/web install
npm run dev:api
npm run dev:web
```

发布前检查：

```bash
npm run check:public-safety
npm run check:release-readiness
npm --prefix apps/web run lint
npm --prefix apps/web run build
```

## 参与贡献

欢迎参与贡献。提交 Pull Request 前，请阅读
[CONTRIBUTING.md](CONTRIBUTING.md)，并运行其中要求的测试和发布检查。
不要在 Issue 或贡献内容中包含真实账户、投资组合、交易记录、API 密钥、日志或本地数据库。

## 安全问题

不要在公开 Issue 中报告漏洞或敏感数据。请按照
[SECURITY.md](SECURITY.md) 中的说明进行私密报告。

## 维护者

本仓库由 [@maoqiu77](https://github.com/maoqiu77) 创建并主要维护，
包括架构、版本发布、公开数据检查和持续维护。

## 许可证

本项目采用 [Apache License 2.0](LICENSE) 许可证。
