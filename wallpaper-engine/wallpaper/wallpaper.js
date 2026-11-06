// SPDX-License-Identifier: MIT
// Copyright (c) 2026 NeuralSpecOcean-WallpaperEngine Contributors
// Wallpaper Engine port of NeuralSpecOcean (https://github.com/bgbg108555/NeuralSpecOcean)
// Wallpaper Engine adapter for NeuralSpecOcean.
// Reads user properties from Wallpaper Engine and drives the simulation through window.oceanDebug.
(function () {
  'use strict';

  var PRESET_IDS = {
    coast: 'previewCoast',
    rocks: 'previewRocks',
    swash: 'previewSwash',
    offshore: 'previewOffshore',
    dive: 'previewDive'
  };

  // Defaults mirror project.json so the page also works when opened in a normal browser.
  var state = {
    showui: false,
    viewpreset: 'coast',
    autorotate: true,
    rotatemode: 'cw',
    rotaterange: 25,
    rotateperiod: 60,
    timemode: 'realtime',
    timeofday: 15.6,
    cycleminutes: 30,
    timetransition: 8,
    waterpalette: 'emerald',
    watertint: 0,
    waterdepth: 1,
    waterclarity: 1,
    terrain: 'baseline',
    amplitude: 0.64,
    foam: 0.94,
    quality: 'medium',
    volume: 50,
    mouse: true,
    parallax: true,
    parallaxstrength: 5,
    parallaxinvert: false,
    fps: 0
  };

  // Cursor position for the parallax effect, normalised to -1..1 (0 = screen centre).
  // Registered before the blocker below so it still works when mouse interaction is off.
  var mouseTarget = { x: 0, y: 0 };
  function trackMouse(e) {
    if (!innerWidth || !innerHeight) return;
    mouseTarget.x = Math.max(-1, Math.min(1, (e.clientX / innerWidth) * 2 - 1));
    mouseTarget.y = Math.max(-1, Math.min(1, (e.clientY / innerHeight) * 2 - 1));
  }
  window.addEventListener('pointermove', trackMouse, { capture: true, passive: true });
  window.addEventListener('mousemove', trackMouse, { capture: true, passive: true });

  // When mouse interaction is off, swallow pointer/wheel events before they reach the canvas.
  ['pointerdown', 'pointermove', 'pointerup', 'wheel'].forEach(function (type) {
    window.addEventListener(type, function (e) {
      if (state.mouse) return;
      if (state.showui && e.target && e.target.tagName !== 'CANVAS') return; // keep the control panel usable
      e.stopImmediatePropagation();
      if (type === 'wheel') e.preventDefault();
    }, { capture: true, passive: false });
  });

  var applied = {};      // last value pushed to the engine, per key
  var api = null;        // window.oceanDebug once boot finishes
  var paused = false;
  var cycleStartMs = Date.now();
  var cycleStartHour = state.timeofday;

  function $(id) { return document.getElementById(id); }

  function setInput(id, value, evt) {
    var el = $(id);
    if (!el) return;
    el.value = String(value);
    el.dispatchEvent(new Event(evt || 'input'));
  }

  function wantedHour() {
    if (state.timemode === 'realtime') {
      var d = new Date();
      return d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600;
    }
    if (state.timemode === 'cycle') {
      var minutes = Math.max(1, Number(state.cycleminutes) || 30);
      var elapsedH = (Date.now() - cycleStartMs) / 60000 / minutes * 24;
      return (cycleStartHour + elapsedH) % 24;
    }
    return Number(state.timeofday) || 0;
  }

  function applyGui() {
    api.setImmersiveMode(!state.showui);
    document.body.classList.toggle('we-show-ui', !!state.showui);
  }

  function applyAudio() {
    var vol = Math.max(0, Math.min(100, Number(state.volume) || 0));
    var a = api.oceanAudio;
    if (!a) return;
    a.setVolume(vol / 100);
    a.setEnabled(vol > 0 && !paused);
    if (vol > 0 && !paused) a.unlock();
    var el = $('audioVolume');
    if (el) el.value = String(vol);
    var out = $('audioVolumeValue');
    if (out) out.textContent = Math.round(vol) + '%';
  }

  function applyWater(immediate) {
    var opts = {
      palette: state.waterpalette,
      tint: Number(state.watertint),
      depthScale: Number(state.waterdepth),
      clarity: Number(state.waterclarity)
    };
    if (immediate) {
      api.setWaterOptics(opts);
    } else {
      $('waterPalette').value = opts.palette;
      setInput('waterTint', opts.tint);
      setInput('waterDepthScale', opts.depthScale);
      setInput('waterClarity', opts.clarity);
    }
  }

  // Push every changed setting into the engine. `first` = right after boot (jump instead of glide).
  function sync(first) {
    if (!api) return;
    var changed = function (k) { return first || applied[k] !== state[k]; };

    if (changed('showui')) applyGui();
    if (changed('quality')) api.setQuality(state.quality);
    // the engine boots with the baseline terrain, so skip a needless (slow) rebake at startup
    if (changed('terrain') && !(first && state.terrain === 'baseline')) api.setTerrainKind(state.terrain);
    if (changed('fps')) api.setFpsCap(Number(state.fps) || 0);

    if (changed('viewpreset')) {
      var id = PRESET_IDS[state.viewpreset] || 'previewCoast';
      if (first) api.applyPreset(id);
      else if ($(id)) $(id).click();
    }

    if (changed('amplitude')) setInput('amplitude', state.amplitude);
    if (changed('foam')) setInput('foamBoost', state.foam);

    if (changed('waterpalette') || changed('watertint') || changed('waterdepth') || changed('waterclarity')) {
      applyWater(first);
    }

    if (changed('volume')) applyAudio();

    if (changed('timemode') || changed('timeofday') || changed('cycleminutes')) {
      if (state.timemode === 'cycle' && !first && !changed('timeofday')) {
        // switching into the cycle or changing its speed: continue from what is on screen
        cycleStartHour = tod.shown == null ? wantedHour() : tod.shown;
        cycleStartMs = Date.now();
      }
      var h = wantedHour();
      if (first) {
        api.setTimeOfDay(h);
        tod.shown = h;
        tod.tween = null;
      } else {
        requestHour(h);
      }
    }

    for (var k in state) applied[k] = state[k];
  }

  // ---- Smooth time-of-day transitions ----
  // The engine's own glide crosses even 12 hours in about a second, which reads as a jump.
  // Big changes are tweened here over several seconds; small ones (clock ticks) pass straight through.
  var tod = { shown: null, tween: null, lastPush: 0 };
  var SMALL_STEP_H = 0.25;

  function wrap24(h) { return ((h % 24) + 24) % 24; }
  function hourDiff(a, b) { return ((b - a + 36) % 24) - 12; }  // shortest signed path a -> b
  function pushHour(h) { setInput('timeOfDay', wrap24(h).toFixed(3)); }

  function requestHour(h) {
    h = wrap24(h);
    if (tod.shown == null) { tod.shown = h; pushHour(h); return; }
    if (tod.tween) {
      // already heading there: just follow the moving target (real-time / cycle clock)
      if (Math.abs(hourDiff(tod.tween.to, h)) < SMALL_STEP_H) { tod.tween.to = h; return; }
    }
    var d = hourDiff(tod.shown, h);
    if (Math.abs(d) < SMALL_STEP_H) {
      tod.tween = null;
      tod.shown = h;
      pushHour(h);
      return;
    }
    var maxDur = Math.max(1, Number(state.timetransition) || 8);
    // longer for bigger jumps: a 12 h swing takes the full duration
    var dur = Math.max(1.5, maxDur * Math.sqrt(Math.abs(d) / 12));
    tod.tween = { from: tod.shown, to: h, start: performance.now(), dur: dur * 1000 };
  }

  function stepTimeTween(now) {
    if (!api) return;
    if (state.timemode !== 'fixed' && !paused && now - (tod.lastClock || 0) > 250) {
      tod.lastClock = now;
      requestHour(wantedHour());
    }
    var tw = tod.tween;
    if (!tw) return;
    var p = Math.min(1, (now - tw.start) / tw.dur);
    var e = p * p * (3 - 2 * p);  // ease in-out
    tod.shown = wrap24(tw.from + hourDiff(tw.from, tw.to) * e);
    if (p >= 1) {
      tod.shown = tw.to;
      tod.tween = null;
      pushHour(tod.shown);
    } else if (now - tod.lastPush > 50) {
      tod.lastPush = now;
      pushHour(tod.shown);
    }
  }
  (function todLoop(now) {
    requestAnimationFrame(todLoop);
    stepTimeTween(now || performance.now());
  })();

  // Camera motion that stays in front of the scene: swing left/right around the
  // starting view (clockwise-first or counterclockwise-first), or trace a figure eight.
  // Yaw grows counterclockwise seen from above, so clockwise = negative offset.
  var lastT = 0;
  var motionT = 0;
  var base = null;      // {yaw, pitch} the motion is centred on
  var lastSet = null;   // what we wrote last frame, to detect user drags

  function motionOffset(t) {
    var range = (Number(state.rotaterange) || 25) * Math.PI / 180;
    var period = Math.max(5, Number(state.rotateperiod) || 60);
    var w = 2 * Math.PI * t / period;
    var vert = Math.min(0.12, range * 0.3);  // vertical swing is a fraction of the horizontal one
    var mode = String(state.rotatemode || 'cw');
    // "_r" suffix (and legacy "ccw") = reverse: mirror the horizontal motion, which also reverses its direction of travel
    var dir = (mode === 'ccw' || /_r$/.test(mode)) ? 1 : -1;
    var shape = mode.replace(/_r$/, '');
    if (shape === 'eight') {
      // 1:2 Lissajous = figure eight
      return { yaw: dir * range * Math.sin(w), pitch: vert * Math.sin(2 * w) };
    }
    if (shape === 'circle') {
      // loop around the starting view; the vertical part fades in over 3 s so it starts without a jump
      var ease = Math.min(1, t / 3);
      ease = ease * ease * (3 - 2 * ease);
      return { yaw: dir * range * Math.sin(w), pitch: vert * ease * Math.cos(w) };
    }
    return { yaw: dir * range * Math.sin(w), pitch: 0 };
  }

  // Mouse-follow (parallax): the view leans a little toward the cursor, eased so it never snaps.
  var par = { yaw: 0, pitch: 0 };
  function stepParallax(dt) {
    var on = state.parallax && !paused;
    var s = on ? (Number(state.parallaxstrength) || 5) * Math.PI / 180 : 0;
    if (state.parallaxinvert) s = -s;
    // cursor right -> camera leans right (yaw up); cursor up -> camera leans up (pitch up)
    var goalYaw = mouseTarget.x * s;
    var goalPitch = -mouseTarget.y * s * 0.5;
    var k = 1 - Math.exp(-2.5 * dt);
    par.yaw += (goalYaw - par.yaw) * k;
    par.pitch += (goalPitch - par.pitch) * k;
  }

  // Camera controller: final view = base + swing motion + mouse parallax.
  function spin(t) {
    requestAnimationFrame(spin);
    var dt = lastT ? Math.min(0.1, (t - lastT) / 1000) : 0;
    lastT = t;
    if (!api || !api.getOrbit || paused) return;
    var cur = api.getOrbit();
    if (cur.gliding || cur.dive) { base = null; return; }  // preset change in progress / underwater
    stepParallax(dt);
    var motionOn = !!state.autorotate;
    var parActive = state.parallax || Math.abs(par.yaw) > 1e-4 || Math.abs(par.pitch) > 1e-4;
    if (!motionOn && !parActive) { base = null; return; }  // nothing to drive: leave the camera alone

    var off = motionOn ? motionOffset(motionT) : { yaw: 0, pitch: 0 };
    if (!base) {
      motionT = 0;
      off = motionOn ? motionOffset(0) : { yaw: 0, pitch: 0 };
      base = { yaw: cur.yaw - off.yaw - par.yaw, pitch: cur.pitch - off.pitch - par.pitch };
    } else if (lastSet && (Math.abs(cur.yaw - lastSet.yaw) > 1e-4 || Math.abs(cur.pitch - lastSet.pitch) > 1e-4)) {
      // user dragged the camera: re-centre on the new view without a jump
      base = { yaw: cur.yaw - off.yaw - par.yaw, pitch: cur.pitch - off.pitch - par.pitch };
    }
    if (motionOn) {
      motionT += dt;
      off = motionOffset(motionT);
    }
    api.setYawPitch(base.yaw + off.yaw + par.yaw, base.pitch + off.pitch + par.pitch);
    lastSet = api.getOrbit();
  }
  requestAnimationFrame(spin);

  // Wait for the simulation to finish booting.
  var bootPoll = setInterval(function () {
    if (!window.oceanDebug) return;
    clearInterval(bootPoll);
    api = window.oceanDebug;
    cycleStartMs = Date.now();
    var startH = Number(state.timeofday);
    cycleStartHour = Number.isFinite(startH) ? startH : 15.6;  // 0 (midnight) is a valid start
    try { sync(true); } catch (e) { console.error('initial sync failed', e && e.stack || e); }
    // Wallpaper Engine may have paused us while we were still loading
    if (paused) {
      api.setPlaying(false);
      applyAudio();
    }
  }, 200);

  function readProps(props) {
    var map = {
      showui: 'showui', viewpreset: 'viewpreset', autorotate: 'autorotate', rotatemode: 'rotatemode', rotaterange: 'rotaterange', rotateperiod: 'rotateperiod',
      timemode: 'timemode', timeofday: 'timeofday', cycleminutes: 'cycleminutes', timetransition: 'timetransition',
      waterpalette: 'waterpalette', watertint: 'watertint', waterdepth: 'waterdepth', waterclarity: 'waterclarity',
      terrain: 'terrain', amplitude: 'amplitude', foam: 'foam', quality: 'quality', volume: 'volume',
      mouseinteract: 'mouse', parallax: 'parallax', parallaxstrength: 'parallaxstrength', parallaxinvert: 'parallaxinvert'
    };
    for (var key in map) {
      if (props[key] && props[key].value !== undefined) state[map[key]] = props[key].value;
    }
    if (props.timeofday && state.timemode === 'cycle') {
      cycleStartHour = Number(state.timeofday) || 0;
      cycleStartMs = Date.now();
    }
  }

  window.wallpaperPropertyListener = {
    applyUserProperties: function (props) {
      if (window.__weDiag) {
        window.__weDiag.noteProps();
        if (props.showdiag) window.__weDiag.setForceShow(props.showdiag.value);
      }
      readProps(props);
      if (props.rotatemode || props.rotaterange || props.rotateperiod || props.autorotate) base = null;
      try { sync(false); } catch (e) { console.error('sync failed', e && e.stack || e); }
    },
    applyGeneralProperties: function (props) {
      if (props.fps !== undefined) {
        state.fps = Number(props.fps) || 0;
        sync(false);
      }
    },
    setPaused: function (isPaused) {
      paused = !!isPaused;
      if (!api) return;
      api.setPlaying(!paused);
      applyAudio();
    }
  };

  // Hide the UI as early as possible (before boot ends) unless asked to show it.
  document.body.classList.add('gui-hidden');
})();
