// ============================================================
//  部落格管理系統 - Google Apps Script v4
//  後端：Supabase (PostgreSQL)
//  GET：load、delete；POST：save、publish
//  GitHub: waveec/news
// ============================================================

const SUPABASE_URL  = 'https://ljbtnysponckfonzcdpa.supabase.co';
const SUPABASE_KEY  = '*** 填入 Supabase service_role key ***';
const GITHUB_OWNER  = 'waveec';
const GITHUB_REPO   = 'news';
const GITHUB_TOKEN  = '*** 填入 GitHub PAT ***';

function sbHeaders(extra) {
  return Object.assign({
    'apikey': SUPABASE_KEY,
    'Authorization': 'Bearer ' + SUPABASE_KEY,
    'Content-Type': 'application/json'
  }, extra || {});
}

function doGet(e) {
  const p = e && e.parameter ? e.parameter : {};
  const action = p.action || '';
  let result;
  try {
    if (action === 'load')        result = loadPosts();
    else if (action === 'delete') result = deletePost(p.id);
    else result = { error: 'unknown action' };
  } catch(err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

function doPost(e) {
  let result;
  try {
    const body = JSON.parse(e.postData.contents);
    const action = body.action || '';
    if (action === 'save')         result = savePost(body.post);
    else if (action === 'publish') result = publishPost(body.post);
    else result = { error: 'unknown action' };
  } catch(err) {
    result = { error: err.message };
  }
  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── 讀取所有文章 ──
function loadPosts() {
  const resp = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/posts?order=created_at.desc',
    { method: 'GET', headers: sbHeaders(), muteHttpExceptions: true }
  );
  const posts = JSON.parse(resp.getContentText()) || [];
  return { posts };
}

// ── 儲存文章（upsert）──
function savePost(post) {
  UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/posts',
    {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      payload: JSON.stringify(post),
      muteHttpExceptions: true
    }
  );
  return { ok: true, id: post.id };
}

// ── 刪除文章 ──
function deletePost(id) {
  const getResp = UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/posts?id=eq.' + encodeURIComponent(id) + '&select=slug',
    { method: 'GET', headers: sbHeaders(), muteHttpExceptions: true }
  );
  const rows = JSON.parse(getResp.getContentText());
  UrlFetchApp.fetch(
    SUPABASE_URL + '/rest/v1/posts?id=eq.' + encodeURIComponent(id),
    { method: 'DELETE', headers: sbHeaders(), muteHttpExceptions: true }
  );
  if (rows && rows.length > 0 && rows[0].slug) {
    deleteFromGitHub(rows[0].slug + '.html');
    removeSitemapEntry(rows[0].slug);
  }
  return { ok: true };
}

// ── 發布文章 ──
function publishPost(post) {
  post.status = 'published';
  post.publishedAt = new Date().toISOString();
  savePost(post);
  const html = generateHTML(post);
  const result = pushToGitHub('news/' + post.slug + '.html', html);
  updateSitemap(post.slug, post.date);
  return { ok: true, slug: post.slug, github: result };
}

// ── GitHub 推送 ──
function pushToGitHub(path, content) {
  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;
  const encoded = Utilities.base64Encode(content, Utilities.Charset.UTF_8);
  let sha = '';
  try {
    const check = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'token ' + GITHUB_TOKEN },
      muteHttpExceptions: true
    });
    if (check.getResponseCode() === 200) sha = JSON.parse(check.getContentText()).sha;
  } catch(e) {}

  const payload = { message: 'publish: ' + path, content: encoded, branch: 'main' };
  if (sha) payload.sha = sha;

  const resp = UrlFetchApp.fetch(url, {
    method: 'PUT',
    headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Content-Type': 'application/json' },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  return { code: resp.getResponseCode() };
}

// ── GitHub 刪除 ──
function deleteFromGitHub(filename) {
  const path = 'news/' + filename;
  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;
  try {
    const check = UrlFetchApp.fetch(url, {
      method: 'GET',
      headers: { 'Authorization': 'token ' + GITHUB_TOKEN },
      muteHttpExceptions: true
    });
    if (check.getResponseCode() !== 200) return;
    const sha = JSON.parse(check.getContentText()).sha;
    UrlFetchApp.fetch(url, {
      method: 'DELETE',
      headers: { 'Authorization': 'token ' + GITHUB_TOKEN, 'Content-Type': 'application/json' },
      payload: JSON.stringify({ message: 'delete: ' + path, sha }),
      muteHttpExceptions: true
    });
  } catch(e) {}
}

// ── 更新 Sitemap（新增文章）──
function updateSitemap(slug, date) {
  const path = 'sitemap.xml';
  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;
  const ghHeaders = { 'Authorization': 'token ' + GITHUB_TOKEN, 'Content-Type': 'application/json' };
  let currentXml = '';
  let sha = '';
  try {
    const check = UrlFetchApp.fetch(url, { method: 'GET', headers: ghHeaders, muteHttpExceptions: true });
    if (check.getResponseCode() === 200) {
      const data = JSON.parse(check.getContentText());
      sha = data.sha;
      currentXml = Utilities.newBlob(Utilities.base64Decode(data.content.replace(/\n/g,''))).getDataAsString();
    }
  } catch(e) {}

  const newEntry = `\n  <url>\n    <loc>https://wavecorp1.com/news/${slug}.html</loc>\n    <lastmod>${date || today()}</lastmod>\n    <changefreq>monthly</changefreq>\n    <priority>0.7</priority>\n  </url>`;
  const locTag = `<loc>https://wavecorp1.com/news/${slug}.html</loc>`;

  // 已存在則不重複新增
  if (currentXml.indexOf(locTag) !== -1) return;

  const updated = currentXml
    ? currentXml.replace('</urlset>', newEntry + '\n\n</urlset>')
    : `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${newEntry}\n\n</urlset>`;

  const payload = { message: 'sitemap: add ' + slug, content: Utilities.base64Encode(updated, Utilities.Charset.UTF_8), branch: 'main' };
  if (sha) payload.sha = sha;
  UrlFetchApp.fetch(url, { method: 'PUT', headers: ghHeaders, payload: JSON.stringify(payload), muteHttpExceptions: true });
}

// ── 更新 Sitemap（刪除文章）──
function removeSitemapEntry(slug) {
  const path = 'sitemap.xml';
  const url = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPO + '/contents/' + path;
  const ghHeaders = { 'Authorization': 'token ' + GITHUB_TOKEN, 'Content-Type': 'application/json' };
  let currentXml = '';
  let sha = '';
  try {
    const check = UrlFetchApp.fetch(url, { method: 'GET', headers: ghHeaders, muteHttpExceptions: true });
    if (check.getResponseCode() !== 200) return;
    const data = JSON.parse(check.getContentText());
    sha = data.sha;
    currentXml = Utilities.newBlob(Utilities.base64Decode(data.content.replace(/\n/g,''))).getDataAsString();
  } catch(e) { return; }

  // 移除整個 <url>...</url> 區塊
  const re = /\n?\s*<url>[\s\S]*?<loc>https:\/\/www\.wavecorp1\.com\/news\/${slug}\.html<\/loc>[\s\S]*?<\/url>/g;
  const updated = currentXml.replace(re, '');
  if (updated === currentXml) return; // 本來就沒有，不推

  const payload = { message: 'sitemap: remove ' + slug, content: Utilities.base64Encode(updated, Utilities.Charset.UTF_8), branch: 'main', sha };
  UrlFetchApp.fetch(url, { method: 'PUT', headers: ghHeaders, payload: JSON.stringify(payload), muteHttpExceptions: true });
}

function today() {
  return Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
}

// ── 自動產生 TOC ──
function buildTOC(html) {
  const headings = [];
  const re = /<(h2|h3)[^>]*>([\s\S]*?)<\/\1>/gi;
  let match, h2Count = 0, h3Count = 0;
  while ((match = re.exec(html)) !== null) {
    const tag = match[1].toLowerCase();
    const text = match[2].replace(/<[^>]+>/g, '').trim();
    if (!text) continue;
    if (tag === 'h2') { h2Count++; h3Count = 0; headings.push({ tag, text, num: h2Count + '.', id: 'toc-h2-' + h2Count }); }
    else              { h3Count++;               headings.push({ tag, text, num: h2Count + '.' + h3Count + '.', id: 'toc-h3-' + h2Count + '-' + h3Count }); }
  }
  if (headings.length < 2) return { toc: '', body: html };

  let body = html, hi = 0;
  body = body.replace(/<(h2|h3)([^>]*)>([\s\S]*?)<\/\1>/gi, (full, tag, attrs, inner) => {
    const text = inner.replace(/<[^>]+>/g, '').trim();
    if (!text || hi >= headings.length) return full;
    return `<${tag}${attrs} id="${headings[hi++].id}">${inner}</${tag}>`;
  });

  const items = headings.map(h => {
    const indent = h.tag === 'h3' ? ' style="padding-left:16px;font-size:13px;"' : '';
    return `<li${indent}><a href="#${h.id}">${h.num} ${escHtml(h.text)}</a></li>`;
  }).join('\n');

  const toc = `<div class="toc-box">
  <div class="toc-header">
    <span>Table of Contents</span>
    <button class="toc-toggle" onclick="this.closest('.toc-box').classList.toggle('toc-collapsed')" title="展開／收合">☰</button>
  </div>
  <ol class="toc-list">${items}</ol>
</div>`;

  return { toc, body };
}

// ── 生成靜態 HTML ──
function generateHTML(post) {
  const title     = post.title     || '';
  const slug      = post.slug      || '';
  const date      = post.date      || '';
  const author    = post.author    || '版主';
  const category  = post.category  || '';
  const content   = post.content   || '';
  const metaTitle = post.metaTitle || title;
  const metaDesc  = post.metaDesc  || '';
  const ogImage   = post.ogImage   || '';
  const keywords  = post.keywords  || category;
  const schema    = post.schema    || '';
  const raw       = content.replace(/<!--readmore-->/g, '');
  const { toc, body } = buildTOC(raw);
  const fullHTML  = toc + body;

  const schemaTag = schema
    ? `<script type="application/ld+json">\n${schema}\n</script>`
    : `<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "NewsArticle",
      "headline": "${esc(title)}",
      "datePublished": "${esc(date)}",
      "dateModified": "${esc(date)}",
      "author": {
        "@type": "Organization",
        "@id": "https://wavecorp1.com/#organization",
        "name": "崴富國際有限公司",
        "url": "https://wavecorp1.com"
      },
      "publisher": {
        "@type": "Organization",
        "@id": "https://wavecorp1.com/#organization",
        "name": "崴富國際有限公司",
        "url": "https://wavecorp1.com",
        "logo": {
          "@type": "ImageObject",
          "url": "https://wavecorp1.com/logo.png",
          "width": 200,
          "height": 60
        }
      },
      "url": "https://wavecorp1.com/news/${esc(slug)}.html",
      "description": "${esc(metaDesc)}",
      "image": "${ogImage ? esc(ogImage) : 'https://wavecorp1.com/logo.png'}",
      "mainEntityOfPage": {
        "@type": "WebPage",
        "@id": "https://wavecorp1.com/news/${esc(slug)}.html"
      },
      "keywords": "${esc(category)}"
    },
    {
      "@type": "BreadcrumbList",
      "itemListElement": [
        { "@type": "ListItem", "position": 1, "name": "首頁", "item": "https://wavecorp1.com" },
        { "@type": "ListItem", "position": 2, "name": "最新消息", "item": "https://wavecorp1.com/#blog" },
        { "@type": "ListItem", "position": 3, "name": "${esc(title)}", "item": "https://wavecorp1.com/news/${esc(slug)}.html" }
      ]
    }
  ]
}
</script>`;

  return `<!DOCTYPE html>
<html lang="zh-TW">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${escHtml(metaTitle)} | WaveEC</title>
<meta name="description" content="${escHtml(metaDesc)}">
${keywords ? `<meta name="keywords" content="${escHtml(keywords)}">` : ''}
<meta property="og:title" content="${escHtml(metaTitle)}">
<meta property="og:description" content="${escHtml(metaDesc)}">
<meta property="og:type" content="article">
<meta property="og:url" content="https://wavecorp1.com/news/${escHtml(slug)}.html">
${ogImage ? `<meta property="og:image" content="${escHtml(ogImage)}">` : ''}
${schemaTag}
<link rel="canonical" href="https://wavecorp1.com/news/${escHtml(slug)}.html">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@400;700;900&family=Noto+Sans+TC:wght@300;400;500;700&display=swap" rel="stylesheet">
<style>
:root { --navy:#1a1a2e; --gold:#c9a96e; --paper:#f7f5f0; --steel:#4a5568; --mist:#e8e4dc; }
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Noto Sans TC',sans-serif;background:var(--paper);color:#2d2d2d;}
nav{position:sticky;top:0;z-index:100;background:rgba(247,245,240,0.95);backdrop-filter:blur(16px);border-bottom:1px solid rgba(201,169,110,0.2);padding:0 40px;height:64px;display:flex;align-items:center;justify-content:space-between;}
.nav-logo{font-family:'Playfair Display',serif;font-weight:900;font-size:20px;color:var(--navy);text-decoration:none;letter-spacing:2px;}
.nav-logo span{color:var(--gold);}
.nav-back{font-size:13px;color:var(--gold);font-weight:700;text-decoration:none;}
.nav-back:hover{opacity:0.7;}
.wrap{max-width:780px;margin:0 auto;padding:60px 40px 100px;}
.meta{font-size:12px;color:var(--gold);letter-spacing:1px;margin-bottom:16px;display:flex;gap:12px;align-items:center;flex-wrap:wrap;}
.cat{background:rgba(201,169,110,0.12);padding:3px 10px;border-radius:4px;border:1px solid rgba(201,169,110,0.25);}
h1{font-family:'Playfair Display',serif;font-size:clamp(28px,5vw,44px);font-weight:900;color:var(--navy);line-height:1.2;margin-bottom:32px;}
.divider{height:2px;background:linear-gradient(to right,var(--gold),transparent);margin-bottom:40px;opacity:0.4;}
.content{font-size:16px;line-height:1.9;}
.content h2{font-family:'Playfair Display',serif;font-size:26px;color:var(--navy);margin:32px 0 14px;}
.content h3{font-family:'Playfair Display',serif;font-size:20px;color:var(--navy);margin:24px 0 10px;}
.content p{margin-bottom:20px;}
.content img{max-width:100%;border-radius:10px;margin:20px 0;display:block;}
.content a{color:var(--gold);}
.content blockquote{border-left:3px solid var(--gold);padding:12px 20px;background:rgba(201,169,110,0.06);border-radius:0 8px 8px 0;margin:24px 0;font-style:italic;color:var(--steel);}
.content ul,.content ol{padding-left:24px;margin-bottom:20px;}
.content li{margin-bottom:6px;}
.toc-box{background:#fff;border:1px solid var(--mist);border-radius:12px;padding:20px 24px;margin-bottom:36px;max-width:560px;}
.toc-box.toc-collapsed .toc-list{display:none;}
.toc-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;font-weight:700;font-size:15px;color:var(--navy);}
.toc-toggle{background:none;border:1px solid var(--mist);border-radius:5px;padding:2px 8px;cursor:pointer;font-size:13px;color:var(--steel);transition:background 0.2s;}
.toc-toggle:hover{background:var(--mist);}
.toc-list{list-style:none;padding:0;margin:0;}
.toc-list li{margin-bottom:6px;}
.toc-list a{color:var(--navy);text-decoration:none;font-size:14px;line-height:1.6;}
.toc-list a:hover{color:var(--gold);}
.article-nav{display:flex;justify-content:space-between;gap:20px;margin-top:60px;padding-top:40px;border-top:1px solid var(--mist);}
.article-nav a{flex:1;padding:20px;background:#fff;border:1px solid var(--mist);border-radius:12px;text-decoration:none;transition:all 0.2s;}
.article-nav a:hover{border-color:var(--gold);transform:translateY(-2px);}
.nav-label{font-size:11px;color:var(--gold);letter-spacing:1px;margin-bottom:6px;}
.nav-title{font-size:14px;font-weight:700;color:var(--navy);line-height:1.4;}
.next{text-align:right;}
footer{background:#0d0d0d;padding:30px 40px;display:flex;align-items:center;justify-content:space-between;}
.f-logo{font-family:'Playfair Display',serif;font-size:18px;font-weight:900;color:#fff;}
.f-logo span{color:var(--gold);}
.f-copy{font-size:11px;color:rgba(255,255,255,0.3);}
.back-to-top{position:fixed;bottom:32px;right:32px;width:44px;height:44px;background:var(--navy);color:var(--gold);border:none;border-radius:50%;font-size:22px;cursor:pointer;display:none;align-items:center;justify-content:center;box-shadow:0 4px 16px rgba(0,0,0,0.2);transition:all 0.2s;z-index:999;}
.back-to-top:hover{background:var(--gold);color:var(--navy);transform:translateY(-2px);}
@media(max-width:700px){nav{padding:0 20px;}.wrap{padding:40px 20px 80px;}.article-nav{flex-direction:column;}footer{flex-direction:column;gap:12px;padding:24px 20px;}.back-to-top{bottom:20px;right:20px;}}
</style>
</head>
<body>
<nav>
  <a href="https://wavecorp1.com" class="nav-logo">WA<span>V</span>E</a>
  <a href="https://wavecorp1.com/#blog" class="nav-back">← 返回最新消息</a>
</nav>
<div class="wrap">
  <div class="meta">
    <span>${escHtml(date)}</span>
    ${category ? `<span class="cat">${escHtml(category)}</span>` : ''}
    <span>作者：${escHtml(author)}</span>
  </div>
  <h1>${escHtml(title)}</h1>
  <div class="divider"></div>
  <div class="content">${fullHTML}</div>
  <div class="article-nav" id="articleNav" style="display:none;"></div>
</div>
<button class="back-to-top" id="backToTop" onclick="window.scrollTo({top:0,behavior:'smooth'})" title="回到最上方">&#8679;</button>
<footer>
  <div class="f-logo">WA<span>V</span>E ECOMMERCE</div>
  <div class="f-copy">© 2026 崴富國際有限公司</div>
</footer>
<script>
const SUPABASE_URL  = 'https://ljbtnysponckfonzcdpa.supabase.co';
const SUPABASE_ANON = 'sb_publishable_dbSZrg8KiGT8o_6HrzyBdw_dB7wil2H';
const GAS_URL = 'https://script.google.com/macros/s/AKfycbx6W0RYUzWBfYh3zBLMRi0KAKwfzzl5zC4LSYOnYTf2jXt-swVI7IVDygW9TJkSiYuddw/exec';
const SLUG = '${esc(slug)}';

// 回到最上方
const btn = document.getElementById('backToTop');
window.addEventListener('scroll', () => { btn.style.display = window.scrollY > 300 ? 'flex' : 'none'; });

// 上一篇 / 下一篇（直接讀 Supabase）
fetch(SUPABASE_URL + '/rest/v1/posts?status=eq.published&order=created_at.desc&select=slug,title', {
  headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON }
}).then(r=>r.json()).then(posts=>{
  const i = posts.findIndex(p=>p.slug===SLUG);
  if(i===-1)return;
  const prev=posts[i+1], next=posts[i-1];
  if(!prev&&!next)return;
  const nav=document.getElementById('articleNav');
  nav.style.display='flex';
  nav.innerHTML=(prev?'<a href="/news/'+prev.slug+'.html"><div class="nav-label">← 上一篇</div><div class="nav-title">'+prev.title+'</div></a>':'<div></div>')+(next?'<a href="/news/'+next.slug+'.html" class="next"><div class="nav-label">下一篇 →</div><div class="nav-title">'+next.title+'</div></a>':'<div></div>');
}).catch(()=>{});
</script>
</body>
</html>`;
}

function esc(s){ return String(s||'').replace(/\\/g,'\\\\').replace(/"/g,'\\"').replace(/\n/g,'\\n'); }
function escHtml(s){ return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'); }

