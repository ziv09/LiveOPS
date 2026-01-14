# LiveOPS

LiveOPS 是以 **8x8 JaaS（Jitsi as a Service）** 為核心的戰術通訊與監控系統（Jitsi Wrapper）。

- 影音：Viewer/Admin 使用 `lib-jitsi-meet`（單一連線、多格渲染）；Collector 使用 External API（IFrame）極簡採集。
- 同步：路由指派/跑馬燈/開始串流 透過 Firebase RTDB 同步。
- 門禁：所有人入房前必須先向 Firebase Cloud Functions 取得 JaaS JWT（硬上限 25 MAU）。

## 開發啟動

1. 安裝依賴：`npm i`
2. 啟動前端 + 訊號：`npm run dev:all`

## 跨裝置同步（Firebase Realtime Database Signaling）

目前 LiveOPS 的「路由指派/跑馬燈/會議狀態」同步支援兩種模式：

- 本機模式：`BroadcastChannel + localStorage`（同一台電腦多分頁 OK）
- 跨裝置模式：Firebase Realtime Database（手機/其他電腦可同步）

只要你設定了 `.env.local` 的 Firebase 參數（見 `.env.example`），前端會自動改用 Firebase 做訂閱與寫入，不再連 `ws://localhost:8787`。

### 你需要提供/設定的東西

1. Firebase Console 建立專案
2. 建立 Realtime Database（Production/Locked 都可以，先用測試規則也行）
3. 在 Firebase Console > Project settings > General 取得 Web App config，填入：
   - `VITE_FIREBASE_API_KEY`
   - `VITE_FIREBASE_AUTH_DOMAIN`
   - `VITE_FIREBASE_DATABASE_URL`
   - `VITE_FIREBASE_PROJECT_ID`
   - `VITE_FIREBASE_STORAGE_BUCKET`
   - `VITE_FIREBASE_MESSAGING_SENDER_ID`
   - `VITE_FIREBASE_APP_ID`

### 最簡單的測試規則（先跑通再收斂）

在 Realtime Database Rules（僅測試用）：

```json
{
  "rules": {
    "liveops": {
      ".read": true,
      ".write": true
    }
  }
}
```

跑通之後再改成只允許特定 opsId/token 或加上 Firebase Auth。

### 密碼版規則（Viewer 需密碼才能看；只有 Admin 能寫）

若你不使用 Firebase Auth，而是要用 LiveOPS 的密碼做權限控管，可改用以下規則：

- Viewer 端必須知道 `VITE_VIEWER_PASSWORD` 才能讀取會議狀態
- 只有知道 `VITE_ADMIN_PASSWORD` 的控制端才可以寫入（程式會自動在寫入時附上 `_adminProof`）

請把下列 rules 直接貼到 Realtime Database Rules（記得將密碼改成你自己的）：

```json
{
  "rules": {
    "liveops": {
      "v1": {
        "rooms": {
          "$opsId": {
            "$viewerKey": {
              "state": {
                ".read": "$viewerKey === \"01151015\"",
                ".write": "newData.child(\"_adminProof\").val() === \"bw20041015\"",
                "_adminProof": { ".read": false }
              }
            }
          }
        }
      }
    }
  }
}
```

## 8x8 JaaS 門禁（25 MAU 硬上限）

### 名額配置（固定 25）

- 採集端 `src.*`：16
- 監看端 `mon.*`（含 Admin）：4
- 訪客 `crew.*`：5

### 必要設定（Firebase Console）

1. Authentication：啟用「匿名」登入（Anonymous）。
2. Cloud Functions：設定 JaaS 簽章用 secrets（下面指令）。

### 設定 Functions secrets（必做）

LiveOPS 的 Functions 會用 RS256 私鑰簽出 JaaS JWT，所以你需要從 8x8 JaaS Console 下載 **Private Key（PEM 內容，含 BEGIN/END）**。

在專案根目錄執行：

- `firebase functions:secrets:set JAAS_PRIVATE_KEY`（貼上 PEM 私鑰全文）
- `firebase functions:secrets:set JAAS_TENANT_ID`（例如 `vpaas-magic-cookie-xxxxxxxx...`）
- `firebase functions:secrets:set JAAS_KID`（例如 `vpaas-magic-cookie-xxxxxxxx.../e8ff07-SAMPLE_APP`）

部署：

- `firebase deploy --only functions`

### 前端環境變數

把 `.env.example` 複製成 `.env.local`，至少補上：

- `VITE_JITSI_DOMAIN=8x8.vc`
- `VITE_JAAS_APP_ID=vpaas-magic-cookie-...`
- `VITE_FUNCTIONS_REGION=asia-southeast1`

---

## React + TypeScript + Vite（模板說明）

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Babel](https://babeljs.io/) (or [oxc](https://oxc.rs) when used in [rolldown-vite](https://vite.dev/guide/rolldown)) for Fast Refresh
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/) for Fast Refresh

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
