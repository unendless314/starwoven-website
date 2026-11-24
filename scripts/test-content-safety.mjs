#!/usr/bin/env node
// 內容安全規則的端到端測試（CMS 規格書第六節第 1、2 點、第十三節第 1、2 點）。
//
// 做法：每個案例暫時放一篇測試文章到 src/content/blog/，實際跑 `astro build`，
// 檢查「該失敗的失敗、錯誤訊息正確；該通過的通過、輸出正確」，結束後刪除測試文章。
// 用法：npm run test:content（約 1～2 分鐘；會覆寫 dist/，結束後請重新 build 再部署）
// 不要同時執行多份（或同時另跑 build）：共用內容資料夾與 dist/，會互相干擾——這是 Astro build 本身的限制，
// 本腳本不另加鎖（程式中斷時殘留的鎖檔反而會卡住下次執行）。若日後接 CI，於 CI 設定限制同時只跑一份。

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const blogDir = join(root, 'src/content/blog');
const astroBin = join(root, 'node_modules/astro/bin/astro.mjs');
// 每次執行用唯一檔名，且只寫入不存在的檔案、只刪自己建立的檔案：絕不碰到同名的真實文章
const PREFIX = `zz-safety-test-${Date.now()}-${process.pid}`;
/** @type {Set<string>} */
const created = new Set();

// 測試文章的識別標記：寫在 frontmatter 第一行的 YAML 註解。CMS 存檔不會產生這行，
// 殘留清理須「檔名格式相符」且「第一行是此標記」才刪，真實文章即使同名也不會被刪。
const MARKER = '# content-safety-test-fixture（scripts/test-content-safety.mjs 產生，可刪除）';

const fm = (extra = '') =>
  `---\n${MARKER}\ntitle: 測試\ndescription: 測試\npubDate: 2026-11-24\n${extra}---\n\n`;

/** 應讓建置失敗的案例：[名稱, 內文, 錯誤訊息須包含的字] */
const mustFail = [
  ['區塊 script', '<script>alert(1)</script>', '內文不得含 HTML'],
  ['行內 img onerror', '文字 <img src=x onerror=alert(1)> 文字', '內文不得含 HTML'],
  ['<strong> 也不放行', '這是<strong>粗體</strong>', '內文不得含 HTML'],
  ['iframe 嵌入碼', '<iframe src="https://evil.example"></iframe>', '內文不得含 HTML'],
  ['HTML 註解', '<!-- 註解 -->', '內文不得含 HTML'],
  ['Sveltia 圖說輸出', '<figure><a href="https://www.youtube.com/"><img src="/media/a.gif" alt=""></a><figcaption>圖說</figcaption></figure>', '內文不得含 HTML'],
  ['javascript: 連結', '[點我](javascript:alert(1))', '不允許的網址開頭「javascript:」'],
  ['大寫 JAVASCRIPT:', '[點我](JAVASCRIPT:alert(1))', '不允許的網址開頭「javascript:」'],
  ['以字元參照夾 tab', '[點我](jav&#x09;ascript:alert(1))', '不允許的網址開頭「javascript:」'],
  ['尖括號自動連結', '<javascript:alert(1)>', '不允許的網址開頭「javascript:」'],
  ['參照式連結', '[點我][a]\n\n[a]: javascript:alert(1)', '不允許的網址開頭「javascript:」'],
  ['data: 連結', '[點我](data:text/html,<script>alert(1)</script>)', '不允許的網址開頭「data:」'],
  ['明寫 http://', '[舊站](http://example.com)', '不允許的網址開頭「http:」'],
  ['明寫 http:// 且文字與網址相同', '[www.example.com](http://www.example.com)', '不允許的網址開頭「http:」'],
  ['尖括號 http:// 自動連結', '<http://www.example.com>', '不允許的網址開頭「http:」'],
  ['裸寫 http://www.', '請上 http://www.example.com 查看', '不允許的網址開頭「http:」'],
  ['// 開頭', '[點我](//evil.example)', '不允許以 // 開頭'],
  // Markdown 原文 `\\\\evil` 解析後網址為 `\\evil`，瀏覽器視同 `//evil`
  ['反斜線偽裝 //', '[點我](\\\\\\\\evil.example)', '不允許以 // 開頭'],
  ['斜線加反斜線偽裝 //', '[點我](/\\\\evil.example)', '不允許以 // 開頭'],
  ['data: 圖片', '![圖](data:image/png;base64,AAAA)', '圖片不允許的網址開頭「data:」'],
  ['mailto: 圖片', '![圖](mailto:a@b.c)', '圖片不允許的網址開頭「mailto:」'],
  ['相對路徑圖片不存在', '![圖](./images/not-exist.webp)', '找不到圖片檔'],
  ['/media 圖片不存在（Sveltia 舊行為）', '![圖](/media/not-exist.gif)', '找不到圖片檔'],
  ['站內絕對路徑跳出 public/', '![圖](/../package.json)', '圖片路徑超出網站公開資料夾'],
  ['相對路徑跳出文章資料夾', '![圖](../../../package.json)', '圖片路徑超出文章所在資料夾'],
  ['參照式圖片跳出 public/', '![圖][p]\n\n[p]: /../../package.json', '圖片路徑超出網站公開資料夾'],
  // 同一代號定義兩次時 Markdown 採用第一個；第二個安全定義不得掩蓋第一個
  ['重複定義：第一個不安全', '![圖][p]\n\n[p]: mailto:a@b.c\n[p]: https://example.com/a.webp', '圖片不允許的網址開頭「mailto:」'],
  ['站內圖片指向資料夾', '![圖](/assets)', '找不到圖片檔'],
];

/** 欄位只有空白字元時應視同未填：這些值若未被當成空白，會讓建置失敗或渲染空白作者 */
const WHITESPACE_FIELDS =
  "updatedDate: ' '\nauthor: '  '\nauthorRole: ' '\ncategory: ' '\ntags: ' '\ncoverImage: ' '\nreadTime: '\t'\n";

/** 欄位視同未填時，頁面應顯示預設值（作者名在作者欄位、分類、閱讀時間） */
const BLANK_EXPECTS = ['text-heading">星靈織語<', '心靈隨筆', '5 分鐘'];

/** 應通過的案例：[名稱, frontmatter 額外欄位, 內文, 產出頁面須包含的字串（陣列）] */
const mustPass = [
  [
    '允許的連結、站內圖片、中文粗體',
    '',
    [
      '核心在於**「覺察」與「賦能」**：',
      '這是*「斜體」*測試',
      '[課程](/courses#recurring) [本頁](#top) [官網](https://starwoven.xyz) [信箱](mailto:a@example.com) [電話](tel:+886212345678)',
      '請上 www.example.com 查看',
      '大寫 WWW.EXAMPLE.ORG 也是裸連結',
      '![品牌故事](/assets/about-a-brand-story-v1.webp)',
    ].join('\n\n'),
    [
      '<strong>「覺察」與「賦能」</strong>',
      '<em>「斜體」</em>',
      'href="tel:+886212345678"',
      'href="https://www.example.com"',
      'href="https://WWW.EXAMPLE.ORG"',
      'src="/assets/about-a-brand-story-v1.webp"',
    ],
  ],
  [
    '選填欄位留空（Sveltia 的 \'\' 與 YAML 空值）',
    "updatedDate: ''\nauthor: ''\nauthorRole: ''\ncategory: ''\ntags: ''\ncoverImage: ''\nreadTime:\nfeatured:\n",
    '內文',
    BLANK_EXPECTS,
  ],
  ['選填欄位只有空白字元', WHITESPACE_FIELDS, '內文', BLANK_EXPECTS],
];

function build() {
  const r = spawnSync(process.execPath, [astroBin, 'build'], { cwd: root, encoding: 'utf8' });
  return { code: r.status, out: `${r.stdout}\n${r.stderr}` };
}

function cleanup() {
  for (const f of created) rmSync(f, { force: true });
  created.clear();
}

/** 寫入測試文章；檔案已存在即拋錯中止（flag 'wx'），不覆寫任何既有檔案 */
function writeFixture(ext, content) {
  cleanup();
  const f = join(blogDir, `${PREFIX}.${ext}`);
  writeFileSync(f, content, { flag: 'wx' });
  created.add(f);
}

let failed = 0;
const report = (ok, name, detail = '') => {
  if (!ok) failed++;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `\n   ${detail}` : ''}`);
};

// 測試文章若殘留，之後的正常 build 會被它擋下。清理分兩道：
// 1. 開始前清掉上次殘留的測試文章。這是主要防線：Windows 強制終止時程式來不及清理，
//    且等待 build 期間訊號處理會延到 build 結束後才執行。
//    只刪「檔名格式相符且第一行是 MARKER」者；檔名相符但無標記的視為真實文章，保留並警告。
const STALE = /^zz-safety-test-\d+-\d+\.mdx?$/;
for (const name of readdirSync(blogDir)) {
  if (!STALE.test(name)) continue;
  const f = join(blogDir, name);
  const [first, second] = readFileSync(f, 'utf8').split(/\r?\n/, 2);
  if (first === '---' && second === MARKER) {
    rmSync(f);
    console.log(`（已清除上次殘留的測試文章：${name}）`);
  } else {
    console.log(`⚠️ ${name} 檔名像測試文章但沒有測試標記，視為真實文章，不刪除`);
  }
}

// 2. Ctrl+C（SIGINT）或被外部終止、逾時（SIGTERM）時盡量清理
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) {
  process.on(signal, () => {
    cleanup();
    process.exit(code);
  });
}

try {
  for (const [name, body, expected] of mustFail) {
    writeFixture('md', fm() + body + '\n');
    const { code, out } = build();
    const ok = code !== 0 && out.includes(expected);
    report(ok, `應失敗：${name}`, ok ? '' : `exit=${code}，輸出未含「${expected}」`);
  }

  for (const [name, extra, body, expects] of mustPass) {
    writeFixture('md', fm(extra) + body + '\n');
    const { code, out } = build();
    const page = join(root, 'dist/client/blog', PREFIX, 'index.html');
    const html = existsSync(page) ? readFileSync(page, 'utf8') : '';
    const missing = expects.filter((s) => !html.includes(s));
    const ok = code === 0 && missing.length === 0;
    report(ok, `應通過：${name}`, ok ? '' : `exit=${code}；頁面缺少：${missing.join('、') || '（無）'}\n${out.slice(-800)}`);
  }

  // .mdx 不被讀取：放一篇 .mdx，建置應通過且不產生該頁
  writeFixture('mdx', fm() + 'export const x = 1\n\n內文\n');
  {
    const { code } = build();
    const page = join(root, 'dist/client/blog', PREFIX, 'index.html');
    const ok = code === 0 && !existsSync(page);
    report(ok, '.mdx 檔被忽略、不產生頁面', ok ? '' : `exit=${code}`);
  }
} finally {
  cleanup();
}

console.log(failed === 0 ? '\n全部通過' : `\n${failed} 項未通過`);
process.exit(failed === 0 ? 0 : 1);
