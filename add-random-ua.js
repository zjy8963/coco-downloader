const fs = require('fs');
const files = [
  'src/lib/playlist/resolvers/adapters/netease/simple.ts',
  'src/lib/playlist/resolvers/adapters/netease/complex.ts',
  'src/lib/playlist/resolvers/adapters/qq/simple.ts',
  'src/lib/playlist/resolvers/adapters/kugou/simple.ts',
  'src/lib/playlist/resolvers/adapters/kuwo/simple.ts',
  'src/lib/playlist/resolvers/adapters/kuwo/yibai.ts',
];
const base = 'C:/Users/Admin/Desktop/myworkspace/主项目/coco-downloader/';

for (const file of files) {
  let c = fs.readFileSync(base + file, 'utf-8');
  let changed = false;

  // 1. 添加 randomUA import（如果还没有）
  if (c.includes('from \'../../../types\'') && !c.includes('randomUA')) {
    c = c.replace("from '../../../types'", "from '../../../types';\nimport { randomUA } from '../../../utils'");
    changed = true;
  }

  // 2. 已显式设 UA 的行跳过，其余 { timeout: ... } 加 random UA
  c = c.replace(/\{ timeout: (\d+) \}/g, (match, t) => {
    // 检查后面是否有 User-Agent（说明已设 headers）
    const idx = c.indexOf(match);
    const after = c.substring(idx, idx + 200);
    if (after.includes("User-Agent")) return match;
    return `{ headers: { 'User-Agent': randomUA() }, timeout: ${t} }`;
  });

  // 3. 已有 headers 对象但没 User-Agent 的，加上去
  c = c.replace(/(headers: \{)([^}]*)\}/g, (match, prefix, inner) => {
    if (inner.includes("User-Agent") || inner.includes("user-agent")) return match;
    return `${prefix} 'User-Agent': randomUA(),${inner} }`;
  });

  fs.writeFileSync(base + file, c, 'utf-8');
  console.log('Done:', file);
}
console.log('All done');
