const fs = require('fs');
const path = require('path');
const dir = path.join(__dirname, 'src/lib/playlist/resolvers/adapters');
function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const f = path.join(d, e.name);
    if (e.isDirectory()) walk(f);
    else if (e.name.endsWith('.ts')) {
      let c = fs.readFileSync(f, 'utf-8');
      if (c.includes('timeout: 10000')) {
        c = c.replace(/timeout: 10000/g, 'timeout: 5000');
        fs.writeFileSync(f, c, 'utf-8');
        console.log('OK:', f);
      }
    }
  }
}
walk(dir);
console.log('Done');
