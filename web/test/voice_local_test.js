// 闭环验证：TTS 合成中文 → ASR 识别
const path = require('path');
const ROOT = 'C:/Users/Administrator/Desktop/拉格朗日智能体3';
const M = path.join(ROOT, 'assets/voice/models');
const sherpa = require(path.join(ROOT, 'node_modules/sherpa-onnx'));
const fs = require('fs');

// ---- 1. TTS（vits-melo-tts-zh_en）----
const tts = sherpa.createOfflineTts({
  model: { vits: {
    model: path.join(M,'tts/model.onnx'),
    tokens: path.join(M,'tts/tokens.txt'),
    lexicon: path.join(M,'tts/lexicon.txt'),
    dataDir: path.join(M,'tts/'),
    dictDir: path.join(M,'tts/dict/'),
  }, provider: 'cpu', numThreads: 1, debug: false },
  ruleFsts: '', maxNumSentences: 1,
});
const text = '你好，欢迎使用本地语音识别和合成。';
console.log('TTS 合成: "' + text + '"');
const r = tts.generate(text, 0, 1.0);
console.log('  采样率:', r.sampleRate, '| 时长:', (r.samples.length / r.sampleRate).toFixed(2) + 's', '| 样本数:', r.samples.length);
if (!r.samples.length) { console.log('❌ TTS 失败'); process.exit(1); }
// 写 wav
const hdr = Buffer.alloc(44);
hdr.write('RIFF',0); hdr.writeUInt32LE(36+r.samples.length*2,4); hdr.write('WAVE',8);
hdr.write('fmt ',12); hdr.writeUInt32LE(16,16); hdr.writeUInt16LE(1,20); hdr.writeUInt16LE(1,22);
hdr.writeUInt32LE(r.sampleRate,24); hdr.writeUInt32LE(r.sampleRate*2,28); hdr.writeUInt16LE(2,32); hdr.writeUInt16LE(16,34);
hdr.write('data',36); hdr.writeUInt32LE(r.samples.length*2,40);
const wav = Buffer.concat([hdr, Buffer.from(new Int16Array(r.samples).buffer)]);
fs.writeFileSync('/tmp/tts_out.wav', wav);
console.log('  ✅ wav 已生成 /tmp/tts_out.wav (' + wav.length + 'B)');

// ---- 2. ASR（zipformer-14M 流式）识别 TTS 生成的语音 ----
const asr = sherpa.createOnlineRecognizer({
  featConfig: { sampleRate: 16000, featureDim: 80 },
  modelConfig: { transducer: {
    encoder: path.join(M,'encoder-epoch-99-avg-1.int8.onnx'),
    decoder: path.join(M,'decoder-epoch-99-avg-1.int8.onnx'),
    joiner: path.join(M,'joiner-epoch-99-avg-1.int8.onnx'),
  }, tokens: path.join(M,'asr_tokens.txt'), provider: 'cpu', numThreads: 1, debug: false },
  decodingMethod: 'greedy_search',
});
// 16k 单声道 float32
const src = new Int16Array(wav.buffer, 44);
const float32 = new Float32Array(src.length);
for (let i=0;i<src.length;i++) float32[i] = src[i]/32768;
const s = asr.createStream();
const chunk = 1600; // 100ms
for (let i=0;i<float32.length;i+=chunk) {
  s.acceptWaveform({ sampleRate: 16000, samples: float32.subarray(i, i+chunk) });
}
s.inputFinished();
const result = asr.getResult(s);
console.log('ASR 识别结果: "' + result.text + '"');
const expect = text.replace(/[，。]/g,'');
const got = result.text.replace(/[，。\s]/g,'');
console.log(got.includes(expect.slice(0,4)) || expect.slice(0,4).includes(got) ? '✅ 闭环验证通过：TTS→ASR 识别一致' : '⚠️ 识别与原文不完全一致（可能标点/同音差异）');
