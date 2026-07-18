# torrentToMagnet

[![CI](https://github.com/EnjuYeung/torrentToMagnet/actions/workflows/ci.yml/badge.svg)](https://github.com/EnjuYeung/torrentToMagnet/actions/workflows/ci.yml)

一个可自托管的 `.torrent` 转磁力链接网页工具。文件只在当前浏览器中解析，不会上传到服务器，也不会下载种子所指向的内容。

## 功能

- 支持 BitTorrent v1、v2 和 Hybrid 种子
- 直接哈希原始 `info` 字节，避免重新编码造成 Info Hash 错误
- 读取并选择 Tracker，自动加入兼容的 Web Seed
- 展示种子名称、类型、大小、文件数量和 Info Hash
- 拖拽上传、一键复制、移动端与键盘操作支持
- 20 MiB 文件上限、Bencode 深度和节点数量限制
- 完全离线转换，不依赖远程 API、字体或 CDN

## 使用 Docker

```bash
docker compose up --build -d
```

浏览器打开 [http://localhost:8080](http://localhost:8080)。停止服务：

```bash
docker compose down
```

容器使用非 root 用户运行，并默认启用只读根文件系统、最小权限、安全响应头和健康检查。

## 本地开发

需要 Node.js 22.12，或 Node.js 24 及更高版本。

```bash
npm ci
npm run dev
```

开发服务器默认监听 `http://localhost:5173`。

## 测试

```bash
npm run check
```

该命令会执行核心单元测试、覆盖率检查、TypeScript 类型检查和生产构建。浏览器端到端测试可单独运行：

```bash
npx playwright install chrome
npm run test:e2e
```

GitHub Actions 还会实际构建并以非 root、只读模式启动 Docker 容器，检查健康状态、安全响应头、静态资源 404 行为和完整转换流程。

## 磁力链接规则

- v1：`xt=urn:btih:<40 位 SHA-1>`
- v2：`xt=urn:btmh:1220<64 位 SHA-256>`
- Hybrid：同时写入以上两个 `xt`
- `announce-list` 有效时优先使用它；否则回退到 `announce`
- `url-list` 中的 HTTP(S) Web Seed 会转换为 `ws`

实现遵循 [BEP 3](https://www.bittorrent.org/beps/bep_0003.html)、[BEP 12](https://www.bittorrent.org/beps/bep_0012.html)、[BEP 19](https://www.bittorrent.org/beps/bep_0019.html) 和 [BEP 52](https://www.bittorrent.org/beps/bep_0052.html)。

## 隐私与安全

应用没有上传接口。选择文件后，浏览器使用 JavaScript 读取 `.torrent`、解析 Bencode 并计算哈希；页面不会把文件内容发送到任何位置。生产容器设置了 `connect-src 'none'` 内容安全策略，进一步阻止页面发起网络连接。

请仅处理你有权使用的种子元信息。

## License

[MIT](LICENSE)
