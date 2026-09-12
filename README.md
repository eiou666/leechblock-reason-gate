# LeechBlock Reason Gate · 全局理由门

当前版本 **1.7.3.6**。理由页内置于扩展，直接由 Chrome 加载，**不需要 Python、本机 HTTP 服务或 Windows 计划任务**。保留单页等待、回车提交、同组全局共享放行和默认隐藏倒计时。

## 安装（Chrome）

1. 下载完整仓库并解压到固定目录，或运行 `git clone https://github.com/eiou666/leechblock-reason-gate.git`。私有仓库需要先登录有访问权限的 GitHub 账号。
2. 关闭其他版本的 LeechBlock，避免重复拦截。
3. 打开 `chrome://extensions`，开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择仓库中的 **`leechblock-shared`** 文件夹，不是仓库根目录。
5. 确认“访问网络”已启用，版本为 **1.7.3.6**，允许在目标网站上运行。需要无痕支持时另行开启“允许在无痕模式下运行”。
6. 打开扩展选项，确认两组规则均启用，再刷新已打开的网站。

首次安装自动生成默认规则，通常无需导入配置。运行扩展无需安装 Node.js 或执行 `scripts/install.ps1`。保留扩展所在目录；移动目录后需要从新位置重新加载扩展。

## 默认配置

可选的 **23:00–次日 06:00 密码门禁** 已支持：输入正确密码后同组全局放行 5 分钟，不填写理由、不等待 5 秒，其他时段维持原规则。启用步骤及跨电脑配置见 [NIGHT-PASSWORD.md](NIGHT-PASSWORD.md)。真实密码不在仓库中；下表描述未启用夜间密码时的基础默认配置。

按电脑本地时间运行，每周七天启用，时段包含起点、不包含终点。

| 分组 | 每天生效时段 | 每次共享放行 |
| --- | --- | --- |
| 1 | 07:00–11:50、12:00–17:50、18:00–22:00 | 30 分钟 |
| 2 | 00:00–07:00、11:50–12:00、17:50–18:00、22:00–24:00 | 5 分钟 |

两组均覆盖以下域名及其子域名：

```text
douyin.com   bilibili.com   b23.tv
youtube.com  youtu.be       x.com
twitter.com  t.co           zhihu.com
```

- 两组均启用到期拦截，Time limit 留空，时间段与时间限额使用 OR 判断。
- 单次放行时长配置为 30/5 分钟，不是每日累计使用限额。
- 理由至少包含 **5 个非空白字符**；进入理由页至少等待 **5 秒**。若将等待时间配置得更长，则采用更长的时间。
- 两组 Advanced Options → **Show countdown timer for this block set** 默认取消勾选。隐藏网页计时框不暂停计时；分组角标按原插件规则随该开关变化。
- 更新时保留网站、时段、放行时长和其他自定义设置。已有理由门的第 1、2 组仅执行一次倒计时显示关闭迁移；之后手动重新打开该开关的选择会保留。

配置实现见 [shared-session.js](leechblock-shared/shared-session.js)。恢复全部默认值时，先导出现有配置，再在 Options → Import Options 导入 [default-options.txt](config/default-options.txt)，点击 Save Options。**导入默认配置会覆盖相应自定义选项**，正常升级无需导入。

### 为什么选项里仍有 localhost 地址？

为兼容已有配置及导入文件，自定义拦截地址仍保留：

```text
http://127.0.0.1:8765/lb-custom/reason-gate.html?$S&$U
```

**这是兼容配置标识，不再是运行时的页面地址。** 1.7.3.6 识别该配置后，自动跳转到当前扩展自己的 `chrome-extension://…/reason-gate.html`，无需连接 8765 端口。不要手填扩展 ID，也不要改成 Default Page / Delaying Page / Password Page，否则不会使用这套理由门共享逻辑。

## 使用与计时

1. 访问受限网站，进入扩展内置理由页。
2. 输入理由并等待满 5 秒，点击“确定”或按 **Enter**。`Ctrl+Enter` 仍兼容，`Shift+Enter` 换行；输入法选字回车和长按回车不会触发提交。
3. 时间未满或理由不合格都不能放行；等待结束不会自动提交。刷新理由页会重新等待。
4. 同组内网站、子域名、标签和窗口共享一个固定截止时间。切换标签、最小化窗口或离开网站，剩余时间仍继续减少；再次进入不会补满时长。
5. 到期后重新门禁。跨分组时段会提前结束旧放行，例如 11:40 放行最多到 11:50；23:59 的 5 分钟放行可跨午夜至次日 00:04。

普通窗口与无痕窗口分别计时。后台工作线程休眠保留放行；浏览器重启、重载或更新扩展会清除临时放行。到期检查受浏览器调度影响。更多细节见 [GLOBAL-GATE.md](GLOBAL-GATE.md)。

## 从旧版升级

1. 在仓库目录执行 `git pull`；使用 ZIP 安装的用户用新文件更新原扩展目录。
2. 在 `chrome://extensions` 重新加载本地扩展，确认版本为 **1.7.3.6**。
3. 重新访问受限网站，确认理由页地址以 `chrome-extension://` 开头。已打开且可识别的旧 localhost 理由页会在后台启动后迁移到内置页。
4. 确认新版可用后，原本机服务和自启动项可以停用。新版即使在服务停止时也能工作。

如果曾手动安装 Windows 计划任务 `LeechBlock Reason Gate`，可在任务计划程序中停止并禁用它；`scripts/uninstall.ps1` 只处理旧脚本记录的进程与 Startup 启动项，**不会删除计划任务**。不确定旧服务属于哪个项目时，先核对其路径。

`scripts/server.py`、`start.ps1`、`stop.ps1`、`install.ps1`、`uninstall.ps1`、`test.ps1` 及 `lb-custom/` 仅为旧版兼容保留，不是当前安装的前置条件。仅运行这些兼容脚本时才需要 Python 3.10+。

## 验收与排错

- **正常验收**：不启动本地服务，访问 B 站；出现内置理由页；前 5 秒不能提交；不足 5 个非空白字符不能放行；合格理由按 Enter 后可进入；新开同组网站共享放行；到期再次门禁。
- **仍然显示 127.0.0.1 拒绝连接**：确认加载目录正确且版本是 1.7.3.6，重新加载扩展，再重新访问原网站。不要只刷新旧错误页面，也无需为新版重启 Python。
- **按钮始终不可用**：重新加载本仓库的扩展并刷新理由页，确认没有同时启用商店原版。
- **仍显示网页倒计时**：在对应组取消勾选 `Show countdown timer for this block set` 并保存，再刷新网站。
- **重复门禁**：核对是否到期、切换分组、进入无痕窗口或刚重启浏览器/扩展，并关闭重复安装的其他版本。
- **Extension context invalidated**：扩展重载后旧网页的脚本可能失效，刷新网页。扩展错误页也可能保留历史记录。
- **暂停使用**：禁用扩展即可。

## 开发检查

需要 Node.js 24，无需安装 npm 依赖，也无需运行 HTTP 服务：

```powershell
node --test --test-isolation=none scripts/test-shared-session.cjs
node scripts/defaults.cjs --check
node scripts/package.cjs
```

59 项回归测试覆盖实际后台和页面脚本，包括内置页提交、5 秒边界、输入法、来源校验、共享期限、旧错误页迁移和显示设置，以及夜间配置迁移、密码校验、跨午夜共享和 23:00/06:00 规则切换。Chrome API 使用测试替身，仍需按上述步骤进行真实浏览器验收。CI 另行运行旧服务兼容检查。

## 文件与隐私

- `leechblock-shared/reason-gate.html`：当前内置理由页，加载同目录 `blocked.js`。
- `leechblock-shared/`：完整扩展、配置界面及原有第三方依赖。
- `config/default-options.txt`：不含运行状态和密码的默认配置。
- `scripts/`：测试、打包检查和旧服务兼容工具。
- [LOCAL-FORK.md](leechblock-shared/LOCAL-FORK.md)：修改与许可说明。

理由只在页面内校验，不保存或上传；共享放行记录只含配置签名与时间戳。没有新增网络端点或权限。运行记录、浏览器个人配置和凭据不纳入仓库。

这是基于 LeechBlock NG 1.7.3 的非官方自我管理工具，不是防绕过安全系统；不会自动接收商店更新。

## 许可证

根目录 [MIT LICENSE](LICENSE) 适用于本项目自己的页面、服务及管理脚本。LeechBlock 源码及修改遵循 [MPL-2.0](leechblock-shared/LICENSE)。字体和其他第三方依赖保留各自许可证，详见 [THIRD-PARTY-NOTICES.md](THIRD-PARTY-NOTICES.md)。
