const { app, safeStorage } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
app.whenReady().then(async () => {
  try {
    const dataDir = path.join(process.env.APPDATA, '鲸鲸 · QQ 智能伙伴', 'data');
    const raw = fs.readFileSync(path.join(dataDir, 'secrets.enc.json'), 'utf8');
    const env = JSON.parse(raw);
    const text = safeStorage.decryptString(Buffer.from(env.payload, 'base64'));
    const keys = JSON.parse(text);
    const key = keys.breezeblue || '';
    console.log('breezeKey=' + (key ? 'yes(' + key.length + ')' : 'no'));
    const voicesRes = await fetch('https://api.breeze.blue/v1/voices?voice_type=personal&page_size=100', { headers: { 'xi-api-key': key } });
    const voicesText = await voicesRes.text();
    console.log('voicesStatus=' + voicesRes.status);
    let voices = [];
    try { const j = JSON.parse(voicesText); voices = j.voices || j.items || (j.data && j.data.voices) || []; } catch {}
    console.log('personalCount=' + voices.length);
    console.log(voices.slice(0,10).map(v => v.voice_id + '|' + v.name + '|' + (v.origin||'')).join('\n'));
    const settings = JSON.parse(fs.readFileSync(path.join(dataDir, 'settings.json'), 'utf8'));
    const personas = JSON.parse(fs.readFileSync(path.join(dataDir, 'personas.json'), 'utf8'));
    const active = settings.persona?.activeId || 'jingjing';
    const override = personas.overrides?.[active] || {};
    console.log('active=' + active + ' globalVoice=' + (settings.models?.breezeVoiceId||'') + ' personaVoice=' + (override.voiceId||''));
    const voiceId = override.voiceId || settings.models?.breezeVoiceId || (voices[0] && (voices[0].voice_id || voices[0].voiceId));
    if (voiceId) {
      for (const mode of ['full','no-speed','minimal']) {
        const body = mode === 'minimal' ? { text: '你好，我是鲸鲸。', model_id: settings.models?.breezeTts || 'breeze-tts-2-multilingual', voice_settings: { guidance_scale: 1 } } : { text: '你好，我是鲸鲸。', model_id: settings.models?.breezeTts || 'breeze-tts-2-multilingual', voice_settings: { guidance_scale: 2, ...(mode === 'full' ? { speed: 1.15 } : {}) }, instructions: mode === 'full' ? '用自然、亲密的中文口语朗读。' : undefined };
        const res = await fetch('https://api.breeze.blue/v1/text-to-speech/' + encodeURIComponent(voiceId) + '?output_format=mp3', { method: 'POST', headers: { 'xi-api-key': key, 'Content-Type': 'application/json', Accept: 'audio/mpeg, audio/*, */*' }, body: JSON.stringify(body) });
        const buf = Buffer.from(await res.arrayBuffer());
        console.log('tts_' + mode + '=' + res.status + ' bytes=' + buf.length + (res.status >= 400 ? ' body=' + buf.toString('utf8').slice(0,200) : ''));
      }
    }
  } catch (e) { console.log('ERROR ' + e.message); }
  app.quit();
});
