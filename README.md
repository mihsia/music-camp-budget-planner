# 音樂班寒暑訓經費規劃系統

這是一個可直接部署到 GitHub Pages 的靜態 Web 工具，用來規劃音樂班寒訓、暑訓外聘師資鐘點費與學生自負額。

## 功能

- 分部課、合奏課程分開設定老師人數與每堂課單價
- 寒訓 / 暑訓可建立多個上課階段區間
- 自動計算公費補助後的弦樂 A 團學生平均自負額
- 本機瀏覽器儲存、JSON 匯入匯出
- Google Drive 雲端備份：輸入 Google OAuth Web Client ID 後可連接 Drive 上傳 / 讀取備份
- 匯出經費分攤 PDF、Excel 365 `.xlsx`
- 匯出繳費通知單 Word `.docx`、PDF

## Google Drive 設定

Google Drive 備份使用瀏覽器端 OAuth，不會把資料送到第三方伺服器。第一次使用前，請在 Google Cloud 建立 OAuth 2.0 Web Client ID，並把部署網址加入 Authorized JavaScript origins，例如 GitHub Pages 網址。

Drive 權限使用 `drive.file`，只會存取本系統建立或由使用者授權的備份檔。

## 本機預覽

```bash
python3 -m http.server 8765
```

開啟：

```text
http://127.0.0.1:8765
```
