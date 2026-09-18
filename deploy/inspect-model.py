from pathlib import Path
import json,re
for directory in ['/root/.hermes','/var/lib/line-coach/.hermes','/var/lib/qualityb2b-bobo/.hermes','/etc/line-coach','/etc/qualityb2b-bobo']:
    root=Path(directory)
    if not root.exists(): continue
    for path in root.iterdir():
        if path.name not in ['.env','config.yaml','config.yml','coach.env','bobo.env']: continue
        if not path.is_file(): continue
        text=path.read_text()
        keys=re.findall(r'^([A-Z][A-Z0-9_]*(?:KEY|TOKEN|MODEL|URL|PROVIDER))\s*=',text,re.M)
        print(json.dumps({'path':str(path),'configurationKeys':keys}))
        if path.suffix in ['.yaml','.yml']:
            # Only non-secret model/provider identifiers. Never display nested arbitrary values.
            for line in text.splitlines():
                if re.match(r'^\s*(?:model|default|provider|base_url):\s*[A-Za-z0-9_./:-]+\s*$',line):print(line)
