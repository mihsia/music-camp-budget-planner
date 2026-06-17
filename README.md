# 音樂班寒暑訓經費規劃系統

這是一個可直接部署到 GitHub Pages 的靜態 Web 工具，用來規劃音樂班寒訓、暑訓外聘師資鐘點費與學生自負額。

## 功能

- 分部課、合奏課程分開設定老師人數與每堂課單價
- 寒訓 / 暑訓可建立多個上課階段區間
- 自動計算公費補助後的弦樂 A 團學生平均自負額
- 本機瀏覽器儲存、JSON 匯入匯出
- Google Drive 雲端備份：輸入 Google OAuth Web Client ID 後可連接 Drive 上傳 / 讀取備份
- Firebase Authentication 帳密登入：登入後才顯示經費規劃主系統
- 匯出經費分攤 PDF、Excel 365 `.xlsx`
- 匯出繳費通知單 Word `.docx`、PDF

## 登入帳密設定

本系統部署在 GitHub Pages，因此不建議把帳號、密碼或雜湊值寫死在前端程式。正式登入控管使用 Firebase Authentication 的 Email/Password。

設定步驟：

1. 到 Firebase Console 建立專案，並新增 Web app。
2. 到 Authentication > Sign-in method 啟用 Email/Password。
3. 到 Authentication > Users 新增可登入的使用者帳號。
4. 將 Firebase Web app 的 config 填入 `auth-config.js`：

```js
window.MUSIC_BUDGET_FIREBASE_CONFIG = {
  apiKey: "你的 Firebase apiKey",
  authDomain: "你的專案.firebaseapp.com",
  projectId: "你的專案 ID",
  appId: "你的 appId",
};
```

Firebase Web config 不是密碼，但仍建議在 Firebase Console 限制授權網域，只允許正式 GitHub Pages 網址與必要的本機測試網址。

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
