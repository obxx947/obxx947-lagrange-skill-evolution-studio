/* ========================================
   统一 LLM 调用入口（LLM Gate）
   ----------------------------------------
   - 收拢 agent/qa/skills/kb-dev 分散的 callLLM 调用
   - 每个"派生LLM子Agent"调用前 acquire 子Agent额度（≤7），执行完 release
   - 满额 → 抛"子Agent已满"让调用方降级；未配key → 抛错
   - 计入子Agent的角色：agentReview(质检A) / agentJudge(质检B) / reflect / toolReview
     / toolMeta / toolRepair / entityExtract / conflictArbitrate 等
   ======================================== */
const LLMGate = (function(){
    // 依赖：SubAgentPool（window）
    function pool(){ return window.SubAgentPool; }

    // 统一调用：role 为子Agent角色名，prompt 为创建方注入的提示词
    // opts: {llm, messages, temperature, maxTokens, tools}
    async function callAs(role, prompt, opts){
        const P = pool();
        const token = P.acquire(role, role, prompt);
        if(!token) throw new Error('子Agent已满('+P.getMax()+'个)，降级由创建方直接处理');
        try{
            // 用创建方注入的 prompt 作为 system（替代统一塞主SYSTEM_PROMPT）
            const messages = [{role:'system', content: prompt}].concat(opts && opts.messages ? opts.messages : []);
            return await opts.llmCall(messages, opts.temperature, opts.maxTokens, opts.tools);
        }finally{
            P.release(token && token.token);  // pool 以字符串 token 为 key
        }
    }

    return {callAs, getPool:()=>pool()};
})();

window.LLMGate = LLMGate;
