'use strict';

// Bundle the browser-compatible TypeScript graph without adding a production dependency.
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const root = path.resolve(__dirname, '..');
const entry = 'runtime/AutoPreview.ts';
const modules = new Map();
function collect(id) {
    if (modules.has(id)) return;
    const file = path.join(root, id);
    const result = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
        fileName: file, reportDiagnostics: true,
        compilerOptions: { target: ts.ScriptTarget.ES2020, module: ts.ModuleKind.CommonJS },
    });
    if (result.diagnostics?.length) throw new Error(ts.formatDiagnosticsWithColorAndContext(result.diagnostics, {
        getCurrentDirectory: () => root, getCanonicalFileName: f => f, getNewLine: () => '\n',
    }));
    modules.set(id, result.outputText);
    for (const match of result.outputText.matchAll(/\brequire\(["']([^"']+)["']\)/g)) {
        const name = match[1];
        if (name === 'cc') continue;
        if (!name.startsWith('.')) throw new Error(`Browser runtime cannot import ${name}`);
        const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(id), name)) + '.ts';
        if (dependency.startsWith('../')) throw new Error('Dependency escapes source root');
        collect(dependency);
    }
}
collect(entry);
const factories = [...modules].map(([id, source]) => `${JSON.stringify(id)}: function(require,module,exports){\n${source}\n}`).join(',\n');
const bundle = `/* Cocos Performance Inspector ${require('../package.json').version}: precompiled browser-preview runtime */
(function(){
  'use strict';
  var source = document.currentScript && document.currentScript.src;
  if (!source || !globalThis.System || typeof System.import !== 'function') return;
  var configUrl = new URL('config.json', source).href;
  System.import('cc').then(function(cc){
    var modules = {${factories}};
    var cache = Object.create(null);
    function load(id){
      if (cache[id]) return cache[id].exports;
      var module = cache[id] = { exports: {} };
      modules[id](function(name){
        if (name === 'cc') return cc;
        var parts = id.split('/'); parts.pop();
        name.split('/').forEach(function(p){ if(p === '..') parts.pop(); else if(p !== '.') parts.push(p); });
        return load(parts.join('/') + '.ts');
      }, module, module.exports);
      return module.exports;
    }
    load(${JSON.stringify(entry)}).startAutoPreview(configUrl);
  }).catch(function(error){ console.warn('[性能监控] 自动接入失败', error); });
})();
`;
const output = path.join(root, 'dist/runtime/auto-preview.js');
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, bundle, 'utf8');
console.log(`Browser runtime built: ${modules.size} modules, ${Buffer.byteLength(bundle)} bytes`);
