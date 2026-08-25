/* ========================================
   本地离线语音模块（sherpa-onnx WASM）
   ----------------------------------------
   - 本地 ASR：zipformer-14M 流式识别（麦克风 → 文字）
   - 本地 TTS：vits-zh-aishell3 中文合成（文字 → 语音）
   - 模型经 wasm 虚拟文件系统(FS)注入：C API 用路径读取
   - 模型与运行时从 voice/ 静态加载，首次 IndexedDB 缓存
   - 纯本地推理，不依赖网络
   ======================================== */
const Voice = (function(){
    const BASE = (window.KB_BASE||'') + 'voice/sherpa/';
    let _Module = null;
    let _asr = null, _tts = null;
    let _ready = null;
    let _status = 'idle';

    // ---- IndexedDB 缓存（首次下载后离线可用）----
    function cachePut(url, buf){
        try{
            const db=indexedDB.open('lagrange_voice',1);
            db.onupgradeneeded=()=>{ if(!db.result.objectStoreNames.contains('files')) db.result.createObjectStore('files'); };
            db.onsuccess=()=>{ try{ db.result.transaction('files','readwrite').objectStore('files').put(buf,url); }catch(e){} };
        }catch(e){}
    }
    function cacheGet(url){
        return new Promise(res=>{
            try{
                const db=indexedDB.open('lagrange_voice',1);
                db.onsuccess=()=>{ try{ const rq=db.result.transaction('files','readonly').objectStore('files').get(url); rq.onsuccess=()=>res(rq.result||null); rq.onerror=()=>res(null); }catch(e){res(null);} };
                db.onerror=()=>res(null);
            }catch(e){ res(null); }
        });
    }
    async function cachedFetch(url){
        try{
            const r=await fetch(url);
            if(!r.ok) throw new Error(url+' '+r.status);
            const buf=await r.arrayBuffer();
            cachePut(url,buf);
            return buf;
        }catch(e){
            const c=await cacheGet(url);
            if(c) return c;
            throw new Error('模型加载失败(离线且未缓存): '+url);
        }
    }

    async function loadWasm(){
        if(_Module) return _Module;
        const wasmUrl=BASE+'sherpa-onnx-wasm-web.wasm';
        const jsUrl=BASE+'sherpa-onnx-wasm-web.js';
        await new Promise((res,rej)=>{ const s=document.createElement('script'); s.src=jsUrl; s.async=true; s.onload=res; s.onerror=()=>rej(new Error('wasm JS 加载失败')); document.head.appendChild(s); });
        _Module = await window.SherpaOnnx({
            locateFile: p=> p.endsWith('.wasm') ? wasmUrl : BASE+p,
            print: ()=>{}, printErr: ()=>{},
        });
        return _Module;
    }

    // 把模型注入 wasm 虚拟文件系统（FS），供 C API 以路径读取
    async function injectFile(Module, fsPath, url){
        const buf=await cachedFetch(url);
        const bytes=new Uint8Array(buf);
        // 写进 FS（emscripten 虚拟文件系统，相对路径对应根 '/'）
        Module.FS.writeFile(fsPath.replace(/^\.\//,''), bytes);
    }

    async function init(){
        if(_ready) return _ready;
        _status='loading';
        _ready=(async()=>{
            const Module=await loadWasm();
            // —— 注入 ASR 模型（封装硬编码 ./encoder.onnx, ./tokens.txt）——
            await injectFile(Module,'./encoder.onnx', BASE+'encoder.onnx');
            await injectFile(Module,'./decoder.onnx', BASE+'decoder.onnx');
            await injectFile(Module,'./joiner.onnx', BASE+'joiner.onnx');
            await injectFile(Module,'./tokens.txt', BASE+'tokens.txt');   // asr tokens
            _asr = createOnlineRecognizer(Module);

            // —— 注入 TTS 模型（封装 modelType=vits，vits 路径取自 config 传值）——
            await injectFile(Module,'./model.onnx', BASE+'model.onnx');
            await injectFile(Module,'./tts_tokens.txt', BASE+'model_tokens.txt');
            await injectFile(Module,'./lexicon.txt', BASE+'model_lexicon.txt');
            _tts = createOfflineTts(Module, {
                model:{ vits:{ model:'./model.onnx', tokens:'./tts_tokens.txt', lexicon:'./lexicon.txt', dataDir:'' },
                        modelType:'vits', numThreads:1, provider:'cpu', debug:false },
                ruleFsts:'', maxNumSentences:1,
            });
            _status='ready';
            return true;
        })().catch(e=>{ _status='error'; _ready=null; throw e; });
        return _ready;
    }

    // 流式识别：Float32Array(16kHz) → 文本
    function asr(audioSamples){
        if(!_asr) throw new Error('ASR 未初始化');
        const recognizer=_asr, s=recognizer.createStream();
        const chunk=1600;
        for(let i=0;i<audioSamples.length;i+=chunk){
            s.acceptWaveform(16000, audioSamples.subarray(i,i+chunk));
            while(recognizer.isReady(s)) recognizer.decode(s);
        }
        s.inputFinished();
        while(recognizer.isReady(s)) recognizer.decode(s);
        const res=recognizer.getResult(s);
        // 此 web 封装 stream 无 freeStream/free 方法；不释放不影响单次识别
        return res.text||'';
    }

    // TTS：文字 → { samples:Float32Array(16k), sampleRate }
    function tts(text){
        if(!_tts) throw new Error('TTS 未初始化');
        const g=_tts.generate({ text, sid:0, speed:1.0 });
        if(!g||!g.samples||!g.samples.length) return null;
        return { samples:g.samples, sampleRate:g.sampleRate };
    }
    // requestAnimationFrame 里的 generate 回调兼容
    function ttsWithCallback(text, cb){
        if(!_tts) throw new Error('TTS 未初始化');
        _tts.generate({ text, sid:0, speed:1.0 }, cb);
    }

    function getStatus(){ return _status; }
    return { init, asr, tts, ttsWithCallback, getStatus };
})();
window.Voice = Voice;
