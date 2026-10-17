# 其他电脑接入控制台

这是安装在被控电脑上的客户端，不需要在该电脑部署 API、TURN 或控制台。

1. 管理员进入 https://rc.lvyrix.com/management 的「Token 管理」，为每台电脑创建一个用途为「主机」的 Token。
2. 在被控电脑打开 https://rc.lvyrix.com/host，下载对应客户端并安装。
3. 在客户端填写控制台地址、主机名称和主机 Token，点击「保存并连接」。
4. 看到「在线，等待远程连接」后，在控制台主机列表中点击「连接桌面」。

主机密钥不等于管理员密码。安装包不包含任何密钥。密钥保存在本机当前用户的私有配置目录。远控时被控电脑必须联网并保持桌面用户登录；不需要开放入站端口。客户端通过 WSS 主动注册，视频/输入通过 WebRTC 和控制台提供的 TURN 通道连接。

## Linux（优先支持）

支持有图形桌面的 Linux X11/Xorg，推荐 Ubuntu/Debian x86_64；Wayland 尚不支持。纯命令行服务器需要先配置桌面。客户端不会创建或替换你的桌面会话。

解压 `remote-console-linux.tar.gz`，在**被控电脑的图形桌面终端**中执行：

```sh
cd remote-console-agent
bash install-linux.sh
```

不要使用 `sudo bash`。Ubuntu/Debian 安装运行库时会请求 sudo 权限，客户端始终以当前桌面用户运行。其他发行版需要自行安装 Python 3.10+、venv、Tk、X11/XTest 运行库。后续在应用菜单打开 **Remote Console**。

## Windows（预览版）

目标为 Windows 10/11 x64 的已登录普通桌面。实现了屏幕采集、鼠标键盘及 Unicode 文本输入；发布时若未完成 Windows 真机验证，下载入口会标为预览版。不能控制 UAC 安全桌面、登录/锁屏界面或更高权限的程序。

解压 `remote-console-windows.zip`，双击 `install-windows.cmd`。安装器为当前用户安装 Python 3.12（通过 winget）及客户端依赖，不修改系统全局执行策略。若系统没有 winget，请先从 python.org 安装 Python 3.12（保留 Tcl/Tk），再重试。安装完成后会出现配置窗口和桌面快捷方式。

首次安装依赖需要联网。当前是包含 Python 源码和自动安装器的安装包，不是独立免依赖的签名 EXE。

## 日常操作

- 勾选「登录本机桌面后自动连接」：下次登录当前用户的图形桌面时启动客户端，窗口最小化到任务栏。
- 点击「停止远控」或关闭客户端窗口：当前远控结束，主机下线。最小化窗口仍保持在线。
- 网络断开后客户端自动重试。密钥过期或撤销后需要在客户端填写新的主机密钥。
- Linux 当前文本输入支持英文、数字和换行；Windows 使用系统 Unicode 输入。音频、文件传输、独立多屏切换尚未实现。
- 禁用自动启动：取消勾选自动连接，点击「保存并连接」后停止并关闭窗口。

## 卸载

先停止并关闭客户端。

Linux 删除 `~/.config/autostart/remote-console.desktop`、`~/.local/share/applications/remote-console.desktop`、`~/.local/share/remote-console-agent` 和 `~/.config/remote-console`。若设置了 XDG_CONFIG_HOME，配置和自启动文件在该目录下。

Windows 删除当前用户启动文件夹的 `RemoteConsole.vbs`、桌面的 `Remote Console.lnk` 和 `%LOCALAPPDATA%\RemoteConsole`。启动文件夹可通过 Win+R 输入 `shell:startup` 打开。无需卸载其他应用可能使用的 Python。

最后在控制台撤销该电脑的主机 Token，即可禁止再次接入。

## 设备工具与性能（0.2）

更新客户端后，在配置窗口勾选需要的权限，再点击「保存并连接」：

- **终端**：管理员可以打开 Linux PTY / Windows PowerShell（ConPTY）终端，以客户端当前用户身份运行；关闭终端页签或会话会结束终端进程。不会恢复或重放断线前的命令。
- **文件**：管理员可以浏览当前用户主目录，上传和下载单个不超过 256 MiB 的文件。上传使用临时文件，完成后才发布；同名文件不覆盖，取消或断线会清理临时文件。界面每页最多 50 项；不支持符号链接、特殊文件。下载由浏览器暂存，移动端宜使用较小文件。
- **剪贴板**：在桌面「更多」中主动发送或取回文本，不在后台持续同步。Linux 中文输入通过远端剪贴板和 Ctrl+V 完成，会替换远端剪贴板；终端等应用仍需使用自己的粘贴快捷键。Windows 文本输入继续使用 Unicode 输入接口。
- **系统声音**：共享当前默认输出设备的回环音频，不采集麦克风。连接桌面后在「更多」中点击「播放系统声音」。Linux 需要 PulseAudio 或 PipeWire 的 PulseAudio 兼容服务；Windows 使用 WASAPI loopback。

以上四项默认关闭，旧配置升级后仍需在本机启用。设备状态自动每 5 秒上报 CPU、内存、主目录所在磁盘、系统运行时间、系统版本、客户端版本与当前编码器。状态页显示超过 15 秒的过期数据。

主机设备 ID 保存在客户端配置目录的 `device-id`。同一设备 ID 和同一主机 Token 重连时保留服务端分组、备注和最近连接；更换主机 Token 或删除设备 ID 会被视为新设备。不要把设备 ID 或配置打进发布包。

仅打开终端/文件不启动桌面采集。视频优先尝试 NVIDIA H.264 硬编（需要 PyAV/FFmpeg 编码器及驱动支持），失败自动退回低延迟 `libx264 ultrafast`。Intel/AMD 专用硬件路径尚未实现。分辨率和帧率根据接收端 FPS、网络 RTT 和采集耗时逐级降低，连续良好采样后恢复，最高不超过选择的画质档位；发送码率也受档位上限约束。

桌面连接异常会退避重建会话，单次打开最多尝试 8 次；主动退出、权限失效和会话到期不会自动重新进入。需要保留主机 Token 和设备 ID，浏览器页面也需保持打开。恢复过程中释放按键，不重放输入。

以环境变量启动的 Agent 可设置 `RC_TERMINAL=1`、`RC_FILES=1`、`RC_CLIPBOARD=1`、`RC_AUDIO=1`；`RC_FILE_ROOT` 可指定共享目录，`RC_ENCODER=software` 可强制软件编码。通过配置窗口启动时，以保存的四项权限开关为准。终端本身拥有当前系统用户权限，文件共享目录不是对该用户的操作系统沙箱。

Windows 的终端、音频及硬件编码仍需 Windows 真机验收；Linux 音频验证使用隔离的虚拟输出设备。打包流程会包含新增模块和固定版本依赖，安装包仍由 GitHub Actions 生成。
