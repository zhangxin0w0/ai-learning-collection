// 从单文件 HTML 中抽取主 <script> 用于语法/回归测试。
// 用法：node _extract.js  （需在项目目录内运行，依赖同目录 jicshi-radar.html）
const fs = require('fs');
const path = require('path');
const here = __dirname;
const html = fs.readFileSync(path.join(here, 'jicshi-radar.html'), 'utf8');
// 抓取最后一个无 src 属性的 <script> ... </script> 块（主应用脚本）
const re = /<script>([\s\S]*?)<\/script>/g;
let m, last = null;
while ((m = re.exec(html)) !== null) { last = m[1]; }
if (!last) { console.error('NO SCRIPT FOUND'); process.exit(2); }
const out = path.join(here, '_real.js');
fs.writeFileSync(out, last);
console.log('extracted bytes:', last.length, 'lines:', last.split('\n').length, '->', out);
