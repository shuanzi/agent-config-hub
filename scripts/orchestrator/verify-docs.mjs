/* global console, process */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const designRoot = 'docs/design/agent-config-manager-ui';
const evidenceRoot = 'docs/acceptance/polished-ui-evidence';

function markdownFiles(root) {
  const files = [];
  function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile() && entry.name.endsWith('.md')) files.push(full);
    }
  }
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.md')) files.push(path.join(root, entry.name));
  }
  for (const name of ['docs', 'src', 'tests', 'performance']) {
    const directory = path.join(root, name);
    if (fs.existsSync(directory)) walk(directory);
  }
  return files.sort();
}

function prose(markdown) {
  return markdown.replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm, '');
}

function anchors(markdown) {
  const ids = new Set();
  const text = prose(markdown);
  for (const match of text.matchAll(/^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
    const base = match[1]
      .replace(/<[^>]+>/g, '')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu, '')
      .replace(/\s/g, '-');
    let id = base;
    for (let n = 1; ids.has(id); n += 1) id = `${base}-${n}`;
    ids.add(id);
  }
  for (const match of text.matchAll(/<(?:a|[a-z][\w-]*)\b[^>]*\b(?:id|name)=["']([^"']+)["']/gi))
    ids.add(match[1]);
  return ids;
}

/** 检查维护文档；不访问网络、不读取本地 Skills 或执行文档中的命令。 */
export function verifyDocs(root) {
  const errors = [];
  const files = markdownFiles(root);
  const scripts =
    JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts ?? {};
  const anchorCache = new Map();
  function fail(file, message) {
    errors.push(`${path.relative(root, file)}: ${message}`);
  }
  function checkLink(file, raw) {
    if (/^(?:[a-z][\w+.-]*:|\/\/)/i.test(raw)) return;
    try {
      const [pathname, fragment] = raw.split('#');
      const decoded = decodeURIComponent(pathname.split('?')[0]);
      if (path.isAbsolute(decoded)) {
        fail(file, `本地链接不能使用绝对路径：${raw}`);
        return;
      }
      const target = decoded ? path.resolve(path.dirname(file), decoded) : file;
      if (!fs.existsSync(target)) {
        fail(file, `链接目标不存在：${raw}`);
        return;
      }
      if (fragment && target.endsWith('.md')) {
        if (!anchorCache.has(target))
          anchorCache.set(target, anchors(fs.readFileSync(target, 'utf8')));
        if (!anchorCache.get(target).has(decodeURIComponent(fragment)))
          fail(file, `锚点不存在：${raw}`);
      }
    } catch (error) {
      fail(file, `链接无效：${raw}（${error.message}）`);
    }
  }
  for (const file of files) {
    const markdown = fs.readFileSync(file, 'utf8');
    const text = prose(markdown).replace(/`[^`\n]+`/g, '');
    for (const match of text.matchAll(
      /!?\[[^\]\n]*\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g,
    ))
      checkLink(file, match[1] ?? match[2]);
    const references = new Map();
    const normalize = (label) => label.trim().replace(/\s+/g, ' ').toLowerCase();
    for (const match of text.matchAll(/^ {0,3}\[([^\]]+)\]:\s*(?:<([^>]+)>|(\S+))/gm)) {
      references.set(normalize(match[1]), match[2] ?? match[3]);
      checkLink(file, match[2] ?? match[3]);
    }
    for (const match of text.matchAll(/!?\[([^\]\n]+)\]\[([^\]\n]*)\]/g)) {
      if (!references.has(normalize(match[2] || match[1])))
        fail(file, `引用链接未定义：${match[2] || match[1]}`);
    }
    for (const match of markdown.matchAll(/\b(?:corepack\s+)?npm\s+run\s+([\w:-]+)/g)) {
      if (!Object.hasOwn(scripts, match[1])) fail(file, `npm 命令不存在：${match[1]}`);
    }
  }
  function json(relative) {
    return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
  }
  function pngSize(relative) {
    const data = fs.readFileSync(path.join(root, relative));
    if (
      data.length < 24 ||
      data.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' ||
      data.toString('ascii', 12, 16) !== 'IHDR'
    )
      throw new Error(`无效 PNG：${relative}`);
    return [data.readUInt32BE(16), data.readUInt32BE(20)];
  }
  try {
    const manifestPath = `${designRoot}/polished/preview-manifest.tsv`;
    const lines = fs.readFileSync(path.join(root, manifestPath), 'utf8').trim().split(/\r?\n/);
    if (lines.shift() !== 'file\tnode_id\tlogical_width\tlogical_height')
      throw new Error('设计清单列名不匹配');
    const nodes = new Map(
      json(`${designRoot}/agent-config-manager-ui-polished.pen`).children.map((node) => [
        node.id,
        node,
      ]),
    );
    const previews = new Map();
    const ids = new Set();
    for (const line of lines) {
      const [file, id, width, height] = line.split('\t');
      if (previews.has(file) || ids.has(id)) throw new Error(`设计清单重复：${file}/${id}`);
      const node = nodes.get(id);
      if (!node || node.width !== Number(width) || node.height !== Number(height))
        throw new Error(`Pen 节点或画板尺寸不匹配：${file}/${id}`);
      pngSize(`${designRoot}/polished/previews/${file}`);
      previews.set(file, { id, width: Number(width), height: Number(height) });
      ids.add(id);
    }
    const pngs = fs
      .readdirSync(path.join(root, designRoot, 'polished/previews'))
      .filter((name) => name.endsWith('.png'));
    if (pngs.length !== previews.size || pngs.some((name) => !previews.has(name)))
      throw new Error('设计 PNG 与清单不完整对应');
    const screenshots = json(`${evidenceRoot}/screenshot-manifest.json`);
    const seen = new Set();
    for (const item of screenshots) {
      const preview = previews.get(item.file);
      if (seen.has(item.file)) throw new Error(`实际截图清单重复：${item.file}`);
      seen.add(item.file);
      if (
        !preview ||
        preview.id !== item.node_id ||
        preview.width !== Number(item.logical_width) ||
        preview.height !== Number(item.logical_height)
      )
        throw new Error(`实际截图与设计清单不匹配：${item.file}`);
      const [width, height] = pngSize(`${evidenceRoot}/${item.file}`);
      if (width !== item.actual_width || height !== item.actual_height)
        throw new Error(`实际截图尺寸不匹配：${item.file}`);
    }
    if (!previews.size || !screenshots.length) throw new Error('设计或实际截图清单为空');
    for (const file of previews.keys()) {
      if (/^(desktop-|mobile-|dialog-)/.test(file) && !seen.has(file)) {
        throw new Error(`实际截图清单遗漏页面或弹窗：${file}`);
      }
    }
  } catch (error) {
    errors.push(`设计／截图清单：${error.message}`);
  }
  return { errors, documentCount: files.length };
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
    const result = verifyDocs(root);
    for (const error of result.errors) console.error(`FAIL ${error}`);
    console.log(`文档检查：${result.documentCount} 份 Markdown，${result.errors.length} 项错误`);
    process.exitCode = result.errors.length ? 1 : 0;
  } catch (error) {
    console.error(`FAIL 文档检查未完成：${error.message}`);
    process.exitCode = 1;
  }
}
