# 局域网访问配置指南

让同局域网（如同机房）的同学通过浏览器访问本系统。

## 前置要求

- WSL2 已启用[镜像网络模式](https://learn.microsoft.com/zh-cn/windows/wsl/networking#mirrored-mode-networking)（WSL 与 Windows 共享同一 IP）
- Windows 11（支持镜像网络模式）
- 前后端均正常运行

## 操作步骤

### 1. `.env` — 取消注释 LAN 配置

编辑 `.env`，取消这两行的注释：

```env
HOST=0.0.0.0
CORS_ORIGINS=*
```

- `HOST=0.0.0.0` 让后端监听所有网络接口
- `CORS_ORIGINS=*` 允许所有来源跨域访问

恢复本地部署时重新注释这两行即可，无需改代码。

> 如果你想让 CORS 更精确，也可以用 `CORS_ORIGINS=http://localhost:5173,http://10.x.x.x:5173` 指定具体 IP。

### 3. Windows 防火墙放行端口

以**管理员身份**打开 PowerShell，执行：

```powershell
New-NetFirewallRule -DisplayName "WSL Backend 8000" -Direction Inbound -Protocol TCP -LocalPort 8000 -Action Allow
New-NetFirewallRule -DisplayName "WSL Frontend 5173" -Direction Inbound -Protocol TCP -LocalPort 5173 -Action Allow
```

**查看规则是否生效**（同样在管理员 PowerShell 中执行）：

```powershell
Get-NetFirewallRule -DisplayName "WSL Backend 8000","WSL Frontend 5173" | Format-Table DisplayName,Enabled,Direction,Action
```

**用完关闭端口**（同样在管理员 PowerShell 中执行）：

```powershell
Remove-NetFirewallRule -DisplayName "WSL Backend 8000"
Remove-NetFirewallRule -DisplayName "WSL Frontend 5173"
```

### 4. 重启服务

```bash
# WSL 中重启后端
python main.py

# 前端已用 npx vite --host 启动则无需操作
```

### 5. 获取你的 IP 并分享给同学

```bash
# WSL 中查看
ip addr show eth0 | grep inet

# 或 Windows 中查看
ipconfig
```

找到你的局域网 IP（如 `10.3.x.x`、`172.x.x.x`、`192.168.x.x`）。

同学在浏览器访问：
```
http://<你的IP>:5173
```

## 不需要改动的

- Vite 代理配置（`/api` → `127.0.0.1:8000` 是服务端代理，不受跨域影响）
- WSL 网络配置（镜像模式已启用则无需额外操作）

## 故障排查

| 现象 | 可能原因 | 解决 |
|------|---------|------|
| 无法连接 | 防火墙未放行 | 检查步骤 3 |
| 前端页面空白 / API 请求失败 | CORS 未配置 | 检查步骤 2 |
| 同学能打开页面但接口 502 | 后端未启动或端口不对 | 检查 `python main.py` 是否运行 |
