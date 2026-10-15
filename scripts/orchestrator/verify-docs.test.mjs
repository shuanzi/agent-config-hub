import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { verifyDocs } from './verify-docs.mjs';

const design = 'docs/design/agent-config-manager-ui';
const evidence = 'docs/acceptance/polished-ui-evidence';
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'acm-docs-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(root, name)), { recursive: true });
    fs.writeFileSync(path.join(root, name), text);
  };
  // 完整 1×1 PNG；测试无需启动应用或浏览器。
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=',
    'base64',
  );
  write('package.json', JSON.stringify({ scripts: { 'verify:docs': 'node check.mjs' } }));
  write(
    'README.md',
    '# 文档\n\n[指南](docs/说明.md#中文标题)\n\n[图片][image]\n\n[image]: docs/design/agent-config-manager-ui/polished/previews/desktop-test.png\n\n`npm run verify:docs`\n',
  );
  write('docs/说明.md', '# 中文标题\n\n[返回](../README.md#文档)\n');
  write(
    `${design}/agent-config-manager-ui-polished.pen`,
    JSON.stringify({ children: [{ id: 'node1', width: 1, height: 1 }] }),
  );
  write(
    `${design}/polished/preview-manifest.tsv`,
    'file\tnode_id\tlogical_width\tlogical_height\ndesktop-test.png\tnode1\t1\t1\n',
  );
  write(`${design}/polished/previews/desktop-test.png`, png);
  write(`${evidence}/desktop-test.png`, png);
  write(
    `${evidence}/screenshot-manifest.json`,
    JSON.stringify([
      {
        file: 'desktop-test.png',
        node_id: 'node1',
        logical_width: '1',
        logical_height: '1',
        actual_width: 1,
        actual_height: 1,
      },
    ]),
  );
  return { root, write };
}

test('校验中文链接、锚点、引用图片、npm 命令与两种清单，包含未提交文档', (t) => {
  const { root, write } = fixture(t);
  write('.agents/local/SKILL.md', '[本地资料](missing.md)');
  assert.deepEqual(verifyDocs(root), { errors: [], documentCount: 2 });
});

for (const [name, markdown, message] of [
  ['断开的文件链接', '[缺失](missing.md)', '链接目标不存在'],
  ['不存在的锚点', '[标题](docs/说明.md#missing)', '锚点不存在'],
  ['图片失效', '![图](missing.png)', '链接目标不存在'],
  ['未定义引用', '[文字][missing]', '引用链接未定义'],
  ['命令漂移', '```sh\nnpm run nonexistent\n```', 'npm 命令不存在'],
])
  test(name, (t) => {
    const { root, write } = fixture(t);
    write('README.md', markdown);
    assert.ok(verifyDocs(root).errors.some((error) => error.includes(message)));
  });

test('重复标题和编码链接可解析，代码块内的示例链接不参与检查', (t) => {
  const { root, write } = fixture(t);
  write('docs/说明.md', '# 中文标题\n\n# 中文标题\n');
  write(
    'README.md',
    '[重复](docs/%E8%AF%B4%E6%98%8E.md#中文标题-1)\n\n```md\n[示例](missing.md)\n```\n',
  );
  assert.deepEqual(verifyDocs(root).errors, []);
});

test('设计清单节点漂移不能通过', (t) => {
  const { root, write } = fixture(t);
  write(`${design}/agent-config-manager-ui-polished.pen`, JSON.stringify({ children: [] }));
  assert.ok(verifyDocs(root).errors.some((error) => error.includes('Pen 节点')));
});

test('实际截图像素尺寸漂移不能通过', (t) => {
  const { root, write } = fixture(t);
  write(
    `${evidence}/screenshot-manifest.json`,
    JSON.stringify([
      {
        file: 'desktop-test.png',
        node_id: 'node1',
        logical_width: '1',
        logical_height: '1',
        actual_width: 2,
        actual_height: 1,
      },
    ]),
  );
  assert.ok(verifyDocs(root).errors.some((error) => error.includes('实际截图尺寸')));
});

test('设计清单不能遗漏新增预览', (t) => {
  const { root, write } = fixture(t);
  write(`${design}/polished/previews/extra.png`, 'extra');
  assert.ok(verifyDocs(root).errors.some((error) => error.includes('不完整对应')));
});

test('实际截图清单不能只保留部分页面', (t) => {
  const { root, write } = fixture(t);
  const pen = JSON.parse(
    fs.readFileSync(path.join(root, design, 'agent-config-manager-ui-polished.pen'), 'utf8'),
  );
  pen.children.push({ id: 'node2', width: 1, height: 1 });
  write(`${design}/agent-config-manager-ui-polished.pen`, JSON.stringify(pen));
  const manifest = fs.readFileSync(
    path.join(root, design, 'polished/preview-manifest.tsv'),
    'utf8',
  );
  write(`${design}/polished/preview-manifest.tsv`, manifest + 'mobile-test.png\tnode2\t1\t1\n');
  write(
    `${design}/polished/previews/mobile-test.png`,
    fs.readFileSync(path.join(root, design, 'polished/previews/desktop-test.png')),
  );
  assert.ok(verifyDocs(root).errors.some((error) => error.includes('实际截图清单遗漏')));
});

function matrixFixture(t) {
  const context=fixture(t);
  const matrix='docs/design/skill-matrix';
  context.write(`${matrix}/previews/state.png`,fs.readFileSync(path.join(context.root,design,'polished/previews/desktop-test.png')));
  context.write(`${matrix}/approved-prototype.zip`,'fixture');
  context.write(`${matrix}/preview-manifest.tsv`,'file\twidth\theight\tevidence\npreviews/state.png\t1\t1\t模拟界面\n');
  return {...context,matrix};
}
test('矩阵预览按实际编码与像素尺寸通过', (t) => {
  const {root}=matrixFixture(t);assert.deepEqual(verifyDocs(root).errors,[]);
});
for (const [name,file,width,extra,expected] of [
  ['扩展名错配','state.jpg',1,false,'编码与扩展名不一致'],
  ['尺寸错配','state.png',2,false,'实际尺寸不匹配'],
  ['缺失记录','state.png',1,true,'不完整对应'],
]) test(`矩阵${name}不能通过`, (t) => {
  const {root,write,matrix}=matrixFixture(t);
  if (file.endsWith('.jpg')) fs.renameSync(path.join(root,matrix,'previews/state.png'),path.join(root,matrix,`previews/${file}`));
  write(`${matrix}/preview-manifest.tsv`,`file\twidth\theight\tevidence\npreviews/${file}\t${width}\t1\t模拟界面\n`);
  if (extra) write(`${matrix}/previews/extra.png`,fs.readFileSync(path.join(root,matrix,'previews/state.png')));
  assert.ok(verifyDocs(root).errors.some((error)=>error.includes(expected)));
});
test('矩阵 JPEG 尺寸读取保持宽高顺序', (t) => {
  const {root,write,matrix}=matrixFixture(t);
  fs.rmSync(path.join(root,matrix,'previews/state.png'));
  // SOF metadata fixture, 3×2, sufficient for the header checker.
  write(`${matrix}/previews/state.jpg`,Buffer.from([0xff,0xd8,0xff,0xc0,0,8,8,0,2,0,3,1,0xff,0xd9]));
  write(`${matrix}/preview-manifest.tsv`,'file\twidth\theight\tevidence\npreviews/state.jpg\t3\t2\t模拟界面\n');
  assert.deepEqual(verifyDocs(root).errors,[]);
});
