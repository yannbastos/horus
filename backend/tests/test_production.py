import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import replace
import json
from pathlib import Path
import pytest

from test_workflows import settings, client_for
from test_scripts import approved, generate, decide
from horus_backend.production import confined, inspect_artifact
from horus_backend.workflows import WorkflowConflict


def script_for(client):
    script = generate(client, approved(client)).json()
    assert decide(client, script).status_code == 200
    return script


def start(client, script, key='production', mode='simulated', **extra):
    return client.post(f"/v1/scripts/{script['id']}/productions", headers={'Idempotency-Key': key},
        json={'expected_version': script['version'], 'mode': mode, **extra})


def finished(client, production):
    for _ in range(200):
        item = client.get('/v1/productions/' + production['id']).json()
        if item['status'] not in {'queued', 'running', 'cancel_requested'}:
            return item
        time.sleep(.025)
    pytest.fail(str(item))


def test_simulated_artifacts_idempotency_and_restart(settings):
    with client_for(settings) as client:
        script = script_for(client)
        response = start(client, script)
        assert response.status_code == 201, response.text
        item = finished(client, response.json())
        assert item['status'] == 'succeeded', item
        assert item['stage'] == 'review' and item['review'] is None
        assert item['demo_only'] and not item['real_voice'] and not item['speech_aligned']
        assert {a['kind'] for a in item['artifacts']} == {'plan', 'scene', 'audio', 'subtitles', 'manifest'}
        replay = start(client, script)
        assert replay.status_code == 200 and replay.json()['id'] == item['id']
        assert start(client, script, mode='local_demo').status_code == 409
        for a in item['artifacts']:
            route = f"/v1/productions/{item['id']}/artifacts/{a['id']}"
            content = client.get(route)
            assert content.status_code == 200 and len(content.content) == a['size_bytes']
            assert client.get(route, headers={'Authorization': ''}).status_code == 401
        review = client.post(f"/v1/productions/{item['id']}/review", json={'decision':'approve', 'artifact_sha256':'a'*64}, headers={'Idempotency-Key':'review'})
        assert review.status_code == 409
        assert client.post(f"/v1/jobs/{item['job_id']}/retry").status_code == 409
    with client_for(settings) as client:
        assert client.get('/v1/productions/'+item['id']).json() == item
        assert client.get(f"/v1/scripts/{script['id']}/productions").json()['items'] == [item]


def test_human_approval_latest_and_strict_payload(settings):
    with client_for(settings) as client:
        script = generate(client, approved(client)).json()
        assert start(client, script).status_code == 409
        assert start(client, script, expected_version=True).status_code == 422
        assert start(client, script, executable='evil').status_code == 422
        assert decide(client, script).status_code == 200
        assert start(client, script, expected_version=2).status_code == 409
        with client.app.state.store.connect() as db:
            db.execute('UPDATE scripts SET review=NULL WHERE id=?',(script['id'],))
        assert start(client, script).status_code == 409
        assert client.get('/v1/jobs').json()[-1]['payload']['operation'] != 'production.run'


def test_concurrent_submission_is_one_job(settings):
    with client_for(settings) as client:
        script = script_for(client)
        with ThreadPoolExecutor(max_workers=4) as pool:
            responses = list(pool.map(lambda _: start(client, script), range(4)))
        assert sorted(r.status_code for r in responses) == [200,200,200,201]
        assert len({r.json()['id'] for r in responses}) == 1
        assert len([j for j in client.get('/v1/jobs').json() if j['payload']['operation'] == 'production.run']) == 1
        assert finished(client, responses[0].json())['status'] == 'succeeded'


def test_real_demo_missing_dependencies_is_blocked(settings):
    with client_for(settings) as client:
        script = script_for(client)
        item = finished(client, start(client, script, mode='local_demo').json())
        assert item['status'] == 'blocked' and 'Prepare separadamente' in item['error']
        assert 'Python' in item['error'] and not any(a['kind']=='video' for a in item['artifacts'])
        assert item['artifacts']


def test_artifact_tampering_and_confinement(settings, tmp_path):
    with client_for(settings) as client:
        item = finished(client, start(client, script_for(client)).json())
        a = item['artifacts'][0]
        path = settings.data_dir / 'productions' / item['id'] / a['relative_path']
        path.write_text('{}')
        assert client.get(f"/v1/productions/{item['id']}/artifacts/{a['id']}").status_code == 409
        assert client.get(f"/v1/productions/{item['id']}/artifacts/unknown").status_code == 404
    for relative in ('../escape', '/absolute', 'C:/absolute', 'folder/../plan.json', 'folder\\plan.json'):
        with pytest.raises(WorkflowConflict): confined(tmp_path, relative)
    (tmp_path/'invalid.png').write_text('not image')
    with pytest.raises(WorkflowConflict): inspect_artifact(tmp_path, 'invalid.png','scene')


def test_queued_cancellation_and_restart_interrupted(settings):
    with client_for(settings) as client:
        script = script_for(client)
        # Suspende apenas o worker deste teste para controlar o estado queued.
        import asyncio
        client.portal.call(client.app.state.manager.worker.cancel)
        item = start(client, script).json()
        cancelled = client.post(f"/v1/jobs/{item['job_id']}/cancel").json()
        assert cancelled['status'] == 'cancelled'
        assert client.get('/v1/productions/'+item['id']).json()['status'] == 'cancelled'
        other = start(client, script, key='second').json()
        client.app.state.store.update(other['job_id'],'running',new_attempt=True,result={'stage':'render'})
    with client_for(settings) as client:
        restored = client.get('/v1/productions/'+other['id']).json()
        assert restored['status'] == 'interrupted' and restored['stage'] == 'render'
        assert client.post(f"/v1/jobs/{other['job_id']}/retry").status_code == 409


def test_approval_snapshot_hash_is_required(settings):
    with client_for(settings) as client:
        script = script_for(client)
        with client.app.state.store.connect() as db:
            document = json.loads(db.execute('SELECT document FROM scripts WHERE id=?',(script['id'],)).fetchone()[0])
            document['title'] = 'Alterado depois da aprovação'
            db.execute('UPDATE scripts SET document=? WHERE id=?',(json.dumps(document),script['id']))
        assert start(client, script).status_code == 409


@pytest.mark.parametrize('mode', ['simulated','local_pilot'])
def test_running_cancel_owns_tree_and_sanitizes_logs(settings, tmp_path, monkeypatch, mode):
    import sys
    from horus_backend.processes import OwnedProcess
    marker = tmp_path / 'heartbeat.txt'
    child = tmp_path / 'child.py'
    child.write_text('import time\nfrom pathlib import Path\np=Path('+repr(str(marker))+')\nwhile True:\n p.write_text(str(time.time_ns()))\n time.sleep(.02)\n')
    parent = tmp_path / 'parent.py'
    parent.write_text('import subprocess,sys,time\nsubprocess.Popen([sys.executable,'+repr(str(child))+'])\nprint("Bearer SECRET_PRODUCTION_TEST",flush=True)\ntime.sleep(60)\n')
    original = OwnedProcess.start
    captured = []
    async def start_test(command, **kwargs):
        assert 'HORUS_API_TOKEN' not in kwargs['env']
        process = await original([sys.executable,str(parent)], **kwargs)
        captured.append(process)
        return process
    monkeypatch.setattr(OwnedProcess, 'start', start_test)
    with client_for(settings) as client:
        script = script_for(client)
        item = start(client, script, mode=mode).json()
        for _ in range(100):
            if marker.exists(): break
            time.sleep(.02)
        assert marker.exists()
        response = client.post(f"/v1/jobs/{item['job_id']}/cancel")
        assert response.status_code == 200
        final = finished(client,item)
        assert final['status'] == 'cancelled'
        assert captured[0].process.returncode is not None
        last = marker.read_text()
        time.sleep(.2)
        assert marker.read_text() == last
        events = client.get(f"/v1/jobs/{item['job_id']}/events").text
        assert 'SECRET_PRODUCTION_TEST' not in events


def test_queued_snapshot_is_rechecked_before_execution(settings):
    with client_for(settings) as client:
        script = script_for(client)
        client.portal.call(client.app.state.manager.worker.cancel)
        item = start(client, script).json()
        with client.app.state.store.connect() as db:
            db.execute('DELETE FROM script_receipts WHERE scope=?',(f"review:{script['id']}",))
    with client_for(settings) as client:
        result = finished(client,item)
        assert result['status'] == 'blocked'
        assert not (settings.data_dir/'productions'/item['id']).exists()


def test_artifact_links_are_rejected(tmp_path):
    from horus_backend.production import confined
    root=tmp_path/'root'
    root.mkdir()
    target=tmp_path/'outside.json'
    target.write_text('{}')
    try:
        (root/'link.json').symlink_to(target)
    except OSError:
        pytest.skip('Criação de symlink indisponível para esta conta.')
    with pytest.raises(WorkflowConflict): confined(root,'link.json')


def test_review_hash_and_idempotency_on_registered_real_fixture(settings, tmp_path):
    # Fixture MP4 H264 real de dois frames, criada localmente pelo codec da fábrica se preparado.
    import os
    video=Path(os.environ.get('HORUS_TEST_REAL_VIDEO', 'missing-video'))
    if not video.is_file():
        pytest.skip('Vídeo real de demo não preparado; nenhum download no teste.')
    with client_for(settings) as client:
        script=script_for(client)
        client.portal.call(client.app.state.manager.worker.cancel)
        item=start(client,script,mode='local_demo').json()
        root=settings.data_dir/'productions'/item['id']
        root.mkdir(parents=True)
        (root/'video.mp4').write_bytes(video.read_bytes())
        a=inspect_artifact(root,'video.mp4','video')
        with client.app.state.store.connect() as db:
            db.execute('UPDATE productions SET artifacts=? WHERE id=?',(json.dumps([a]),item['id']))
        client.app.state.store.update(item['job_id'],'succeeded',result={'stage':'review'})
        route=f"/v1/productions/{item['id']}/review"
        request={'decision':'reject','artifact_sha256':a['sha256']}
        headers={'Idempotency-Key':'human-request-fixture'}
        assert client.post(route,json=request|{'artifact_sha256':'0'*64},headers=headers).status_code==409
        response=client.post(route,json=request,headers=headers)
        assert response.status_code==200 and response.json()['review']['decision']=='reject'
        assert client.post(route,json=request,headers=headers).json()==response.json()
        assert client.post(route,json=request|{'decision':'approve'},headers=headers).status_code==409
        assert client.post(route,json=request,headers={'Idempotency-Key':'new'}).status_code==409
        (root/'video.mp4').write_bytes(b'corrupted')
        assert client.get(f"/v1/productions/{item['id']}/artifacts/{a['id']}").status_code==409


def test_network_audit_counts_end_events_without_inventing_destinations(tmp_path):
    import runpy
    module=runpy.run_path(str(Path(__file__).parents[1]/'src/horus_backend/production_worker.py'))
    (tmp_path/'browser-launch.json').write_text(json.dumps({'browser_guard_applied':True}))
    netlog={'constants':{'logEventTypes':{'TCP_CONNECT_ATTEMPT':1}},'events':[
        {'type':1,'params':{'address':'127.0.0.1:3000'}}, {'type':1,'params':{'os_error':10061}}]}
    (tmp_path/'browser-netlog.json').write_text(json.dumps(netlog))
    module['network_summary'](tmp_path,{'blocked.example.invalid'})
    summary=json.loads((tmp_path/'network-summary.json').read_text())
    assert summary['external_tcp_destinations']==[] and summary['netlog_complete']
    assert summary['proxy_denied_hosts']==['blocked.example.invalid']
    (tmp_path/'browser-netlog.json').write_text(json.dumps(netlog)[:-2])
    module['network_summary'](tmp_path,set())
    assert json.loads((tmp_path/'network-summary.json').read_text())['netlog_complete'] is False
    netlog['events'].append({'type':1,'params':{'address':'203.0.113.1:443'}})
    (tmp_path/'browser-netlog.json').write_text(json.dumps(netlog))
    with pytest.raises(ValueError): module['network_summary'](tmp_path,set())


def test_node_guard_denies_external_before_connect(tmp_path):
    import os, runpy, shutil, subprocess
    node=shutil.which('node')
    if not node: pytest.skip('Node local não preparado.')
    module=runpy.run_path(str(Path(__file__).parents[1]/'src/horus_backend/production_worker.py'))
    guard=tmp_path/'guard.cjs'
    guard.write_text(module['NODE_GUARD'])
    # Mesmo se o guard regredir, o método original é um stub: nenhum pacote sai.
    matrix = r"""
const net=require('node:net');
let originalCalls=0;
net.Socket.prototype.connect=function(){originalCalls++;return this};
require(process.argv[1]);
const forms=[
  h=>net.connect({host:h,port:443}),
  h=>net.createConnection({host:h,port:443}),
  h=>new net.Socket().connect({host:h,port:443}),
  h=>net.connect(443,h), h=>net.createConnection(443,h), h=>new net.Socket().connect(443,h),
  h=>net.connect('443',h), h=>net.createConnection('443',h), h=>new net.Socket().connect('443',h),
  h=>new net.Socket().connect([{host:h,port:443},()=>{}]),
];
for(const host of ['203.0.113.1','2001:db8::1']){
  for(let i=0;i<forms.length;i++){
    const before=originalCalls;
    let denied=false;
    try{forms[i](host)}catch(e){denied=e.message.includes('External Node network denied')}
    if(!denied || originalCalls!==before)throw new Error('External bypass form '+i);
  }
}
for(const host of ['localhost','127.0.0.1','::1']){
  for(let i=0;i<forms.length;i++){
    const before=originalCalls;
    const socket=forms[i](host);
    if(originalCalls!==before+1)throw new Error('Loopback blocked form '+i);
    socket.destroy();
  }
}
console.log('20 external forms denied; 30 loopback forms allowed via stub');
"""
    response=subprocess.run([node,'-e',matrix,str(guard)],
        env={k:v for k,v in os.environ.items() if k.upper() not in {'NODE_OPTIONS','HORUS_API_TOKEN'}},capture_output=True)
    assert response.returncode==0, response.stderr.decode('utf-8',errors='replace')


def test_deny_proxy_is_local_and_closes_its_listener():
    import http.client, runpy, socket
    module=runpy.run_path(str(Path(__file__).parents[1]/'src/horus_backend/production_worker.py'))
    server, thread, rejected=module['deny_proxy']()
    port=server.server_port
    try:
        client=http.client.HTTPConnection('127.0.0.1',port,timeout=2)
        client.request('CONNECT','blocked.example.invalid:443')
        assert client.getresponse().status==403
        client.close()
        assert rejected=={'blocked.example.invalid'}
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=2)
    assert not thread.is_alive()
    with socket.socket() as connection:
        assert connection.connect_ex(('127.0.0.1',port))!=0


def test_v5_to_v6_preserves_approved_scripts(settings, monkeypatch):
    import sqlite3
    from horus_backend.migrations import SCHEMA_VERSION
    with monkeypatch.context() as old:
        old.setattr('horus_backend.migrations.SCHEMA_VERSION',5)
        with client_for(settings) as client:
            script=script_for(client)
            before=client.get('/v1/scripts/'+script['id']).json()
            jobs=client.get('/v1/jobs').json()
    with client_for(settings) as client:
        assert client.get('/v1/scripts/'+script['id']).json()==before
        assert client.get('/v1/jobs').json()==jobs
        assert client.get(f"/v1/scripts/{script['id']}/productions").json()=={'items':[]}
        item=finished(client,start(client,script).json())
        assert item['status']=='succeeded'
    backups=list(settings.data_dir.glob('horus.backup-v5-*.sqlite3'))
    assert len(backups)==1
    with sqlite3.connect(backups[0]) as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==5
        assert db.execute('SELECT status FROM scripts WHERE id=?',(script['id'],)).fetchone()[0]=='approved'
    with sqlite3.connect(settings.data_dir/'horus.sqlite3') as db:
        assert db.execute('PRAGMA user_version').fetchone()[0]==SCHEMA_VERSION
