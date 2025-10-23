# sproto-js

一个用于 JavaScript/TypeScript 的 sproto 协议库，这是原版 [zhangshiqian1214/sproto-js](https://github.com/zhangshiqian1214/sproto-js) 的 TypeScript 重构版本。

## 简介

sproto 是一个轻量级的二进制协议，类似于 Google Protocol Buffers，但更加简洁。本库提供了在 TypeScript 环境中使用 sproto 协议的完整实现。

## 特性

- 🚀 **TypeScript 支持**：完整的类型定义和类型安全
- 📦 **轻量级**：无外部依赖，体积小巧
- 🔧 **易于使用**：简单的 API 设计
- 🎯 **高性能**：优化的编解码算法
- 🌐 **跨平台**：支持 Node.js 和浏览器环境

## 安装

```bash
bun add @imhanxi/sproto-js
```

或使用 npm：

```bash
npm install @imhanxi/sproto-js
```

## 快速开始

### 1. 定义协议文件

创建 `.sproto` 文件定义你的协议结构：

```sproto
# proto/login.sproto
.context {
    rid 0 : integer
    proto_checksum 1 : string
}

login 101 {
    request {
        token 0 : string
        ctx 1 : context
    }
    response {
        code 0 : integer
        account 1 : string
        gamenode 2 : string
    }
}
```

### 2. 编译协议文件

将 `.sproto` 文件编译成 `.spb` 二进制文件（需要 sproto 编译器）。

### 3. 使用示例

```typescript
import fs from "fs";
import sproto from "@imhanxi/sproto-js";

// 读取编译后的协议文件
const bundle = new Uint8Array(fs.readFileSync("./protocol.spb"));

// 创建 sproto 实例
const sp = sproto.createNew(bundle);

// 创建主机实例
const client = sp.host("base.package");
const clientRequest = client.attach(sp);

// 编码请求数据
const data = {
    token: "your-jwt-token",
    ctx: {
        proto_checksum: "xxxxx",
    },
};

const req = clientRequest("login.login", data);
console.log("编码后的请求数据长度:", req.length);

// 解码响应数据
const ret = client.dispatch(req);
console.log("解码结果:", ret);
```

## API 文档

### sproto.createNew(bundle: Uint8Array)

从编译后的协议文件创建 sproto 实例。

**参数:**
- `bundle`: 编译后的 `.spb` 文件内容

**返回值:**
- `SprotoInstance`: sproto 实例对象

### instance.host(packageName?: string)

创建协议主机实例。

**参数:**
- `packageName`: 包名（可选）

**返回值:**
- `SprotoHost`: 主机实例

### host.attach(sp: SprotoInstance)

创建请求编码函数。

**参数:**
- `sp`: sproto 实例

**返回值:**
- 编码函数：`(name: string, args: object) => Uint8Array`

### host.dispatch(buffer: Uint8Array)

解码接收到的数据包。

**参数:**
- `buffer`: 要解码的数据包

**返回值:**
- 解码后的对象

## 支持的数据类型

| 类型 | 描述 |
|------|------|
| **string** | 字符串类型 |
| **binary** | 二进制字符串（字符串的子类型） |
| **integer** | 整数，最大长度为有符号 52 位（符合 IEEE 754 标准） |
| **double** | 双精度浮点数，符合 [IEEE 754 标准](https://en.wikipedia.org/wiki/Double-precision_floating-point_format) |
| **boolean** | 布尔值：true 或 false |

## 项目结构

```
sproto-js/
├── src/
│   └── sproto.ts          # 主要实现文件
├── proto/
│   ├── base.sproto        # 基础协议定义
│   └── login.sproto       # 登录协议定义
├── test.ts                # 使用示例
├── package.json
└── README.md
```

## 开发

### 构建项目

```bash
bun run build
```

### 运行测试

```bash
bun run test.ts
```

### 代码检查

```bash
bunx tsc -p tsconfig.json
```

## 许可证

MIT License

## 贡献

欢迎提交 Issue 和 Pull Request！

## 相关链接

- [GitHub 仓库](https://github.com/hanxi/sproto-js)
- [问题反馈](https://github.com/hanxi/sproto-js/issues)
- [sproto 协议规范](https://github.com/cloudwu/sproto)





 

