from pathlib import Path
import re,os
source=Path('/root/.hermes/.env').read_text()
match=re.search(r'^OPENAI_API_KEY\s*=\s*(.+)$',source,re.M)
if not match: raise SystemExit('Existing Hermes OpenAI key unavailable')
key=match[1].strip().strip('"\'')
if not key.startswith('sk-') or any(c.isspace() for c in key): raise SystemExit('Existing credential format requires manual review')
config=Path('/root/.hermes/config.yaml').read_text()
model=re.search(r'^\s+default:\s*(gpt-[A-Za-z0-9.-]+)\s*$',config,re.M)
if not model: raise SystemExit('Existing model not recognized')
target=Path('/etc/qualityb2b-bobo/bobo.env')
lines=[line for line in target.read_text().splitlines() if not re.match(r'^(OPENAI_API_KEY|OPENAI_MODEL|BOBO_WORKFLOW_ENABLED)=',line)]
lines.extend(['OPENAI_API_KEY='+key,'OPENAI_MODEL='+model[1],'BOBO_WORKFLOW_ENABLED=false'])
target.write_text('\n'.join(lines)+'\n')
os.chmod(target,0o600)
print('Dedicated Bobo model configuration saved; workflow remains disabled')
