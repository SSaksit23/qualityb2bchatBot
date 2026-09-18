"""Isolated Hermes formatter. The parent supplies only allowlisted booking facts."""
import contextlib, json, logging, os, sys

logging.disable(logging.CRITICAL)

def main(request):
    from tools.registry import registry
    facts = request['result']
    tools = {
        'booking_find': lambda args, **kw: json.dumps(facts, ensure_ascii=False),
        'booking_get': lambda args, **kw: json.dumps(facts, ensure_ascii=False),
        'booking_by_tour_code': lambda args, **kw: json.dumps(facts, ensure_ascii=False),
        'booking_countdown': lambda args, **kw: json.dumps(facts, ensure_ascii=False),
        'booking_missing_fields': lambda args, **kw: json.dumps(facts, ensure_ascii=False),
    }
    for name, handler in tools.items():
        registry.register(name=name, toolset='booking_read', description='Return pre-read, allowlisted Quality B2B facts for this request.',
            schema={'name':name,'description':'Read-only booking facts','parameters':{'type':'object','properties':{},'additionalProperties':False}}, handler=handler)
    from run_agent import AIAgent
    agent=AIAgent(model=os.environ['OPENAI_MODEL'],api_key=os.environ['OPENAI_API_KEY'],base_url='https://api.openai.com/v1',provider='openai',api_mode='chat_completions',
        enabled_toolsets=['booking_read'],max_iterations=3,run_budget_seconds=45,save_trajectories=False,verbose_logging=False,quiet_mode=True,
        skip_context_files=True,load_soul_identity=False,skip_memory=True,skip_background_review=True,checkpoints_enabled=False,session_db=None,
        max_tokens=1200,request_overrides={'store':False,'response_format':{'type':'json_object'}})
    if set(agent.valid_tool_names) != set(tools): raise RuntimeError('Unexpected Hermes tools')
    prompt=('ตอบภาษาไทยแบบกระชับ ใช้ข้อมูลจาก booking tool เท่านั้น รักษาชื่อสถานะภาษาไทยตามต้นฉบับ '
            'บอกเวลาอ่านข้อมูลและวันเวลาสิ้นสุดแบบชัดเจน ห้ามคาดเดา ห้ามทำหรืออ้างว่าทำการแก้ไขใดๆ '
            'คืน JSON {"answer":"..."}')
    try:
        result=agent.run_conversation([{'type':'text','text':json.dumps({'intent':request['intent'],'question':request['text']},ensure_ascii=False)}],system_message=prompt)
        answer=json.loads(result['final_response'])['answer']
        if not isinstance(answer,str) or not answer.strip(): raise ValueError('empty')
        return {'answer':answer}
    finally: agent.close()

if __name__ == '__main__':
    try:
        request=json.load(sys.stdin)
        with open(os.devnull,'w') as sink, contextlib.redirect_stdout(sink), contextlib.redirect_stderr(sink): result=main(request)
        sys.stdout.write(json.dumps(result,ensure_ascii=False))
    except Exception as error:
        sys.stderr.write(type(error).__name__+'\n'); sys.exit(1)
