#!/usr/bin/env node
/*
 * Inlines css/style.css and the four js/ files into a single
 * mind_reader_standalone.html (no other files needed to play).
 *
 *   node tools/build-standalone.js
 */
'use strict';
var fs = require('fs');
var path = require('path');

var ROOT = path.join(__dirname, '..');
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, function (_, file) {
  return '<style>\n' + fs.readFileSync(path.join(ROOT, file), 'utf8') + '\n</style>';
});
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, function (_, file) {
  var code = fs.readFileSync(path.join(ROOT, file), 'utf8');
  if (code.indexOf('</script') !== -1) throw new Error(file + ' contains "</script"; cannot inline safely');
  return '<script>\n' + code + '\n</script>';
});

if (/(src|href)="(js|css)\//.test(html)) throw new Error('A local file reference was not inlined');

var out = path.join(ROOT, 'mind_reader_standalone.html');
fs.writeFileSync(out, html);
console.log('Wrote ' + path.relative(process.cwd(), out) + ' (' + html.length + ' bytes)');
