/* ========================================
   全局子Agent池（硬限制 ≤7 + 用完销毁 + 创建方注入提示词）
   ----------------------------------------
   - 所有"派生LLM子Agent"（质检A/B、反思、工具审查、自建工具、冲突仲裁等）
     创建前必须 acquire()，达到 MAX=7 即拒绝（降级：跳过/由创建方直接处理）
   - 执行完必须 release() 释放，不常驻内存
   - 子Agent 执行时用创建方传入的 prompt（不统一塞主 SYSTEM_PROMPT）
   ======================================== */
const SubAgentPool = (function(){
    const MAX = 7;
    let count = 0;
    const active = new Map();   // token -> {creator, role, prompt, createdAt}

    // 尝试获取一个子Agent额度；满则返回 null（调用方降级）
    function acquire(creator, role, prompt){
        if(count >= MAX) return null;
        count++;
        const token = 'sa_' + Date.now() + '_' + Math.random().toString(36).slice(2,8);
        active.set(token, {creator, role, prompt, createdAt: Date.now()});
        return {token, creator, role, prompt, isFull:()=>count>=MAX, getCount:()=>count};
    }

    // 释放（用完即弃）
    function release(token){
        if(active.has(token)){ active.delete(token); count--; }
    }

    // 当前派生中的子Agent信息
    function getActive(){ return [...active.values()]; }
    function getCount(){ return count; }
    function isFull(){ return count >= MAX; }
    function getMax(){ return MAX; }

    return {acquire, release, getActive, getCount, isFull, getMax};
})();

// 暴露到 window（跨script标签访问）
window.SubAgentPool = SubAgentPool;

/* ========================================
   全局 LLM 并发锁（固定 1 并发）
   ----------------------------------------
   - 官方默认模型 GLM-4.7-Flash 硬约束：免费账户固定 1 并发，同一时刻只能处理 1 条请求。
   - 项目有子Agent互审、多轮链式调用，若同时发起 2 次 API → 直接 429。
   - 这里用一个 Promise 串行队列，保证任意时刻只有 1 个 LLM 请求在飞，其余排队等待。
   - 各模块 callLLM 统一用 LLMLock.run(fn) 包裹即可。
   ======================================== */
const LLMLock = (function(){
    let chain = Promise.resolve();
    function run(fn){
        // 前一个请求结束后再执行下一个（无论成败），实现≤1并发
        const p = chain.then(fn, fn);
        chain = p.then(()=>{}, ()=>{});   // 吞掉结果，只保留排队语义
        return p;
    }
    return {run};
})();
window.LLMLock = LLMLock;
