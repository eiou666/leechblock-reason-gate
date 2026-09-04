# LeechBlock Reason Gate

一个供 LeechBlock NG 使用的极简本机理由页。访问受限网站时，页面只显示一个空白输入框和一个“确定”按钮；输入至少 5 个非空白字符后，LeechBlock 才开始倒计时并临时放行目标网站。

默认配置示例：每天 `07:00–22:00` 启用理由门，每次通过后放行当前访问会话 30 分钟，倒计时 5 秒。

## 工作方式

1. LeechBlock 把目标页重定向到本机理由页。
2. 理由页只在浏览器内检查输入长度；理由不会上传或保存。
3. 输入合格后页面重新加载，并创建 LeechBlock 识别的 `lbDelaySeconds` 元素。
4. LeechBlock 自己完成 5 秒倒计时、30 分钟临时放行和原页面跳转。

30 分钟的放行状态由 LeechBlock 绑定到当前标签页。关闭标签页后新开网站，通常需要重新填写理由；同一标签页内访问同一 Block Set 的页面则继续使用剩余放行时间。

## 项目结构

```text
leechblock-reason-gate/
├─ lb-custom/
│  └─ reason-gate.html   # 唯一正式页面
├─ scripts/
│  ├─ server.py          # 仅监听 127.0.0.1 的无缓存 HTTP 服务
│  ├─ start.ps1          # 启动服务
│  ├─ stop.ps1           # 安全停止由本项目启动的服务
│  ├─ install.ps1        # 启动服务并安装当前用户自启动项
│  ├─ uninstall.ps1      # 删除自启动项并停止服务
│  └─ test.ps1           # 无第三方依赖的功能检查
├─ .gitignore
├─ LICENSE
└─ README.md
```

旧地址 `/lb-custom/reason-gate-v2.html` 由本机服务器自动重定向到正式页面，因此旧的 LeechBlock 配置仍可继续工作。

## 在一台新 Windows 电脑上安装

### 1. 安装基础软件

需要：

- Windows 10 或 Windows 11
- Chrome、Edge 或其他 Chromium 浏览器
- [LeechBlock NG](https://www.proginosko.com/leechblock/installation/)，建议 1.7 或更高版本
- Python 3.10 或更高版本
- Git 与 GitHub CLI（用于克隆私有仓库）

安装 Python 时勾选 **Add Python to PATH**。安装后在 PowerShell 检查：

```powershell
python --version
```

如果使用 `winget`，可以先搜索当前可用版本：

```powershell
winget search --id Python.Python
```

然后安装任意 Python 3.10+ 版本。

### 2. 克隆仓库

仓库默认为私有，因此先登录拥有访问权的 GitHub 账户：

```powershell
gh auth login
gh repo clone eiou666/leechblock-reason-gate
cd leechblock-reason-gate
```

### 3. 安装本机服务与自动启动

在仓库根目录执行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
```

该脚本会：

- 在 `127.0.0.1:8765` 启动理由页服务；
- 在当前 Windows 用户的启动文件夹创建启动项；
- 不需要管理员权限；
- 不监听局域网或公网地址。

验证安装：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

看到全部 `PASS` 即表示本机服务和页面可用。

### 4. 配置 LeechBlock NG

打开 LeechBlock NG 的 **Options**，选择一个 Block Set，并点击 **Show Full Options**。

#### What to Block

- `Custom name`：按需填写，例如 `需要说明理由的网站`
- `Sites to block`：填写目标域名，每行一个。例如：

  ```text
  douyin.com
  *.douyin.com
  reddit.com
  *.reddit.com
  ```

#### When to Block

- `Time periods`：`0700-2200`
- `Time limit`：留空
- `Roll over unused time`：不勾选
- `Select when to block`：`within time periods OR after time limit`
- `Days`：`Sun` 到 `Sat` 全部勾选

这里不要把 30 填入 `Time limit`。30 分钟属于通过理由页后的单次放行时间。

#### How to Block

在 `Enter the fully specified URL...` 中粘贴：

```text
http://127.0.0.1:8765/lb-custom/reason-gate.html?$S&$U
```

粘贴后不要再点击 `Default Page`、`Delaying Page` 或 `Password Page`，否则 URL 会被覆盖。

继续设置：

- 勾选 `Immediately block pages on these sites once blocking conditions are met`
- 勾选 `Block only first accessed page of`
- 右侧选择 `block set`
- `Allow access to sites for only`：`30` minutes
- `Delay access to sites by`：`5` seconds
- 勾选 `Automatically load blocked page when delay countdown reaches zero`
- `Close tab instead of blocking page`：不勾选

最后点击 **Save Options**。

同一个理由页 URL 可以重复用于多个 Block Set；每个 Block Set 可以设置不同的网站、时间和放行时长。

### 5. 实际测试

在设定时段内打开任一受限网站。正确流程应为：

```text
空白输入框 → 输入不足 5 个非空白字符时被阻止
           → 输入合格并点击“确定”
           → 小型 5 秒倒计时
           → 自动打开原网站
           → 当前访问会话放行 30 分钟
```

## 日常命令

在仓库根目录运行：

```powershell
# 启动
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1

# 验证
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1

# 停止
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop.ps1

# 删除自启动项并停止服务；不会删除仓库
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

## 更换端口

如果 `8765` 被占用，可以重新安装到其他端口：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1 -Port 8876
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1 -Port 8876
```

同时把 LeechBlock URL 中的端口改为相同值：

```text
http://127.0.0.1:8876/lb-custom/reason-gate.html?$S&$U
```

## 更新

```powershell
git pull
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

HTML 更新会立即生效；服务器会发送禁止缓存响应头。只有 `server.py` 或启动脚本更新时才需要停止并重新启动服务。

## 故障排查

### 页面显示“无法访问此网站”

运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

### 仍显示旧页面

确认插件中使用的是正式 URL，并再次点击 **Save Options**：

```text
http://127.0.0.1:8765/lb-custom/reason-gate.html?$S&$U
```

本项目服务器主动返回 `Cache-Control: no-store`，正常情况下无需清理浏览器缓存。

### 没有倒计时或无法跳回原网站

检查：

- LeechBlock NG 版本是否为 1.7+；
- 插件是否具有“在所有网站上读取和更改数据”的权限；
- URL 是否包含 `lb-custom` 且严格以 `?$S&$U` 结尾；
- `Delay access...` 是否为 `5`；
- `Automatically load blocked page...` 是否已勾选。

### 每次打开站内新页面都重新要求理由

确认已勾选 `Block only first accessed page of`，并选择 `block set`。

## 隐私与安全

- 服务只绑定 `127.0.0.1`，其他设备不能通过局域网访问。
- 理由只用于当前页面的长度校验，不保存到文件、浏览器存储或服务器。
- 服务仅提供正式理由页、旧地址重定向和健康检查；其他路径返回 404。
- 此工具是自我管理辅助工具，不是家长控制、网络防火墙或防绕过安全系统。

## 许可证

[MIT](LICENSE)
