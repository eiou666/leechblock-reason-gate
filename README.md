# LeechBlock Reason Gate · 全局理由门

当前版本 **1.7.3.5**：**单页隐式等待 + 同一 Block Set 全局共享放行**，默认关闭两组的倒计时显示，并迁移已有安装的对应开关。

本项目包含 **LeechBlock NG 本地修改版**和本机理由页服务。安装时需要加载仓库附带的完整扩展。

## 默认启用的配置

首次加载本地扩展时自动写入并启用以下两组，无需手填。按电脑本地时间运行，周一至周日每天启用，时间段起点包含、终点不包含。

| 组 | 生效时段 | 单次全局放行 |
| --- | --- | --- |
| 1：指定时段 | 07:00–11:50、12:00–17:50、18:00–22:00 | 30 分钟 |
| 2：其他时段 | 00:00–07:00、11:50–12:00、17:50–18:00、22:00–24:00 | 5 分钟 |

两组包含同一份网站列表：抖音、B站、YouTube、X/Twitter、知乎及其子域名、短链接域名。

```text
douyin.com        *.douyin.com
bilibili.com      *.bilibili.com
b23.tv            *.b23.tv
youtube.com       *.youtube.com
youtu.be          *.youtu.be
x.com             *.x.com
twitter.com       *.twitter.com
t.co              *.t.co
zhihu.com         *.zhihu.com
```

两组均启用到期拦截，Time limit 留空，使用时间段 OR 时间限额的判断方式。30/5 分钟设置在“通过门禁后的放行时长”，不是每日累计使用限额。

两组的 Advanced Options → `Show countdown timer for this block set` 默认不勾选（`showTimer1=false`、`showTimer2=false`），因此网页不显示剩余时间计时框。全局计时显示选项恢复原默认值；悬停提示、后台计时和到期拦截沿用原逻辑。分组开关也按原插件规则控制该组的计时角标。此配置同时用于首次安装和 `config/default-options.txt`。

更新到 1.7.3.5 并重新加载扩展后，会一次性关闭已有配置中仍使用本机理由门的第 1、2 组倒计时开关，再保存迁移标记。网站、时段、放行时长、其他分组及已保存的全局显示选项均不改写；以后手动重新勾选时也不会被反复关闭。重载后请刷新已打开的选项页和网站，以读取新设置并替换旧内容脚本。

配置来源是 [reasonGateDefaults()](leechblock-shared/shared-session.js)，可导入的完整静态备份是 [config/default-options.txt](config/default-options.txt)。除上述一次性显示开关迁移外，已有自定义设置保持原样；若要恢复全部默认配置，请在本地版 Options → Import Options 选择该 TXT，再 Save Options。恢复前可以先导出已有配置。

## 门禁行为

1. 打开受限网站，跳到本机理由页。输入框和“确定”按钮从一开始就同时显示。
2. 进入页面后等待 **5 秒**，不显示数字倒计时；这期间点击按钮无反应，Ctrl+Enter 也不能提前提交。
3. 5 秒后按钮可点击。填写至少 **5 个非空白字符**，点击“确定”或按 Ctrl+Enter，直接进入原网址。没有单独的倒计时界面，也不会因为等够时间自动放行。
4. 同一组内所有网站、子域名、标签页和窗口，共享同一个放行截止时间。新标签、地址栏、书签、站内导航都不会重新门禁或补满时长。
5. 到期后再次门禁。切换到另一组时段时旧放行结束，例如 11:40 放行只持续到 11:50；午夜不换组，23:59 的 5 分钟可以持续到 00:04。

普通窗口和无痕窗口分开计时；后台工作线程休眠保留放行，浏览器重启或扩展重新加载则清除放行。刷新理由页会重新等待 5 秒。页面到期拦截沿用原扩展约每秒一次的检查，实际时机可能受浏览器调度影响。

## 安装（Windows + Chrome）

### 1. 下载完整仓库

需要 Windows 10/11、Chrome，以及加入 PATH 的 **Python 3.10+**。运行本项目无需 Node.js；只有执行开发测试/检查默认配置时才需要 Node.js 24。

登录 GitHub 后可用 Code → Download ZIP，解压到一个固定位置。也可以：

```powershell
gh auth login
gh repo clone eiou666/leechblock-reason-gate
cd leechblock-reason-gate
python --version
```

请勿只下载 HTML。扩展的脚本、图标、字体、配置界面等文件均已包含在仓库中。

### 2. 启动本机服务并安装开机自启

在仓库根目录运行：

```powershell
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\install.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1
```

服务只监听 `127.0.0.1:8765`。脚本会安装当前 Windows 用户的登录启动项，不需要管理员权限。测试显示全部 PASS 说明服务和页面可用，不代表扩展已安装。

本地修改版固定识别端口 **8765**。不要仅使用启动脚本的 `-Port` 参数换端口；那样需要同步修改扩展的地址校验和默认配置。目前建议保持默认端口。

### 3. 加载附带的本地扩展

1. 如果安装过商店原版 LeechBlock NG，请先关闭它；不用卸载，旧设置可保留用于回退。
2. 如果使用过旧油猴标签继承脚本，也请关闭。新版不需要油猴。
3. 打开 `chrome://extensions`，启用右上角“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库内的 **`leechblock-shared` 文件夹**，不是仓库根目录。
5. 确认 **LeechBlock NG — 全局理由门（本地版）** 已启用，并允许它在目标网站上运行。需要无痕支持时，另外打开“允许在无痕模式下运行”。
6. 打开本地版 Options，确认两组规则已出现且未禁用。刷新已打开的网页。

第一次安装自动启用上表规则，通常无需导入配置。原版和本地版不能同时启用，否则原版仍可能重复拦截。

拦截页 URL 已预设为：

```text
http://127.0.0.1:8765/lb-custom/reason-gate.html?$S&$U
```

不要改为 Default Page / Delaying Page / Password Page。保留仓库所在文件夹，浏览器和开机启动项都依赖它。

### 4. 验收

填写理由，确认前 5 秒点击无反应、5 秒后直接放行。之后在同一个剩余时间内测试：B站搜索 → 首页，首页 → 收藏/空间，新标签直接输入 YouTube。均不应再进入理由页，也不应重新计算完整的 30/5 分钟。

## 更新

如果已使用本地修改版：

```powershell
git pull
```

然后在 `chrome://extensions` 对本地版点击“重新加载”，再刷新门禁页。设置不会被重置，但临时放行会清除。若 `server.py` 或启动脚本发生变化，再停止/重新启动服务；仅 HTML 修改无需重启服务。

更换仓库目录时，需要从新目录重新安装启动项，并重新加载新目录的扩展。若同端口仍在运行旧目录服务，应先在旧目录执行 stop.ps1。

## 日常命令与测试

```powershell
# 启动 / 停止（均在仓库根目录执行）
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\start.ps1
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\stop.ps1

# 检查正在运行的服务和单页界面
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\test.ps1

# 开发检查：需要 Node.js 24，无需安装 npm 依赖
node --test --test-isolation=none .\scripts\test-shared-session.cjs
node .\scripts\defaults.cjs --check
node .\scripts\package.cjs

# 删除当前用户自启动项并停止服务，保留所有项目文件
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\uninstall.ps1
```

自动测试执行实际的后台和内容脚本，Chrome API 使用测试替身，不能代替加载扩展后的浏览器验收。

## 常见问题

- **按钮始终不可点击**：确认加载的是本仓库本地版、版本为 1.7.3.5，重新加载扩展并刷新理由页；商店原版不能驱动新版按钮。
- **重载后网页仍显示倒计时**：确认版本为 1.7.3.5，并刷新网站和选项页。应检查两组 Advanced Options 中的 `Show countdown timer for this block set`；仅修改程序的默认值不会自动覆盖浏览器已保存的选项，1.7.3.5 为此增加了一次性迁移。
- **仍然反复门禁**：确认原版 LeechBlock 已关闭，只保留本地版；核对是否刚好到期、切换时段、重启浏览器或进入无痕窗口。
- **错误页出现 Extension context invalidated / Receiving end does not exist**：确认已更新到 1.7.3.5。当前版本会停止失效页面的消息监听，并等待后台计时页面就绪后再发送配置。更新后先重新加载扩展，再刷新之前已打开的网页（包括理由页）。错误页保留的是历史记录，可在刷新网页后清除；重新加载扩展不会自动替换旧网页中已运行的脚本。
- **无法打开理由页**：运行 start.ps1 和 test.ps1，检查 Python 是否在 PATH、8765 端口是否被其他程序占用。
- **第一次打开没有默认规则**：等待后台完成初始化，重新打开 Options；若该扩展已有旧设置，请手动导入 default-options.txt 并保存。
- **暂停使用**：先禁用本地扩展，再停止服务。若只关闭服务但保持扩展启用，受限网站会跳到不可访问的本机页面。
- **回退**：关闭本地版后可以恢复商店原版。历史实现可以从 Git 提交历史中检索。

## 文件结构与隐私

- `leechblock-shared/`：完整本地扩展、默认配置实现和第三方依赖。
- `lb-custom/reason-gate.html`：极简单页理由输入界面。
- `scripts/`：本机服务、Windows 管理脚本、回归测试和默认配置检查。
- `config/default-options.txt`：不含运行状态/密码的默认配置备份。
- [GLOBAL-GATE.md](GLOBAL-GATE.md)：共享放行细节与验证路径。
- [leechblock-shared/LOCAL-FORK.md](leechblock-shared/LOCAL-FORK.md)：本地修改说明。

理由只在页面内校验，不保存或上传。共享放行记录只含配置签名和时间戳。服务仅提供理由页、旧地址重定向和健康检查，不开放其他工作区文件；`.runtime`、凭据和浏览器个人配置不纳入仓库。

这是自我管理工具，不是防绕过安全系统。它是基于 LeechBlock NG 1.7.3 的非官方本地修改版，不会自动接收商店更新，需要后续手动维护。

## 许可证

根目录 [MIT LICENSE](LICENSE) 适用于本项目自己的页面、服务及管理脚本。`leechblock-shared/` 中的 LeechBlock 源码和修改部分遵循 [MPL-2.0](leechblock-shared/LICENSE)，其中捆绑的 jQuery UI、字体等保留各自许可证与作者信息，详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
