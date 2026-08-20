// Renderer side: mirrors HeaderEffects.tsx vpToggle's capture path.
window.__result = null
window.__log = (msg) => { const el = document.getElementById('log'); if (el) el.textContent += msg + '\n' }

window.__startTest = async () => {
  try {
    window.__log('secureContext=' + window.isSecureContext + ' mediaDevices=' + (navigator.mediaDevices ? 'yes' : 'NO'))
    if (!navigator.mediaDevices) { window.__result = { ok: false, stage: 'nodevices' }; return }
    // 与插件一致:纯音频 getDisplayMedia;handler 拒绝时桌面端会 NotAllowedError
    let stream
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({ video: false, audio: true })
    } catch (err) {
      const name = (err && err.name) || String(err)
      if (name !== 'NotSupportedError' && name !== 'TypeError') throw err
      stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true })
      stream.getVideoTracks().forEach((t) => t.stop())
    }
    const audioTracks = stream.getAudioTracks()
    if (audioTracks.length === 0) { window.__result = { ok: false, stage: 'no-audio-track' }; return }
    // 播放测试音(系统回环会捕获到它)+ 分析器验证有信号
    const audioCtx = new AudioContext()
    if (audioCtx.state === 'suspended') await audioCtx.resume()
    const analyser = audioCtx.createAnalyser()
    analyser.fftSize = 256
    const src = audioCtx.createMediaStreamSource(stream)
    src.connect(analyser)
    const osc = audioCtx.createOscillator()
    osc.frequency.value = 440
    const gain = audioCtx.createGain()
    gain.gain.value = 0.3
    osc.connect(gain).connect(audioCtx.destination)
    osc.start()
    // 采样 1.5s 的频谱能量
    const buf = new Uint8Array(analyser.frequencyBinCount)
    const samples = []
    for (let i = 0; i < 15; i++) {
      await new Promise((r) => setTimeout(r, 100))
      analyser.getByteFrequencyData(buf)
      let sum = 0
      for (let j = 0; j < buf.length; j++) sum += buf[j]
      samples.push(sum / buf.length)
    }
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length
    window.__result = { ok: true, tracks: audioTracks.length, avgEnergy: Math.round(avg * 100) / 100, samples: samples.map((s) => Math.round(s)) }
    window.__log('DONE ok=' + window.__result.ok + ' avg=' + window.__result.avgEnergy)
    osc.stop()
  } catch (err) {
    window.__result = { ok: false, stage: 'catch', name: (err && err.name) || String(err), message: (err && err.message) || String(err) }
    window.__log('FAIL ' + JSON.stringify(window.__result))
  }
}

document.getElementById('go').addEventListener('click', () => { void window.__startTest() })