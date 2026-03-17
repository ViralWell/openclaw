# 允许内网访问网关插件

## 问题

当通过内网IP(如 `192.168.x.x`, `10.x.x.x`, `172.16-31.x.x`)访问OpenClaw网关的插件时,会收到401未授权错误。这是因为默认情况下,网关只允许回环地址(127.0.0.1)绕过认证。

## 解决方案

在网关配置中添加 `gateway.auth.dangerouslyAllowPrivateNetwork` 选项:

```json
{
  "gateway": {
    "auth": {
      "mode": "token",
      "token": "your-token-here",
      "dangerouslyAllowPrivateNetwork": true
    }
  }
}
```

或者使用命令行:

```bash
openclaw config set gateway.auth.dangerouslyAllowPrivateNetwork true
```

## 安全警告

⚠️ **重要**: 启用此选项会允许所有私有网络地址绕过认证。只在以下情况下使用:

1. 你的网关运行在受信任的内网环境中
2. 你的内网有其他安全措施(如防火墙、VPN等)
3. 你完全理解这个选项的安全影响

**不要在公网环境或不受信任的网络中启用此选项!**

## 工作原理

当启用 `dangerouslyAllowPrivateNetwork` 时:

- 来自回环地址(127.0.0.1, ::1)的请求继续绕过认证
- 来自私有网络地址(192.168.x.x, 10.x.x.x, 172.16-31.x.x)的直接请求也会绕过认证
- 来自公网IP的请求仍然需要认证
- 通过代理转发的请求仍然遵循正常的认证流程

## 默认行为

默认情况下,`dangerouslyAllowPrivateNetwork` 为 `false`,只有回环地址可以绕过认证。这是最安全的配置。
