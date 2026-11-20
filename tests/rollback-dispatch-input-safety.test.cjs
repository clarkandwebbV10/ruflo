'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const workflow = fs.readFileSync(path.join(__dirname,'../.github/workflows/rollback-manager.yml'),'utf8');
function script(name) {
 const lines=workflow.split(/\r?\n/), idx=lines.indexOf('      - name: '+name);
 assert.ok(idx>=0,'Missing step '+name);
 const pos=lines.slice(idx+1).findIndex(x=>x.trim()==='run: |');
 assert.ok(pos>=0 && pos<8,'Missing run step '+name);
 const block=[];
 for(let i=idx+pos+2;i<lines.length;i++){if(lines[i].trim()&&!lines[i].startsWith('          '))break;block.push(lines[i].startsWith('          ')?lines[i].slice(10):'')}
 return block.join('\n');
}
test('SEC-021 manual dispatch input is not directly interpolated into execution scripts',()=>{
 for(const name of ['Validate rollback target','Test rollback target viability','Execute rollback','Create rollback tag','Generate rollback report']){
  assert.ok(!script(name).includes('\x24{{ github.event.inputs.'),name);
 }
 assert.ok(script('Execute rollback').includes('ROLLBACK_REASON="\x24MC2_ROLLBACK_REASON"'));
 assert.ok(script('Execute rollback').includes('ROLLBACK_TARGET="\x24MC2_ROLLBACK_TARGET"'));
});
test('SEC-021 JSON and Markdown reporter safely handle shell characters in input',()=>{
 const s=script('Generate rollback report');
 assert.ok(s.includes('jq -Rs .'));
 assert.ok(s.includes('cat > rollback-reports/rollback-report.md << EOF'));
 assert.ok(!s.includes('rollback_reason ||'));
});
test('SEC-021 payload in dispatch reason stays inert in real rollback shell block',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'mc2-sec021-'));
 const git=(...args)=>{const r=spawnSync('git',args,{cwd:dir,encoding:'utf8'});assert.equal(r.status,0,r.stderr);return r.stdout.trim()};
 const output=path.join(dir,'out.txt'), sentinel=path.join(dir,'pwned'), reason='audit \x24(touch '+sentinel+') " ; echo injection';
 try{
 git('init','-q','-b','main');git('config','user.name','MC2 Test');git('config','user.email','ci@example.invalid');
 fs.writeFileSync(path.join(dir,'safe'),'baseline');git('add','-A');git('commit','-qm','baseline');
 const target=git('rev-parse','HEAD');fs.writeFileSync(path.join(dir,'later'),'later');git('add','-A');git('commit','-qm','newer');const latest=git('rev-parse','HEAD');
 const values={'github.actor':'CI','github.sha':latest,'github.ref_name':'main',"needs.failure-detection.outputs.rollback-session-id || 'manual'":'ci-session'};
 let run=script('Execute rollback').replace(/\x24{{\s*([^}]+)\s*}}/g,(_,key)=>{key=key.trim();assert.ok(Object.hasOwn(values,key),'Unexpected expression '+key);return values[key]});
 // Pass hostile text as a literal shell variable: no eval or command substitution.
 // POSIX-relative output avoids Windows Git Bash redirect-path translation.
 const shellQuote = value => "'" + value.replaceAll("'", "'\\''") + "'";
 const setup = [
  'export GITHUB_OUTPUT=./out.txt',
  'export MC2_ROLLBACK_TARGET=' + shellQuote(target),
  'export MC2_ROLLBACK_REASON=' + shellQuote(reason),
  'export MC2_ROLLBACK_SCOPE=application',
  'export MC2_EMERGENCY_MODE=false',
 ].join('\n');
 fs.writeFileSync(path.join(dir,'rollback-test.sh'),setup+'\n'+run,'utf8');
 const r=spawnSync('bash',['-e','./rollback-test.sh'],{cwd:dir,encoding:'utf8'});
 assert.equal(r.status,0,r.stderr+'\n'+r.stdout);
 assert.equal(fs.existsSync(sentinel),false,'Shell injection executed');
 assert.equal(git('rev-parse','HEAD^'),latest,'Must preserve ancestry');
 assert.ok(fs.readFileSync(path.join(dir,'ROLLBACK_INFO.md'),'utf8').includes(reason));
 }finally{fs.rmSync(dir,{recursive:true,force:true})}
});
