// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NeuralSpecOcean-WallpaperEngine Contributors
// Wallpaper Engine port of NeuralSpecOcean (https://github.com/bgbg108555/NeuralSpecOcean)
// On-screen diagnostics for Wallpaper Engine (loaded first, in <head>).
// Shows WebGL2 support, boot progress, frame rate and any JS errors.
(function () {
  'use strict';
  var t0 = Date.now();
  var errors = [];
  var frames = 0, fps = 0, lastFpsT = performance.now();
  var propsSeen = 0;
  var forceShow = false;
  var bootedAt = 0;

  function pushErr(msg) {
    msg = String(msg || 'unknown error');
    if (errors.indexOf(msg) < 0 && errors.length < 8) errors.push(msg.slice(0, 300));
  }
  window.addEventListener('error', function (e) {
    pushErr((e.message || e.type) + (e.filename ? ' @' + e.filename.split('/').pop() + ':' + e.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (e) {
    var r = e.reason;
    pushErr('Promise: ' + (r && (r.stack || r.message) || r));
  });
  var origErr = console.error;
  console.error = function () {
    try { pushErr('console.error: ' + Array.prototype.map.call(arguments, String).join(' ')); } catch (_) {}
    return origErr.apply(console, arguments);
  };

  var gl2 = 'checking', gpu = '';
  try {
    var c = document.createElement('canvas');
    var g = c.getContext('webgl2');
    if (g) {
      gl2 = 'yes';
      var ext = g.getExtension('WEBGL_debug_renderer_info');
      gpu = ext ? g.getParameter(ext.UNMASKED_RENDERER_WEBGL) : g.getParameter(g.RENDERER);
      var lose = g.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } else {
      gl2 = 'NO (WebGL2 unavailable)';
    }
  } catch (e) { gl2 = 'error: ' + e.message; }

  function tick(now) {
    frames++;
    if (now - lastFpsT >= 1000) { fps = frames; frames = 0; lastFpsT = now; }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  window.__weDiag = {
    errors: errors,
    noteProps: function () { propsSeen++; },
    setForceShow: function (on) { forceShow = !!on; render(); }
  };

  var box = null;
  function text(id) { var el = document.getElementById(id); return el ? el.textContent : '-'; }
  function render() {
    if (!document.body) return;
    if (!box) {
      box = document.createElement('pre');
      box.id = 'weDiag';
      box.style.cssText = 'position:fixed;left:12px;bottom:12px;z-index:9999;margin:0;max-width:min(720px,90vw);' +
        'padding:8px 10px;background:rgba(0,0,0,.72);color:#bfffe0;font:12px/1.4 Consolas,monospace;' +
        'border:1px solid rgba(120,255,200,.35);border-radius:6px;white-space:pre-wrap;pointer-events:none';
      document.body.appendChild(box);
    }
    var booted = !!window.oceanDebug;
    if (booted && !bootedAt) bootedAt = Date.now();
    var hide = !forceShow && booted && errors.length === 0 && Date.now() - bootedAt > 8000;
    box.style.display = hide ? 'none' : 'block';
    if (hide) return;
    var lines = [
      'NeuralSpecOcean 診斷  ' + Math.round((Date.now() - t0) / 1000) + 's',
      'WebGL2: ' + gl2 + (gpu ? '  |  ' + gpu : ''),
      '啟動: ' + (booted ? '完成 ✓' : text('loadingPct') + '  ' + text('loadingStage')),
      '畫面更新: ' + fps + ' fps  |  頁面: ' + document.visibilityState + '  |  WE 設定收到: ' + propsSeen + ' 次',
      '視窗: ' + innerWidth + 'x' + innerHeight + ' @' + devicePixelRatio
    ];
    if (errors.length) lines.push('錯誤:\n- ' + errors.join('\n- '));
    if (!booted && fps === 0 && Date.now() - t0 > 4000) lines.push('⚠ 畫面沒有在更新（requestAnimationFrame 停住）— 請檢查 WE 的「其他程式焦點/全螢幕時暫停」設定');
    box.textContent = lines.join('\n');
  }
  setInterval(render, 500);
})();
