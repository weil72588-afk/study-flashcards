学习闪卡 · iPhone PWA

这是一个完全本地的个人闪卡工具：
- 自己创建卡组和闪卡
- 正反面都可以添加图片
- 忘记 / 有点模糊 / 记得 三档反馈
- 自动安排间隔复习；忘记/模糊会在本轮稍后再次出现
- 今日到期 + 新卡总量提醒
- 到期复习软上限只提醒、不截断
- 搜索、编辑、删除、模糊卡复习
- 支持 ChatGPT 粘贴导入、JSON 导入
- 支持完整备份/恢复

【最方便的 ChatGPT 导入格式】
#CARD
卡组: 言语错题
正面: 原文说“可能形成”，选项说“可以形成”，要警惕什么？
背面: 确定性扩大。“可能/潜在”≠“可以/确定”。下次：看到程度词先逐字核对。
标签: 言语, 细节判断, 确定性扩大
来源: 2026-08-08 错题
#END

可以连续粘贴多个 #CARD 块，一次导入多张卡。

【GitHub Pages 部署】
将本文件夹中的所有文件上传到一个 Public GitHub 仓库根目录：
index.html
app.js
manifest.webmanifest
sw.js
icon-180.png
icon-192.png
icon-512.png
README.txt

然后 Settings → Pages → Deploy from a branch → main → /(root) → Save。
Safari 打开生成的网址 → 分享 → 添加到主屏幕。

【数据提醒】
学习数据保存在当前 iPhone 的浏览器/PWA 本地，不会自动上传到 GitHub。
换手机、清除 Safari 网站数据、重装前，请先在设置里“导出完整备份”。
