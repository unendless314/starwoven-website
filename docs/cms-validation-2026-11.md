# 星靈織語 Starwoven — CMS 技術驗證與選型紀錄（2026-11）

> **用途**：保存 [`cms-plan.md`](cms-plan.md) 各項決定背後的實測證據、被排除方案的詳細比較、已定案事項的沿革。
> **實作時不必讀**；要追查「當初為什麼這樣決定、根據什麼數據」時才看。本檔只是證據紀錄：規格以 `cms-plan.md` 為準；
> 架構決策與 `decisions.md`（DEC-092 等）衝突時，以 `decisions.md` 為準。
> 架構決策：DEC-092。

---

## 一、驗證計畫

分兩塊，可並行：
- **A. 建置接入**：網站能否讀取 repo 外的內容資料夾。失敗仍有退路（建置前複製、git submodule），**不決定成敗，只決定做法**。
- **B. Sveltia 端到端**（**真正決定成敗**）：編輯者能否以 GitHub 帳號登入、發布到私有內容 repo，網站建置後讀得到；並確認繁中介面、上傳轉 WebP、手機 HEIC。
  此環不通則方案 C 不成立，改評估備案 Pages CMS。
- 另一個可能卡關的是人：約 10 位編輯者都要申請 GitHub 帳號並學會操作。

實驗於網站 repo 分支 `spike/external-content` 進行（未 commit，不併入 `main`；正式實作時重寫）。
**結果（2026-11-24）：核心架構 A、B 皆通過，方案 C 成立。HEIC 未驗證，列為正式開放前必測（規格書第十三節第 9 點）。**

---

## 二、驗證 A：建置接入（✅）

**前期初測**：VPS agent 先以假資料在 Linux 上測試，`glob()` 讀 repo 外目錄、`image()` 壓縮 repo 外圖片，build 與 dev 皆可行。

**正式測試做法**：既有 5 篇部落格＋封面複製到工作區 `content-test/blog/`（封面放 `images/`，以 `./images/xxx.webp` 引用），另加 1 篇內文含插圖的測試文章。
改動 3 個檔：`src/content.config.ts`（`glob()` 改讀 `CONTENT_DIR`、`coverImage` 改為 `image()`）、
`src/pages/blog/index.astro` 與 `[...slug].astro`（`<img>` 改 `<Image>`，產生 480／960／原寸三種寬度）。

| 項目 | 結果 |
| :--- | :--- |
| `npm run build` 讀外部文章，6 篇皆產出 | ✅ |
| 封面經 `image()` 壓縮並產生響應式尺寸 | ✅ 手機版 13～23 KB（原檔 78～148 KB） |
| Markdown 內文的相對路徑插圖 | ✅ 自動最佳化 |
| `astro dev` 顯示外部文章與圖片；修改／新增後重新整理即更新 | ✅ |
| glob 只收 `*.md`，`.mdx` 被忽略 | ✅ |
| `astro check` | ✅ 0 errors |
| Linux（VPS）與 Windows（開發機） | ✅ 皆可 |
| 封面圖不存在 | ✅ 建置失敗（`ImageNotFound`，指出檔名） |
| 分類不在選單內 | ✅ 建置失敗（`InvalidContentEntryDataError`，指出文章） |
| **內容資料夾不存在** | ⚠️ **只警告，建置「成功」且部落格零篇** → 已在分支加檢查改為建置失敗並實測 |

**其他發現**：
- Astro 7 的 `image()` 須用 schema callback 寫法（`schema: ({ image }) => ...`）。
- `<Image>` 預設 `loading="lazy"`，文章頁頂端大圖會晚出現 → 規格書第八節規定設 `eager`。
- `CONTENT_DIR` 相對路徑原本以執行指令時的目錄為準 → 規格書改為以程式檔位置推導。
- Windows Git Bash 下建置失敗的 exit code 為 127（非 1），仍為非 0，部署腳本會正確中止。
- 另以實測確認：Astro 編譯錯誤、頁面渲染錯誤時 `npm run build` 皆回非 0（推翻「Astro 失敗時 npm 回 0」的說法）。

---

## 三、驗證 B：Sveltia 端到端（✅ 核心流程通過，方案 C 成立；HEIC 待補測）

設定：spike 分支新增 `public/admin/index.html`（Sveltia CMS 鎖定 **0.271.2**）與 `public/admin/config.yml`
（`site_domain: localhost` 僅供本機；全站 `media_folder: /media` 為 Sveltia 必填，各欄目再覆寫為 `images`）。內容 repo 已 clone 至工作區 `starwoven-content/`。

| 項目 | 結果 |
| :--- | :--- |
| GitHub 登入（經 Cloudflare 轉接服務） | ✅ |
| 繁中介面 | ✅ 編輯畫面為中文（設定錯誤畫面為英文） |
| 發布寫入私有內容 repo | ✅ commit 作者為發布者本人，可追溯 |
| 封面圖上傳轉 WebP、縮至 1920 內 | ✅ 手機照片（JPG）→ 1440×1920 WebP（601 KB），存於 `blog/images/` |
| 網站以 `CONTENT_DIR=../starwoven-content` 建置 | ✅（修正空日期問題後）；封面再經 Astro 產生 480／960／1440 寬 |
| HEIC | 未確認（測試照片為 JPG），待 iPad 補測 |

**發現的問題**（處置見規格書第十三節）：
1. 選填日期留空：Sveltia 對空白的 `updatedDate` 寫入 `''`，schema 驗證失敗——「編輯者照表單操作卻讓網站更新失敗」，必須在系統端吸收。spike 把 `''` 視同未填後建置通過。
2. 內文插圖存到全站 `/media/` 而非 `blog/images/`，且輸出為 `<figure><a><img src="/media/...">`，Astro 不處理原始 HTML 的圖片 → 線上 404，建置抓不到。
3. 動畫 GIF 不轉檔：測試 GIF 976 KB 原樣存入；當時上傳上限設 10 MB，太寬。
4. 上傳檔名保留原名（`IMG_20260705_185236_1.webp`），與命名規則不一致。
5. 一次發布產生兩個 commit（先圖、後文）。
6. 照片轉檔後 1440×1920 仍有 601 KB。
7. Slug 須手動輸入英數，中文或空格被擋（錯誤訊息為英文）。
8. 開發伺服器執行中，又以不同 `CONTENT_DIR` 跑 build，會弄亂共用暫存 `.astro/`，開發頁面出現 `LocalImageUsedWrongly`；停 dev、刪 `.astro/` 後重啟即恢復。
9. **內文原始 HTML 會原樣輸出到網頁**（含 `<script>`、`<iframe>`）：帳號被盜或貼上來路不明的「嵌入碼」即可植入惡意程式。
   → 促成規格書第六節安全措施（只收 `.md`、原始 HTML 建置失敗、YouTube 專門欄位）。

**測試留下的東西**：內容 repo 有 2 個測試 commit（`cms-test-1` 文章、照片、GIF）。

---

## 四、登入轉接服務驗證

- 允許名單內的網域會轉到 GitHub 登入；不在名單的網域被拒（`UNSUPPORTED_DOMAIN`）。
- 實際登入與發布成功（驗證 B），client secret 設定正確。
- GitHub App 官方預填權限含 Pull requests 寫入（供審稿流程）；本站不設審核，改為 No access。

---

## 五、VPS 現況（2026-11-24，VPS agent 原始輸出整理）

- 8 GB RAM、**無 swap**、4 核、硬碟剩 52 GB；可用記憶體約 3.2 GB。
- OpenClaw gateway 單一行程占 3.5 GB（上限 3.8 GB），`starwoven-app` 約 100 MB。
- 無任何一般使用者帳號；`starwoven`（uid 999）為服務專用系統帳號；`/srv` 存在且為空的 root 資料夾；`/var/www/starwoven` 屬 www-data；`/root` 為 `drwx------`。
- Node：VPS v24.22.1／npm 11.9.0；開發機 v24.16.0／npm 12.2.0（主版本一致；npm 差一版，留意 lockfile）。

→ 依據規格書第七節：建置設記憶體上限、非 root 建置帳號、repo 搬至 `/srv`。

---

## 六、編輯者權限方案比較（2026-11-23）

| 方案 | 說明 | 結果 |
| :--- | :--- | :--- |
| A. CMS 自有登入 | 編輯者登入 CMS，由 CMS 代為提交；不持有 repo 寫入權 | 可行的 CMS（Pages CMS、付費雲端版 Keystatic）各有缺點（第七節）。不採用 |
| B. GitHub 路徑限制 | 編輯者持寫入權，以 push ruleset 限制只能改內容路徑 | **不可行**：push ruleset 只開放給付費 Team 方案的私有 repo；本 repo 為免費個人帳號的公開 repo |
| C. 內容獨立 repo | 內容放另一個 repo，建置時接入 | ✅ 採用 |
| 同 repo 內容分支 | 編輯者只推送內容分支 | 不採：寫入權以 repo 為單位，可推送任何分支、修改 workflow 讀取機密 |

方案 C 讓 v0.1 因 repo 公開而擔心的問題（編輯者帳號名稱公開、誤貼個資永久公開、草稿公開）不再成立；
也自然解決 v0.1 的分支策略問題（CMS 與開發者共用網站 repo 的 `main`，開發者推上未準備部署的程式碼會被內容部署一起拉下來）。

---

## 七、CMS 選型比較（2026-11-23 網路調查）

> 部分資料來自第三方比較網站；版本、價格與功能以官方文件及上述驗證結果為準。

| 面向 | Sveltia | Pages CMS | Keystatic |
| :--- | :--- | :--- | :--- |
| 編輯者權限 | 需 GitHub 帳號與寫入權 → 以方案 C 隔離 | ✅ 原生方案 A：Email 邀請登入，由 CMS 代為提交 | GitHub 模式需寫入權；付費雲端版免 |
| 繁中介面 | ✅ 有台灣繁中，依瀏覽器語言自動切換 | 應無（未確認） | ❌ 只有英文 |
| 圖片轉 WebP | ✅ 上傳時於瀏覽器轉檔 | 未查到 | ❌ 原圖進 repo；付費雲端版才有圖片處理 |
| 伺服器負載 | ≈ 0：在編輯者瀏覽器執行，只需登入轉接服務 | 線上版 0；自架需常駐 Next.js ＋ PostgreSQL | 後台跑在網站的 Node 服務上 |
| 開發端維護 | 靜態頁面＋設定檔，與 Astro 建置脫鉤 | 線上版免維護；自架要長期維護應用程式與資料庫 | 需加入 React、Markdoc；曾有 Astro 新版支援落後的回報 |
| 單點故障 | 可鎖定版本、自行提供；停止維護既有版本照樣能用 | 線上版停機即不能發布，且第三方持有 repo 寫入權 | 雲端版依賴第三方 |
| 費用（約 10 人） | 免費 | 免費 | 3 人以上須付費 |

**未採用方案的完整理由**：
- **Pages CMS**：線上版單點故障，第三方持有 repo 寫入權；自架須在 VPS 常駐 Next.js 與 PostgreSQL，這台 VPS 同時是正式機、建置機與抽卡服務主機，不宜再增加常駐服務。
- **Keystatic**：違反 AGENTS.md「不用 JS 框架」（須加入 React）；後台會成為 Node 服務的新對外入口；Astro 新版支援可能落後，會卡住安全更新；介面只有英文。
- **Decap CMS**：Sveltia 為其改良版；Decap 自家託管服務 Turbo 須付費，且尚在預覽階段。
- **TinaCMS**：自架複雜，主要功能依賴付費雲端服務。

**登入轉接的兩種官方工具**（皆部署於 Cloudflare Workers 免費方案，GitHub 端皆註冊 GitHub App、只裝在內容 repo）：

| | `sveltia-cms-auth`（採用） | Sveltia CMS Additions（觀察） |
| :--- | :--- | :--- |
| 功能 | 只做 GitHub 登入 | 另有帳號密碼登入（編輯者不需 GitHub 帳號）、角色權限、編輯鎖定、留言 |
| 成熟度 | 已用多年（512 forks），官方表示「仍會提供」 | 2026-11-22 才發布 v1.0（同日 3 版、2 stars） |
| 切換 | — | 官方有遷移說明：改 config 兩行、重登入，內容不受影響 |

另曾考慮登入轉接放本站 VPS，最後選 Cloudflare Workers 免費方案（規格書第九節第 2 小節）。

**v0.1 原評估條件**（依重要性排序）：
1. 編輯者權限：能否實現方案 A 或 B。
2. 登入方式：GitHub OAuth 需要哪些額外服務（例如 OAuth 代理）？能否部署在本站 VPS，不依賴其他平台？
3. 中文介面與易用性：編輯者不懂程式，介面能否設為繁體中文。
4. 與 Astro Content Collections 的整合：欄位定義是否需要和 schema 重複維護。
5. 圖片上傳：能否在瀏覽器端、提交前轉 WebP 並縮圖（原檔不進 git），能否設單檔大小上限、能否預覽。
6. 預覽：發布前能否看到大致的頁面樣子。
7. 維護狀態：近期是否仍有更新、社群活躍度、授權。
8. 成本：是否免費、有無編輯者人數上限。

---

## 八、已定案事項沿革（原規格書第十二節待決表）

| 原 # | 事項 | 結果 | 決定者 |
| :--- | :--- | :--- | :--- |
| 1 | CMS 選型 | Sveltia CMS（2026-11-23） | 開發者 |
| 2 | 編輯者權限方案 | 方案 C，內容 repo 私有、建在 GitHub 組織下（2026-11-23） | 開發者 |
| 3 | repo 公開或私有 | 網站 repo 公開（2026-11-17 確認）；內容 repo 私有（2026-11-23） | 開發窗口 |
| 4 | 部署觸發方式 | VPS 每 5 分鐘定時檢查（2026-11-24） | 開發者 |
| 5 | 建置失敗的通知管道 | 第一階段 log＋狀態檔＋人工回報（2026-11-24） | 開發窗口 |
| 6 | 分支策略 | 方案 C 已解決 | 開發者 |
| 12 | 技術驗證 | 通過，內容以 `CONTENT_DIR` 直接讀取（2026-11-24） | 開發者 |
| 13 | 登入轉接服務位置 | Cloudflare Workers 免費方案，`sveltia-cms-auth`（2026-11-24） | 開發者 |
| 14 | GitHub 組織與內容 repo | `starwoven-studio/starwoven-content`（2026-11-24 建立）；網站 repo 是否移入組織仍待決 | 開發者 |

---

## 九、被取代的早期想法

| 早期想法 | 後來的決定 | 理由 |
| :--- | :--- | :--- |
| 比照星靈出攤，改用 Google 試算表＋VPS 定時重建 | Git-based CMS | 部落格長文與影片頁需求 |
| 內文原始 HTML 在建置時過濾掉 | 出現即建置失敗 | 不默默刪除；用解析結果檢查而非字串比對 |
| 網站 repo 放範例內容資料夾，以標記檔防止正式環境誤用 | 不放範例，所有環境只讀真正內容 repo | 目前無人需要；範例或空模式都帶來誤用風險與額外防護 |
| `CONTENT_DIR` 相對於執行目錄 | 以程式檔位置推導 | 不受執行指令的位置影響 |
| 內容部署以「合併短時間多次觸發」處理一次兩個 commit | 定時檢查自然合併＋最新 commit 不到 1 分鐘則跳過 | 改採定時檢查後的對應做法 |
| GIF 只靠大小上限與教學處理 | 不允許 GIF，以 `accept` 在後台擋 | 大小上限擋不住 GIF，GIF 進 repo 永久留在歷史 |
| 上傳檔名含 `_` 直接列為命名規則例外 | 先開 `slugify_filename`，實測底線後再決定 | 能自動轉就不需例外 |
