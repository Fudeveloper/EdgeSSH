import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const theme = read('../frontend/src/workspace-theme.css');
const main = read('../frontend/src/main.ts');
const html = read('../frontend/index.html');

test('工作台品牌适配在上游样式之后加载，首次使用与总览一样为浅色', () => {
  assert.ok(main.indexOf("import './workspace-theme.css'") > main.indexOf("import './style.css'"));
  assert.match(html, /<html[^>]+data-theme="light"/);
  assert.match(main, /localStorage\.getItem\(THEME_STORAGE_KEY\)/);
});

test('工作台复用总览品牌变量，不覆盖总览组件', () => {
  for (const token of ['--home-bg', '--home-surface', '--home-font', '--home-mono', '--home-accent', '--home-accent-hover']) {
    assert.ok(theme.includes(`var(${token})`), `${token} 应复用总览定义`);
  }
  assert.doesNotMatch(theme, /#dashboard\s*[.{:]/);
  assert.match(theme, /:root\[data-theme='dark'\]/);
  assert.match(theme, /#app \.live-orb\.connected\s*\{[^}]*var\(--workspace-success\)/);
});

test('适配依赖的关键上游选择器仍然存在，终端输出不被品牌换色', () => {
  // 只约束适配接缝，不锁死上游整份样式，以免正常更新产生无意义冲突。
  for (const name of ['terminal-pane', 'terminal-toolbar', 'terminal-stage', 'terminal-empty', 'workspace-dock', 'resource-metrics']) {
    assert.ok(html.includes(`class="${name}"`) || html.includes(`class="${name} `), `${name} 已变更，请复核适配层`);
  }
  assert.match(main, /background: '#080d12'/);
  assert.match(main, /green: '#69e6b4'/);
  assert.doesNotMatch(theme, /\.xterm[^{]*\{/);
});
