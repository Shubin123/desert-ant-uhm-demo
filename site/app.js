import config from './config.js';

const $ = (id) => document.getElementById(id);
const escape = (value) => String(value).replace(/[&<>"']/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const percent = (x) => `${(Number(x) * 100).toFixed(1)}%`;
let modelPromise, busy = false;
const urls = new Set();
function objectUrl(blob) { const url = URL.createObjectURL(blob); urls.add(url); return url; }
function releaseUrls() { for (const url of urls) URL.revokeObjectURL(url); urls.clear(); }
window.addEventListener('pagehide', releaseUrls);

function status(message, state = 'idle') {
  $('status').textContent = message;
  $('output').dataset.state = state;
}
async function model() {
  if (!modelPromise) {
    status('Loading model. First use downloads the weights.', 'loading');
    $('progress').hidden = false;
    modelPromise = import('./runtime.js').then(({ load }) => load((fraction) => {
      $('progress').value = Math.max(0, Math.min(1, fraction));
      $('status').textContent = `Loading model: ${percent(fraction)}`;
    })).catch((error) => { modelPromise = null; throw error; }).finally(() => { $('progress').hidden = true; });
  }
  return modelPromise;
}
async function perform(task) {
  if (busy) return;
  busy = true;
  for (const button of document.querySelectorAll('button')) button.disabled = true;
  $('output').replaceChildren();
  status('Working...', 'loading');
  const start = performance.now();
  try {
    await task();
    status(`Complete in ${((performance.now() - start) / 1000).toFixed(2)} s`, 'success');
  } catch (error) {
    status('Could not complete. You can retry.', 'error');
    $('output').innerHTML = `<p class="error">${escape(error.message ?? error)}</p>`;
  } finally {
    busy = false;
    for (const button of document.querySelectorAll('button')) button.disabled = false;
  }
}
function bars(items) {
  return items.map(({ name, score }) => `<div class="bar-row"><span>${escape(name)}</span><span class="bar"><i style="width:${Math.max(0,Math.min(1,score))*100}%"></i></span><span class="confidence">${percent(score)}</span></div>`).join('');
}

function textUI() {
  $('controls').innerHTML = `<label for="input">${escape(config.inputLabel)}</label><textarea id="input" maxlength="12000">${escape(config.sample)}</textarea><div class="actions"><button id="run">${escape(config.action)}</button><button class="secondary" id="sample">Try an example</button></div><p class="hint">${escape(config.tip)}</p>`;
  $('sample').onclick = () => { $('input').value = config.sample; };
  $('run').onclick = () => perform(async () => {
    const input = $('input').value.trim();
    if (!input) throw new Error('Enter some text first.');
    const m = await model();
    if (config.id === 'emo') {
      const result = await m.suggestions(input, { limit: 5 });
      $('output').innerHTML = `<div class="chips">${result.map((r) => `<div class="chip"><span class="emoji">${escape(r.emoji)}</span><span class="confidence">${percent(r.confidence)}</span></div>`).join('')}</div>`;
    } else if (config.id === 'gist') {
      const result = await m.classify(input, { topK: 5 });
      $('output').innerHTML = bars(result.map((r) => ({ name: r.name, score: r.score })));
    } else if (config.id === 'redact') {
      const result = await m.redaction(input);
      $('output').innerHTML = `<pre>${escape(result.redactedText)}</pre><p class="hint">${result.items.length} sensitive items detected.</p>${result.items.map((r) => `<p class="hint">${escape(r.label)}: ${escape(r.placeholder)} (${percent(r.confidence)})</p>`).join('')}`;
    } else {
      const result = m.detect(input);
      const names = new Intl.DisplayNames(['en'], { type: 'language' });
      $('output').innerHTML = `<h2>${escape(result.language ? names.of(result.language) : 'No language detected')}</h2><p class="hint">${escape(result.reliability)}${result.isTooCloseToCall ? ' · Too close to call' : ''}</p>${bars(result.candidates.map((r) => ({ name: names.of(r.language), score: r.probability })))}`;
    }
  });
}

async function decode(file) {
  const context = new AudioContext();
  try {
    const buffer = await context.decodeAudioData(await file.arrayBuffer());
    const samples = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < data.length; i++) samples[i] += data[i] / buffer.numberOfChannels;
    }
    return { samples, sampleRate: buffer.sampleRate };
  } finally { await context.close(); }
}
function wav(samples, rate) {
  const data = new ArrayBuffer(44 + samples.length * 2), view = new DataView(data);
  const text = (offset, value) => { for (let i = 0; i < value.length; i++) view.setUint8(offset+i,value.charCodeAt(i)); };
  text(0,'RIFF');view.setUint32(4,data.byteLength-8,true);text(8,'WAVE');text(12,'fmt ');view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);view.setUint32(24,rate,true);view.setUint32(28,rate*2,true);view.setUint16(32,2,true);view.setUint16(34,16,true);text(36,'data');view.setUint32(40,samples.length*2,true);
  for(let i=0;i<samples.length;i++)view.setInt16(44+i*2,Math.max(-1,Math.min(1,samples[i]))*(samples[i]<0?32768:32767),true);
  return new Blob([data],{type:'audio/wav'});
}
async function record() {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({audio:true});
    const recorder = new MediaRecorder(stream), chunks = [];
    recorder.ondataavailable = (e) => { if(e.data.size) chunks.push(e.data); };
    const done = new Promise((resolve,reject) => { recorder.onstop=resolve;recorder.onerror=(e)=>reject(e.error ?? new Error('Recording failed')); });
    recorder.start();
    status('Recording for 8 seconds. Speak now.', 'loading');
    await new Promise((resolve) => setTimeout(resolve,8000));
    if(recorder.state !== 'inactive')recorder.stop();
    await done;
    return new Blob(chunks,{type:recorder.mimeType});
  } finally { stream?.getTracks().forEach((track)=>track.stop()); }
}
function audioUI() {
  $('controls').innerHTML = `<label for="audio-file">Choose an audio file</label><input type="file" id="audio-file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.flac"><div class="actions"><button id="run">${escape(config.action)}</button><button id="record" class="secondary">Record 8 seconds</button></div><p class="hint">${escape(config.tip)}</p>`;
  const runAudio = async (file) => {
    if (!file || !file.size) throw new Error('Choose an audio file first.');
    releaseUrls();
    const m = await model();
    status('Processing audio on your device...', 'loading');
    if (config.id === 'uhm') {
      const audio=await decode(file),result=await m.analyze(audio.samples,audio.sampleRate,(f)=>{$('status').textContent=`Analyzing: ${percent(f)}`;}),url=objectUrl(file);
      $('output').innerHTML=`<audio id="source-audio" controls src="${url}"></audio><h2>${result.fillers.length} filler spans detected</h2>${result.fillers.map((f,i)=>`<p><button class="secondary" data-span="${i}">${escape(f.type)} · ${f.start.toFixed(2)} - ${f.end.toFixed(2)} s</button> <span class="confidence">${percent(f.confidence)}</span></p>`).join('')}<p class="hint">Experimental browser adaptation. Type labels are secondary; this is not the official Uhm SDK.</p>`;
      $('output').querySelectorAll('[data-span]').forEach(button=>{button.onclick=()=>{$('source-audio').currentTime=result.fillers[Number(button.dataset.span)].start;$('source-audio').play().catch(()=>{});};});
    } else if (config.id === 'voz') {
      const result = await m.transcribe(file, { onProgress:(f)=>{ $('status').textContent=`Transcribing: ${percent(f)}`; } });
      $('output').innerHTML = `<pre>${escape(result.text)}</pre><div>${result.words.map((word)=>`<span class="word">${escape(word.text)}<small>${word.start.toFixed(2)} - ${word.end.toFixed(2)} s</small></span>`).join('')}</div><p class="hint">${result.duration.toFixed(1)} seconds of audio.</p>`;
    } else {
      const audio = await decode(file);
      if(config.id === 'clear') {
        const result = await m.enhance(audio.samples,audio.sampleRate);
        const original = objectUrl(file), enhanced = objectUrl(wav(result.samples,result.sampleRate));
        $('output').innerHTML = `<div class="audio-pair"><div><label>Original</label><audio controls src="${original}"></audio></div><div><label>Enhanced</label><audio controls src="${enhanced}"></audio></div></div><div class="actions"><a class="button" href="${enhanced}" download="clear-enhanced.wav">Download enhanced WAV</a></div><p class="hint">${result.durationSec.toFixed(1)} s enhanced in ${result.processingSec.toFixed(2)} s.</p>`;
      } else {
        const result=await m.identify(audio.samples,audio.sampleRate), names=new Intl.DisplayNames(['en'],{type:'language'});
        $('output').innerHTML=`<h2>${escape(result.language ? names.of(result.language) : 'No language detected')}</h2><p class="hint">${result.isReliable ? 'Reliable detection' : 'Uncertain detection. Try a longer speech recording.'}</p>${bars(result.candidates.map((r)=>({name:names.of(r.language),score:r.probability})))}`;
      }
    }
  };
  $('run').onclick=()=>perform(()=>runAudio($('audio-file').files[0]));
  $('record').onclick=()=>perform(async()=>runAudio(await record()));
}

function moderatorUI() {
  $('controls').innerHTML='<label for="image-file">Choose an image</label><input id="image-file" type="file" accept="image/*"><img id="preview" alt="Your selected image" hidden><label for="quality">Analysis quality</label><select id="quality"><option value="accurate">Accurate</option><option value="balanced">Balanced</option><option value="fast">Fast</option></select><div class="actions"><button id="run">Analyze image</button></div><p class="hint">Scores rank content; they are not probabilities. Images are processed on your device.</p>';
  $('image-file').onchange=()=>{releaseUrls();const file=$('image-file').files[0];$('preview').hidden=!file;if(file)$('preview').src=objectUrl(file);};
  $('run').onclick=()=>perform(async()=>{
    const file=$('image-file').files[0];if(!file)throw new Error('Choose an image first.');
    const m=await model(),result=await m.analyze(file,{quality:$('quality').value});
    $('output').innerHTML=`<h2>${result.isNSFW?'Flagged as NSFW':'Not flagged'}</h2><p class="hint">Overall score: ${Number(result.score).toFixed(3)} · Threshold: 0.5</p>${bars(Object.entries(result.regions).map(([name,score])=>({name,score})))}`;
  });
}

function shapesUI() {
  $('controls').innerHTML='<label for="canvas">Draw a shape in a single stroke</label><canvas id="canvas" aria-label="Shape drawing canvas"></canvas><div class="actions"><button id="run">Recognize stroke</button><button id="reset" class="secondary">Clear canvas</button><button id="sample" class="secondary">Example rectangle</button></div><p class="hint">Try a line, rectangle, triangle, ellipse, or star. Draw with a mouse, finger, or stylus.</p>';
  const canvas=$('canvas'),context=canvas.getContext('2d');let points=[],drawing=false;
  const repaint=()=>{const r=canvas.getBoundingClientRect();context.clearRect(0,0,r.width,r.height);context.strokeStyle='#738976';context.lineWidth=3;context.lineCap='round';context.lineJoin='round';context.beginPath();points.forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.stroke();};
  new ResizeObserver(()=>{const r=canvas.getBoundingClientRect(),d=window.devicePixelRatio||1;canvas.width=r.width*d;canvas.height=r.height*d;context.setTransform(d,0,0,d,0,0);repaint();}).observe(canvas);
  const position=(e)=>{const r=canvas.getBoundingClientRect();return{x:e.clientX-r.left,y:e.clientY-r.top};};
  canvas.onpointerdown=(e)=>{if(busy)return;drawing=true;points=[position(e)];canvas.setPointerCapture(e.pointerId);repaint();};
  canvas.onpointermove=(e)=>{if(!drawing)return;points.push(position(e));repaint();};
  canvas.onpointerup=()=>{drawing=false;};canvas.onpointercancel=()=>{drawing=false;};
  $('reset').onclick=()=>{points=[];repaint();$('output').replaceChildren();status('Ready');};
  $('sample').onclick=()=>{points=[];const corners=[{x:60,y:50},{x:260,y:50},{x:260,y:230},{x:60,y:230},{x:60,y:50}];for(let j=0;j<4;j++)for(let i=0;i<35;i++)points.push({x:corners[j].x+(corners[j+1].x-corners[j].x)*i/35,y:corners[j].y+(corners[j+1].y-corners[j].y)*i/35});points.push(corners[4]);repaint();};
  $('run').onclick=()=>perform(async()=>{
    if(points.length<3)throw new Error('Draw a stroke first.');
    const stroke=points.map(p=>({...p})),m=await model(),shape=await m.recognize(stroke);
    repaint();
    if(shape){context.strokeStyle='#245c46';context.lineWidth=4;context.beginPath();
      if(shape.kind==='line'){context.moveTo(shape.from.x,shape.from.y);context.lineTo(shape.to.x,shape.to.y);}
      else if(shape.kind==='rectangle'||shape.kind==='triangle'){(shape.corners??shape.vertices).forEach((p,i)=>i?context.lineTo(p.x,p.y):context.moveTo(p.x,p.y));context.closePath();}
      else if(shape.kind==='ellipse'){context.ellipse(shape.center.x,shape.center.y,shape.semiMajor,shape.semiMinor,shape.rotation,0,Math.PI*2);}
      else if(shape.kind==='star'){for(let i=0;i<shape.pointCount*2;i++){const radius=i%2?shape.innerRadius:shape.outerRadius,angle=shape.rotation+i*Math.PI/shape.pointCount-Math.PI/2,x=shape.center.x+radius*Math.cos(angle),y=shape.center.y+radius*Math.sin(angle);i?context.lineTo(x,y):context.moveTo(x,y);}context.closePath();}
      context.stroke();$('output').innerHTML=`<h2>Recognized: ${escape(shape.kind)}</h2><p class="hint">The green outline is the model's fitted shape.</p>`;
    }else{$('output').innerHTML='<p>No shape recognized. Try a cleaner single stroke.</p>';}
  });
}

if(config.type==='text')textUI();
else if(config.type==='audio')audioUI();
else if(config.id==='moderator')moderatorUI();
else shapesUI();
