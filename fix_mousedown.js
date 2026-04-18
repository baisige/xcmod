const fs = require('fs');
const path = 'd:/xcmod/app.js';
let content = fs.readFileSync(path, 'utf8');

const old = 'document.addEventListener("mousedown", function(e) {\n        var tag = e.target.tagName;\n        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") {\n          // 延迟到当前事件循环结束后执行，避免与原生 focus 行为冲突\n          setTimeout(function() { e.target.focus(); }, 0);\n        }\n      }, true);';

const newCode = 'document.addEventListener("mousedown", function(e) {\n        var tag = e.target.tagName;\n        if (tag === "INPUT" || tag === "TEXTAREA") {\n          // 延迟到当前事件循环结束后执行，避免与原生 focus 行为冲突\n          setTimeout(function() { e.target.focus(); }, 0);\n        }\n      }, true);';

if (content.includes(old)) {
  content = content.replace(old, newCode);
  fs.writeFileSync(path, content, 'utf8');
  console.log('Fixed mousedown handler - removed SELECT');
} else {
  console.log('Pattern not found');
}