"""Auditoria de cada browser: falha fechada, diagnóstico e renders concorrentes."""
from concurrent.futures import ThreadPoolExecutor
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import threading
import time
from types import SimpleNamespace

import pytest

from horus_backend import production_worker as worker
from test_workflows import settings, TOKEN, client_for
from test_production import script_for, start, finished


def seed(root, *, suffix='', address='127.0.0.1:3000'):
    log = f'browser-netlog{suffix}.json'
    launch = {'browser_guard_applied':True, 'netlog_file':log, 'browser_closed':True}
    (root/f'browser-launch{suffix}.json').write_text(json.dumps(launch), encoding='utf-8')
    document = {'constants':{'logEventTypes':{'TCP_CONNECT_ATTEMPT':1}},
                'events':[{'type':1,'params':{'address':address}}]}
    (root/log).write_text(json.dumps(document), encoding='utf-8')
    return document


@pytest.mark.parametrize('failure', ['missing','incomplete','schema','unclosed_browser'])
def test_audit_failure_has_safe_specific_cause_and_never_summary(tmp_path, failure):
    seed(tmp_path, suffix='-test')
    path = tmp_path/'browser-netlog-test.json'
    if failure == 'missing':
        path.unlink()
    elif failure == 'incomplete':
        path.write_text('{"private":"Bearer PRIVATE_TEST_SECRET", "events":[{"type":')
    elif failure == 'schema':
        path.write_text('{}')
    else:
        (tmp_path/'browser-launch-test.json').write_text(json.dumps({'browser_guard_applied':True,'browser_closed':False}))
    with pytest.raises(worker.NetworkAuditError) as caught:
        worker.network_summary(tmp_path,set(),timeout=0)
    assert caught.value.detail['type'] in {'FileNotFoundError','JSONDecodeError','KeyError','ValueError'}
    text = json.dumps(caught.value.detail)
    assert 'PRIVATE_TEST_SECRET' not in text and str(tmp_path) not in text
    assert not (tmp_path/'network-summary.json').exists()


def test_audit_retries_sharing_violation_and_late_flush_without_discarding_event(tmp_path, monkeypatch):
    complete = seed(tmp_path)
    path = tmp_path/'browser-netlog.json'
    original = Path.read_text
    reads = []
    def read(current, *args, **kwargs):
        if current == path:
            reads.append(1)
            if len(reads) == 1:
                raise PermissionError(13,'PRIVATE_TEST_SECRET',str(path))
            if len(reads) == 2:
                return json.dumps(complete)[:-10]
        return original(current,*args,**kwargs)
    monkeypatch.setattr(Path,'read_text',read)
    worker.network_summary(tmp_path,set(),timeout=1)
    assert len(reads) == 3
    assert json.loads(original(tmp_path/'network-summary.json'))['netlog_complete'] is True


def test_browser_exit_is_confirmed_without_relying_on_node_callback(tmp_path):
    seed(tmp_path,suffix='-exit')
    child = subprocess.Popen([sys.executable,'-c','pass'])
    child.wait(timeout=10)
    assert worker.browser_has_exited(os.getpid()) is False
    manifest = tmp_path/'browser-launch-exit.json'
    launch = json.loads(manifest.read_text())
    launch.update(browser_closed=False,browser_pid=child.pid)
    manifest.write_text(json.dumps(launch))
    worker.network_summary(tmp_path,set(),timeout=0)
    report = json.loads((tmp_path/'network-summary.json').read_text())
    assert report['browsers'][0]['exit_confirmation'] == 'os_process_handle'


def test_complete_record_prefix_is_not_accepted_before_late_flush(tmp_path,monkeypatch):
    document = seed(tmp_path)
    prefix = json.dumps(document)[:-2]
    document['events'].append({'type':1,'params':{'address':'203.0.113.11:443'}})
    clock = SimpleNamespace(value=0.0)
    def advance(seconds):
        clock.value += seconds
    monkeypatch.setattr(worker,'time',SimpleNamespace(monotonic=lambda:clock.value,sleep=advance))
    original = Path.read_text
    def read(path,*args,**kwargs):
        if path.name == 'browser-netlog.json':
            return prefix if clock.value < .75 else json.dumps(document)
        return original(path,*args,**kwargs)
    monkeypatch.setattr(Path,'read_text',read)
    with pytest.raises(worker.NetworkAuditError,match='destino TCP externo'):
        worker.network_summary(tmp_path,set(),timeout=1)
    assert clock.value >= .75


def test_stable_log_suffix_uses_clock_after_slow_file_read(tmp_path,monkeypatch):
    document = seed(tmp_path)
    clock = SimpleNamespace(value=0.0,reads=0)
    def sleep(seconds):
        clock.value = 4.95
    monkeypatch.setattr(worker,'time',SimpleNamespace(monotonic=lambda:clock.value,sleep=sleep))
    original = Path.read_text
    def read(path,*args,**kwargs):
        clock.reads += 1
        if clock.reads == 2:
            clock.value = 5.05
        return json.dumps(document)[:-2]
    monkeypatch.setattr(Path,'read_text',read)
    value, complete = worker.read_audit_json(tmp_path/'browser-netlog.json',deadline=5,allow_unclosed_events=True)
    assert value == document and complete is False


def test_audit_checks_all_browsers_instead_of_last_writer(tmp_path):
    seed(tmp_path,suffix='-one')
    seed(tmp_path,suffix='-two',address='203.0.113.10:443')
    with pytest.raises(worker.NetworkAuditError,match='destino TCP externo'):
        worker.network_summary(tmp_path,set(),timeout=0)
    summary = json.loads((tmp_path/'network-summary.json').read_text())
    assert len(summary['browsers']) == 2 and summary['event_count'] == 2
    assert summary['external_tcp_destinations'] == ['203.0.113.10:443']


def test_browser_guard_creates_unique_logs_and_confirms_exit(tmp_path):
    node = shutil.which('node')
    if not node:
        pytest.skip('Node não preparado.')
    guard = tmp_path/'guard.cjs'
    guard.write_text(worker.NODE_GUARD,encoding='utf-8')
    script = r'''
const cp=require('node:child_process');
const {EventEmitter}=require('node:events');
const calls=[];
cp.spawn=(cmd,args)=>{calls.push(args);return new EventEmitter()};
require(process.argv[1]);
for(let i=0;i<2;i++)cp.spawn(process.env.HORUS_DEMO_BROWSER,[]).emit('exit',0);
if(calls[0].find(a=>a.startsWith('--log-net-log='))===calls[1].find(a=>a.startsWith('--log-net-log=')))throw new Error('shared log');
'''
    env = dict(os.environ, HORUS_DEMO_BROWSER=str(tmp_path/'fake-browser.exe'),
        HORUS_DEMO_NETLOG=str(tmp_path/'browser-netlog.json'),HORUS_DEMO_PROXY='127.0.0.1:12345')
    env.pop('NODE_OPTIONS',None)
    result = subprocess.run([node,'-e',script,str(guard)],env=env,capture_output=True,timeout=10)
    assert result.returncode == 0,result.stderr
    manifests = list(tmp_path.glob('browser-launch-*.json'))
    assert len(manifests) == 2
    values = [json.loads(p.read_text()) for p in manifests]
    assert all(v['browser_closed'] is True for v in values)
    assert len({v['netlog_file'] for v in values}) == 2


def test_audit_cause_reaches_job_result_and_event(settings,tmp_path,monkeypatch):
    from horus_backend.processes import OwnedProcess
    detail = {'code':'audit_file_unavailable','type':'FileNotFoundError','message':'NetLog indisponível (errno=2, winerror=None)'}
    message = 'Não foi possível validar a auditoria de rede: FileNotFoundError: '+detail['message']
    program = tmp_path/'failed-worker.py'
    program.write_text('import json,sys\nfrom pathlib import Path\np=Path.cwd()\n'
        +'(p/"result.json").write_text('+repr(json.dumps({'error':message,'audit_error':detail,'artifacts':[]}))+',encoding="utf-8")\nsys.exit(1)\n',encoding='utf-8')
    original = OwnedProcess.start
    async def run(command, **kwargs):
        return await original([sys.executable,str(program)],**kwargs)
    monkeypatch.setattr(OwnedProcess,'start',run)
    with client_for(settings) as client:
        item = finished(client,start(client,script_for(client)).json())
        assert item['status'] == 'failed' and 'FileNotFoundError' in item['error']
        job = client.app.state.store.get_job(item['job_id'])
        assert job['result']['audit_error'] == detail
        events = client.app.state.store.events(item['job_id'],0)
        assert any(e['kind']=='error' and 'errno=2' in e['message'] for e in events)


@pytest.mark.skipif(not os.environ.get('HORUS_PILOT_FACTORY'),reason='Renders reais exigem fábrica explícita.')
def test_real_concurrent_render_audits_are_isolated(tmp_path):
    from horus_backend.config import Settings
    from test_scripts import approved, decide
    from test_scripts_manual import manual, doc
    barrier = threading.Barrier(2)
    def render(index):
        config = Settings(token=TOKEN,data_dir=tmp_path/str(index), factory_root=Path(os.environ['HORUS_PILOT_FACTORY']),
            hermes_executable=None,hermes_config=tmp_path/'unused.json',workflow_executor='simulated')
        with client_for(config) as client:
            script = manual(client,approved(client),doc()).json()
            assert decide(client,script).status_code == 200
            barrier.wait(timeout=15)
            response = start(client,script,mode='local_demo')
            assert response.status_code == 201,response.text
            pid = response.json()['id']
            deadline = time.monotonic()+300
            while time.monotonic()<deadline:
                item = client.get('/v1/productions/'+pid).json()
                if item['status'] not in {'queued','running','cancel_requested'}:
                    break
                time.sleep(.1)
            assert item['status'] == 'succeeded',item
            root = config.data_dir/'productions'/pid
            summary = json.loads((root/'network-summary.json').read_text())
            validation = json.loads((root/'canais/demo/videos/fixture/render/validation.json').read_text())
            assert summary['external_tcp_destinations'] == []
            assert any(a.endswith(':'+str(validation['render_port'])) for a in summary['tcp_destinations'])
            assert summary['browsers'] and all(b['exit_confirmation'] in {'node_exit_event','os_process_handle'} for b in summary['browsers'])
            return {'root':str(root),'port':validation['render_port'],'summary':summary}
    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(render,range(2)))
    assert results[0]['port'] != results[1]['port']
    assert results[0]['summary']['external_proxy'] != results[1]['summary']['external_proxy']
    assert set(b['netlog_file'] for b in results[0]['summary']['browsers']).isdisjoint(b['netlog_file'] for b in results[1]['summary']['browsers'])
    (tmp_path/'concurrent-audit-report.json').write_text(json.dumps(results,indent=2),encoding='utf-8')
    print('CONCURRENT_AUDIT_REPORT='+str(tmp_path/'concurrent-audit-report.json'))
