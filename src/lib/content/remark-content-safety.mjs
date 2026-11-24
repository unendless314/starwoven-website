// 內文安全檢查（CMS 規格書 docs/cms-plan.md 第六節第 2 點、第十三節第 2 點）。
//
// 前提：編輯者帳號可能被盜。內文出現下列任一情況即讓建置失敗（不默默刪除），網站維持上一版：
//   1. 原始 HTML（`<script>`、`<iframe>`、`<strong>` 等一律不放行，不設白名單）
//   2. 連結網址不在允許範圍：只允許 https:、mailto:、tel: 與站內路徑
//   3. 圖片網址不在允許範圍：只允許 https: 與站內路徑
//   4. 站內圖片檔不存在（防止上線後破圖）
//
// 以 Markdown 解析結果（mdast）檢查，不用字串比對。
// 以 .mjs 撰寫：astro.config.mjs 於設定階段直接 import。

import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

const LINK_SCHEMES = new Set(['https:', 'mailto:', 'tel:']);
const IMAGE_SCHEMES = new Set(['https:']);

/**
 * 瀏覽器解析網址前會去除空白與控制字元、把 `\` 當成 `/`，
 * 因此 `java\tscript:` 之類的寫法必須先正規化再判斷。
 * @param {string} url
 */
function normalize(url) {
  return url.replace(/[\u0000- \u007f]/g, '').replace(/\\/g, '/');
}

/**
 * @param {string} url
 * @param {Set<string>} allowedSchemes
 * @returns {{ ok: true, local: boolean } | { ok: false, reason: string }}
 */
export function classifyUrl(url, allowedSchemes) {
  const u = normalize(url);
  if (u === '') return { ok: false, reason: '網址為空' };
  const scheme = /^([a-z][a-z0-9+.-]*:)/i.exec(u)?.[1]?.toLowerCase();
  if (scheme) {
    return allowedSchemes.has(scheme)
      ? { ok: true, local: false }
      : { ok: false, reason: `不允許的網址開頭「${scheme}」` };
  }
  // 「//example.com」會被瀏覽器當成外部網站
  if (u.startsWith('//')) return { ok: false, reason: '不允許以 // 開頭的網址' };
  return { ok: true, local: true };
}

/**
 * 站內圖片的檢查結果；`/` 開頭對應 public/，其餘相對於文章檔所在資料夾。
 * 解析後須仍在該資料夾內：`/../package.json` 在硬碟上找得到，但網站上不存在（瀏覽器會請求 `/package.json`）。
 * @param {string} url
 * @param {string} mdFile
 * @param {string} publicDir
 * @returns {string | null} 問題描述；沒問題回傳 null
 */
function checkLocalImage(url, mdFile, publicDir) {
  let p = normalize(url).replace(/[?#].*$/, '');
  try {
    p = decodeURI(p);
  } catch {
    // 編碼錯誤時以原字串檢查，找不到即報錯
  }
  const base = p.startsWith('/') ? resolve(publicDir) : dirname(mdFile);
  const target = p.startsWith('/') ? resolve(base, `.${p}`) : resolve(base, p);
  const rel = relative(base, target);
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
    return p.startsWith('/') ? '圖片路徑超出網站公開資料夾' : '圖片路徑超出文章所在資料夾';
  }
  // 須是檔案：`/assets` 是資料夾，存在但不是圖片
  return existsSync(target) && statSync(target).isFile() ? null : '找不到圖片檔';
}

/**
 * Astro 交給外掛的是去掉 frontmatter 的內文；回傳 frontmatter 行數，讓錯誤行號對得上檔案。
 * @param {string} mdFile
 */
function frontmatterLines(mdFile) {
  try {
    const m = /^---\r?\n[\s\S]*?\r?\n---\r?\n/.exec(readFileSync(mdFile, 'utf8'));
    return m ? m[0].split('\n').length - 1 : 0;
  } catch {
    return 0;
  }
}

/**
 * @param {{ publicDir: string }} options publicDir：網站的 public/ 絕對路徑
 */
export function remarkContentSafety({ publicDir }) {
  return function (tree, file) {
    const mdFile = typeof file?.path === 'string' ? file.path : undefined;
    /** @type {string[]} */
    const problems = [];
    /** @type {Map<string, string>} */
    const definitions = new Map();

    const offset = mdFile ? frontmatterLines(mdFile) : 0;
    const at = (node) => (node.position ? `第 ${node.position.start.line + offset} 行` : '位置不明');

    // 參照式連結／圖片（[文字][代號]）的網址寫在 definition 節點；先收集。
    // 同一代號定義多次時 Markdown 採用第一個，這裡也只留第一個（所有定義另在 walk 中逐一以連結規則檢查）。
    (function collect(node) {
      if (node.type === 'definition' && !definitions.has(node.identifier)) {
        definitions.set(node.identifier, node.url);
      }
      node.children?.forEach(collect);
    })(tree);

    const checkImage = (node, url) => {
      const r = classifyUrl(url, IMAGE_SCHEMES);
      if (!r.ok) return problems.push(`${at(node)}：圖片${r.reason}（${url}）`);
      const issue = r.local && mdFile ? checkLocalImage(url, mdFile, publicDir) : null;
      if (issue) problems.push(`${at(node)}：${issue}（${url}）`);
    };

    (function walk(node) {
      switch (node.type) {
        case 'html': {
          const snippet = node.value.replace(/\s+/g, ' ').slice(0, 60);
          problems.push(`${at(node)}：內文不得含 HTML（${snippet}）`);
          break;
        }
        case 'link':
          // 內文只寫「www.example.com」時，GFM 自動連結會補成 http://；編輯者沒寫 http，改補 https://。
          // 明寫的 http://（含 `[www.x.com](http://www.x.com)`）不在此列，照規則擋下：
          // 以原文長度區分——自動連結的原文就是網址文字本身，Markdown 連結語法另有 `[…](…)`。
          // GFM 補上的前綴固定為小寫 http://，網域部分不分大小寫（WWW.EXAMPLE.COM 亦是裸連結），保留原字母。
          if (
            node.url.startsWith('http://') &&
            /^www\./i.test(node.url.slice(7)) &&
            node.children?.length === 1 &&
            node.children[0].value === node.url.slice(7) &&
            node.position?.end.offset - node.position?.start.offset === node.children[0].value.length
          ) {
            node.url = `https://${node.url.slice(7)}`;
          }
        // falls through
        case 'definition': {
          const r = classifyUrl(node.url, LINK_SCHEMES);
          if (!r.ok) problems.push(`${at(node)}：連結${r.reason}（${node.url}）`);
          break;
        }
        case 'image':
          checkImage(node, node.url);
          break;
        case 'imageReference': {
          const url = definitions.get(node.identifier);
          if (url !== undefined) checkImage(node, url);
          break;
        }
      }
      node.children?.forEach(walk);
    })(tree);

    if (problems.length > 0) {
      throw new Error(
        `內文安全檢查未通過：${mdFile ?? '（未知檔案）'}\n` +
          problems.map((p) => `  - ${p}`).join('\n') +
          '\n（規則見 docs/cms-plan.md 第六節第 2 點）',
      );
    }
  };
}
