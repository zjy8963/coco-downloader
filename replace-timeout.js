const fs = require('fs');
const path = require('path');

function walk(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full);
    else if (e.name.endsWith('.ts')) {
      let content = fs.readFileSync(full, 'utf-8');
      if (content.includes('timeout: 10000')) {
        content = content.replace(/timeout: 10000/g, 'timeout: 5000');
        fs.writeFileSync(full, content, 'utf-8');
        console.log('Updated:', full);
      }
    }
  }
}

walk(path.join(__dirname, 'src/lib/playlist/resolvers/adapters'));
console.log('Done');
