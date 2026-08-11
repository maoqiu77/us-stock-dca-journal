# 股票交易平台 Next

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

- Windows 电脑：下载 `stock-trading-platform-next-v0.1.6-windows-x64.zip`
- Apple 芯片 Mac（M1/M2/M3/M4）：下载 `stock-trading-platform-next-v0.1.6-macos-arm64.zip`
- Intel 芯片 Mac：下载 `stock-trading-platform-next-v0.1.6-macos-x64.zip`

不要下载 GitHub 自动生成的 `Source code (zip)`，那个是给开发者看的源码包，不是一键运行包。

## Windows 使用方法

1. 下载 `stock-trading-platform-next-v0.1.6-windows-x64.zip`。
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
