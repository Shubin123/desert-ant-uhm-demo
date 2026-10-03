// Adapted from Desert Ant Labs' Uhm Detector.swift.
// Copyright 2026 Desert Ant Labs B.V. Source-Available License v1.0.
const BASE='https://huggingface.co/desert-ant-labs/uhm/resolve/v1.1.0/';
export async function load(onProgress) {
 const ort=await import('https://unpkg.com/onnxruntime-web@1.30.0/dist/ort.wasm.min.mjs');
 ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths='https://unpkg.com/onnxruntime-web@1.30.0/dist/';
 onProgress(0);const response=await fetch(BASE+'uhm.onnx');
 if(!response.ok)throw new Error(`Model download failed: HTTP ${response.status}`);
 const bytes=await response.arrayBuffer();onProgress(.8);
 const session=await ort.InferenceSession.create(bytes,{executionProviders:['wasm'],graphOptimizationLevel:'all'});onProgress(1);
 return {async analyze(samples,sampleRate,onWindow){
  if(sampleRate!==16000){const context=new OfflineAudioContext(1,Math.ceil(samples.length*16000/sampleRate),16000),buffer=context.createBuffer(1,samples.length,sampleRate);buffer.copyToChannel(samples,0);const source=context.createBufferSource();source.buffer=buffer;source.connect(context.destination);source.start();samples=(await context.startRendering()).getChannelData(0).slice();}
  if(!samples.length)throw new Error('The recording is empty.');
  const frames=Math.ceil(samples.length/320),sum=new Float32Array(frames),counts=new Uint16Array(frames),classes=Array.from({length:6},()=>new Float32Array(frames));
  for(let start=0;start<samples.length;start+=400000){
   const end=Math.min(samples.length,start+480000),length=end-start,input=new Float32Array(480000);
   let mean=0;for(let i=start;i<end;i++)mean+=samples[i];mean/=length;
   let variance=0;for(let i=start;i<end;i++)variance+=(samples[i]-mean)**2;
   const inverse=1/(Math.sqrt(variance/Math.max(1,length-1))+1e-7);
   for(let i=0;i<length;i++)input[i]=(samples[start+i]-mean)*inverse;
   const outputs=await session.run({audio:new ort.Tensor('float32',input,[1,480000])}),tensor=outputs.probs;
   if(!tensor||tensor.dims.length!==3||tensor.dims[2]!==6)throw new Error('Unexpected model output.');
   const available=Math.min(Math.ceil(length/320),tensor.dims[1]);
   for(let i=0;i<available;i++){const global=start/320+i;if(global>=frames)break;sum[global]+=1-tensor.data[i*6];counts[global]++;for(let c=0;c<6;c++)classes[c][global]+=tensor.data[i*6+c];}
   onWindow?.(end/samples.length);if(end===samples.length)break;
  }
  const probability=Array.from(sum,(v,i)=>counts[i]?v/counts[i]:0),fillers=[];
  for(let i=0;i<frames;){if(probability[i]<.5){i++;continue;}let end=i,total=0;while(end<frames&&probability[end]>=.5)total+=probability[end++];
   const span={start:i*.02,end:Math.min(end*.02,samples.length/16000),confidence:total/(end-i)},last=fillers.at(-1);
   if(last&&span.start-last.end<=.100001){last.end=span.end;last.confidence=Math.max(last.confidence,span.confidence);}
   else if(span.end-span.start>=.099999)fillers.push(span);i=end;
  }
  for(const span of fillers){const scores=new Float32Array(6);for(let i=Math.floor(span.start/.02);i<Math.min(frames,Math.ceil(span.end/.02));i++)for(let c=1;c<6;c++)scores[c]+=counts[i]?classes[c][i]/counts[i]:0;let index=1;for(let c=2;c<6;c++)if(scores[c]>scores[index])index=c;span.type=['not filler','uh','um','hmm','and','other'][index];}
  return {fillers,duration:samples.length/16000};
 }};
}
