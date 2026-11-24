import { defineCollection } from 'astro:content';
import { z } from 'astro/zod';
import { glob } from 'astro/loaders';

export const BLOG_CATEGORIES = [
  '光與阿卡西',
  '靈氣與脈輪',
  '命理與占卜',
  '心靈隨筆',
] as const;

export type BlogCategory = (typeof BLOG_CATEGORIES)[number];

/**
 * 選填欄位留空視同未填（CMS 規格書第十三節第 1 點）：
 * Sveltia 對空白欄位寫入 ''，YAML 的空值為 null，只有空白字元的字串（誤按空白鍵）亦同，
 * 一律改成 undefined，交給 .optional() 或 .default() 處理，不讓編輯者照表單操作卻建置失敗。
 * 所有選填或有預設值的欄位都要包這一層。
 */
const blank = <T extends z.ZodType>(schema: T) =>
  z.preprocess((v) => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v), schema);

const blog = defineCollection({
  // 只收 .md：.mdx 可在建置時執行程式（CMS 規格書第六節第 1 點）
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    updatedDate: blank(z.coerce.date().optional()),
    author: blank(z.string().default('星靈織語')),
    authorRole: blank(z.string().optional()),
    category: blank(z.enum(BLOG_CATEGORIES).default('心靈隨筆')),
    tags: blank(z.array(z.string()).default([])),
    coverImage: blank(z.string().optional()),
    readTime: blank(z.string().default('5 分鐘')),
    featured: blank(z.boolean().default(false)),
  }),
});

export const collections = { blog };
