// RAG 知识库：文档解析 → 切片 → 索引（BM25 中文分词 / 向量 Embedding 混合检索）→ 带引用的问答
const fs = require('fs');
const path = require('path');
const db = require('../db');
const settings = require('../settings');

// ---------- 文档解析 ----------
async function extractText(filePath, originalName) {
  const ext = path.extname(originalName || filePath).toLowerCase();
  if (ext === '.pdf') {
    const pdf = require('pdf-parse');
    const data = await pdf(fs.readFileSync(filePath));
    return data.text;
  }
  if (ext === '.docx') {
    const mammoth = require('mammoth');
    const r = await mammoth.extractRawText({ path: filePath });
    return r.value;
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  if (ext === '.html' || ext === '.htm')
    return raw.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, '').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ');
  if (ext === '.json') {
    try {
      return JSON.stringify(JSON.parse(raw), null, 1);
    } catch {}
  }
  return raw;
}

// ---------- 切片 ----------
function chunkText(text, size = 450, overlap = 80) {
  const clean = text.replace(/\r/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  const paras = clean.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const chunks = [];
  let cur = '';
  let heading = '';
  for (const p of paras) {
    if (/^#{1,6}\s/.test(p)) heading = p.replace(/^#+\s*/, '').split('\n')[0];
    if ((cur + '\n\n' + p).length > size && cur) {
      chunks.push(cur);
      cur = (heading && !cur.startsWith(heading) ? `${heading}\n` : '') + cur.slice(-overlap) + '\n\n' + p;
    } else cur = cur ? `${cur}\n\n${p}` : p;
    while (cur.length > size * 1.6) {
      chunks.push(cur.slice(0, size));
      cur = cur.slice(size - overlap);
    }
  }
  if (cur.trim()) chunks.push(cur);
  return chunks;
}

// ---------- 分词：英文单词 + 中文单字/双字 ----------
const STOP = new Set(['的', '了', '和', '是', '在', '我', '有', '就', '不', '也', '都', '这', '要', 'the', 'a', 'an', 'of', 'to', 'and', 'is', 'in', 'for', 'on', 'with']);
function tokenize(text) {
  const tokens = [];
  const s = String(text).toLowerCase();
  for (const w of s.match(/[a-z0-9]+/g) || []) if (!STOP.has(w)) tokens.push(w);
  for (const seg of s.match(/[一-龥]+/g) || []) {
    for (let i = 0; i < seg.length; i++) {
      if (!STOP.has(seg[i])) tokens.push(seg[i]);
      if (i < seg.length - 1) tokens.push(seg.slice(i, i + 2));
    }
  }
  return tokens;
}

// ---------- Embedding ----------
async function embed(texts) {
  const cfg = settings.get().embedding;
  if (cfg.provider !== 'openai' || !cfg.apiKey) return null;
  const { http, trimSlash } = require('../providers/llm');
  const out = [];
  for (let i = 0; i < texts.length; i += 16) {
    const data = await http(`${trimSlash(cfg.baseUrl)}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, input: texts.slice(i, i + 16) }),
    });
    out.push(...data.data.map((d) => d.embedding));
  }
  return out;
}

const cosine = (a, b) => {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na * nb) || 1);
};

// ---------- 入库 ----------
async function addDocument(kbId, { title, text, source = 'manual', fileName }) {
  if (!db.kbs.get(kbId)) throw new Error('知识库不存在');
  if (!text || !text.trim()) throw new Error('文档内容为空');
  const doc = db.docs.insert({ kbId, title, source, fileName, chars: text.length, status: 'indexing' });
  const pieces = chunkText(text);
  let vectors = null;
  try {
    vectors = await embed(pieces);
  } catch (e) {
    console.warn('[rag] embedding 失败，降级为 BM25：', e.message);
  }
  pieces.forEach((content, i) =>
    db.chunks.insert({ kbId, docId: doc.id, docTitle: title, index: i, content, tokens: tokenize(content), vector: vectors?.[i] || null }),
  );
  db.docs.update(doc.id, { status: 'ready', chunkCount: pieces.length, embedded: !!vectors });
  refreshKbStats(kbId);
  return db.docs.get(doc.id);
}

function removeDocument(docId) {
  const doc = db.docs.get(docId);
  if (!doc) return false;
  db.chunks.replaceAll(db.chunks.all().filter((c) => c.docId !== docId));
  db.docs.remove(docId);
  refreshKbStats(doc.kbId);
  return true;
}

function removeKb(kbId) {
  db.chunks.replaceAll(db.chunks.all().filter((c) => c.kbId !== kbId));
  db.docs.replaceAll(db.docs.all().filter((d) => d.kbId !== kbId));
  return db.kbs.remove(kbId);
}

function refreshKbStats(kbId) {
  const docs = db.docs.find((d) => d.kbId === kbId);
  db.kbs.update(kbId, { docCount: docs.length, chunkCount: docs.reduce((a, d) => a + (d.chunkCount || 0), 0) });
}

// ---------- 检索 ----------
async function search(query, { kbIds, topK = 5 } = {}) {
  let pool = db.chunks.all();
  if (kbIds?.length) pool = pool.filter((c) => kbIds.includes(c.kbId));
  if (!pool.length) return [];
  const q = tokenize(query);
  const N = pool.length;
  const avgLen = pool.reduce((a, c) => a + c.tokens.length, 0) / N;
  const df = new Map();
  for (const c of pool) for (const t of new Set(c.tokens)) df.set(t, (df.get(t) || 0) + 1);
  const k1 = 1.4, b = 0.75;
  const bm = pool.map((c) => {
    const tf = new Map();
    for (const t of c.tokens) tf.set(t, (tf.get(t) || 0) + 1);
    let s = 0;
    for (const t of new Set(q)) {
      const f = tf.get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - df.get(t) + 0.5) / (df.get(t) + 0.5));
      s += (idf * f * (k1 + 1)) / (f + k1 * (1 - b + (b * c.tokens.length) / avgLen));
    }
    return s;
  });
  const maxBm = Math.max(...bm, 1e-9);
  let vec = null;
  if (pool.some((c) => c.vector)) {
    try {
      const [qv] = (await embed([query])) || [];
      if (qv) vec = pool.map((c) => (c.vector ? cosine(qv, c.vector) : 0));
    } catch {}
  }
  const scored = pool.map((c, i) => ({
    id: c.id,
    kbId: c.kbId,
    docId: c.docId,
    docTitle: c.docTitle,
    content: c.content,
    score: vec ? 0.4 * (bm[i] / maxBm) + 0.6 * vec[i] : bm[i] / maxBm,
  }));
  return scored.filter((s) => s.score > 0.05).sort((a, b) => b.score - a.score).slice(0, topK);
}

async function contextFor(query, topK = 4, kbIds) {
  const hits = await search(query, { topK, kbIds });
  return hits.map((h, i) => `[${i + 1}] 《${h.docTitle}》\n${h.content}`).join('\n\n');
}

async function ask(question, { kbIds } = {}) {
  const llm = require('../providers/llm');
  const hits = await search(question, { kbIds, topK: 5 });
  if (!hits.length) return { answer: '知识库中没有找到相关内容，建议补充相关文档后再提问。', citations: [] };
  let answer;
  if (llm.isMock()) {
    answer =
      `根据知识库检索到 ${hits.length} 条相关内容，要点如下：\n\n` +
      hits
        .slice(0, 3)
        .map((h, i) => `**[${i + 1}] 《${h.docTitle}》**\n${h.content.slice(0, 220).replace(/\n+/g, ' ')}…`)
        .join('\n\n') +
      '\n\n> 当前为离线演示模式（抽取式回答）。在「系统设置」配置大模型后，将基于检索结果生成式回答。';
  } else {
    const ctx = hits.map((h, i) => `[${i + 1}] 《${h.docTitle}》\n${h.content}`).join('\n\n');
    answer = await llm.complete(`参考资料：\n${ctx}\n\n问题：${question}`, {
      system: '你是 TikTok 跨境电商运营知识助手。只依据参考资料回答，用 [编号] 标注引用来源；资料中没有的内容要明确说明。使用 Markdown 输出，简洁专业。',
      temperature: 0.3,
    });
  }
  return { answer, citations: hits.map((h, i) => ({ n: i + 1, docTitle: h.docTitle, content: h.content, score: Math.round(h.score * 100) / 100 })) };
}

module.exports = { extractText, chunkText, tokenize, addDocument, removeDocument, removeKb, search, contextFor, ask };
