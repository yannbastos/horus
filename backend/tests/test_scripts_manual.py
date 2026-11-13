"""Roteiro escrito pelo usuário (HOR-133): sem IA, mesmo contrato, revisão e produção."""
import copy
import sqlite3
from concurrent.futures import ThreadPoolExecutor

import pytest

from test_workflows import settings, client_for
from test_scripts import approved, generate, decide
from test_production import start, finished, isolated_production_environment  # noqa: F401


def doc(**override):
    value = {"title": "Meu primeiro vídeo", "sections": [
        {"id": "hook", "kind": "hook", "heading": "Gancho", "narration": "Você sabia que isso muda tudo?"},
        {"id": "body", "kind": "body", "heading": "Meio", "narration": "Texto que eu mesmo escrevi."},
        {"id": "end", "kind": "conclusion", "heading": "Fim", "narration": "Obrigado por assistir."}]}
    return {**value, **override}


def manual(client, workflow, document=None, key="manual", **extra):
    return client.post(f"/v1/workflows/{workflow['id']}/scripts", headers={"Idempotency-Key": key}, json={
        "source": "manual", "expected_revision": workflow["revision"],
        "proposal_artifact_id": workflow["current_artifact_id"], "document": document or doc(), **extra})


def version(client, script, document=None, key="v", expected=None, **extra):
    return client.post(f"/v1/scripts/{script['id']}/versions", headers={"Idempotency-Key": key},
                       json={"expected_version": expected or script["version"], "document": document or doc(), **extra})


def test_first_manual_script_then_human_versions_history_and_restart(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        jobs = client.get("/v1/jobs").json()
        first = manual(client, workflow)
        assert first.status_code == 201, first.text
        first = first.json()
        assert (first["origin"], first["authored_by"], first["version"], first["status"]) == ("human", "human", 1, "awaiting_review")
        assert first["review"] is None and first["document"]["title"] == "Meu primeiro vídeo"
        assert manual(client, workflow).json() == first and manual(client, workflow).status_code == 200
        assert manual(client, workflow, key="again").status_code == 409  # já há roteiro em revisão
        edited = doc(title="Título editado")
        edited["sections"][1]["narration"] = "Narração revisada por mim."
        edited["sections"].insert(2, {"id": "extra", "kind": "body", "heading": "Extra", "narration": "Mais um trecho."})
        second = version(client, first, edited, key="v2")
        assert second.status_code == 201, second.text
        second = second.json()
        assert (second["version"], second["origin"], second["status"]) == (2, "human", "awaiting_review")
        assert second["id"] != first["id"] and second["review"] is None
        replay = version(client, first, edited, key="v2")
        assert replay.status_code == 200 and replay.json() == second
        assert client.get("/v1/jobs").json() == jobs  # nenhum job, nada enviado a executor
        items = client.get(f"/v1/workflows/{workflow['id']}/scripts").json()["items"]
        assert [item["version"] for item in items] == [2, 1] and items[1]["changes"] is None
        assert items[0]["changes"] == {"previous_version": 1, "title_changed": True, "sections_added": ["extra"],
            "sections_removed": [], "sections_changed": [{"id": "body", "fields": ["narration"]}], "order_changed": False}
        assert "Narração revisada" not in str(items[0]["changes"])
        events = client.get(f"/v1/workflows/{workflow['id']}").json()
    with client_for(settings) as client:
        assert client.get(f"/v1/scripts/{second['id']}").json() == second
        assert client.get(f"/v1/scripts/{first['id']}").json() == first
        assert version(client, first, edited, key="v2").json() == second
        assert client.get(f"/v1/workflows/{workflow['id']}/scripts").json()["items"][0]["changes"]["sections_added"] == ["extra"]
    assert events


def test_simulated_origin_is_preserved_and_human_version_follows_changes_requested(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        simulated = generate(client, workflow).json()
        assert (simulated["origin"], simulated["authored_by"]) == ("simulated", "simulated")
        human = version(client, simulated, key="edit")
        assert human.status_code == 201 and human.json()["origin"] == "human"
        # A versão simulada ficou obsoleta: só a mais recente pode ser revisada ou editada.
        assert decide(client, simulated).status_code == 409
        assert version(client, simulated, key="stale").status_code == 409
        human = human.json()
        assert decide(client, human, "request_changes", feedback="Mais emoção").status_code == 200
        third = version(client, human, key="v3")
        assert third.status_code == 201 and third.json()["version"] == 3


def test_version_conflicts_and_final_states(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        first = manual(client, workflow).json()
        assert version(client, first, expected=2, key="wrong").status_code == 409
        assert version(client, first, key="same-key", document=doc(title="A")).status_code == 201
        assert version(client, first, key="same-key", document=doc(title="B")).status_code == 409  # chave com outro corpo
        assert version(client, first, key="late").status_code == 409  # v1 não é mais a última
        assert client.post("/v1/scripts/" + "0" * 32 + "/versions", headers={"Idempotency-Key": "x"},
                           json={"expected_version": 1, "document": doc()}).status_code == 404
        approved_script = decide(client, client.get(f"/v1/workflows/{workflow['id']}/scripts").json()["items"][0]).json()
        assert approved_script["status"] == "approved"
        assert version(client, approved_script, key="after-approve").status_code == 409
        assert manual(client, workflow, key="after").status_code == 409


def test_manual_requires_approved_current_proposal(settings):
    with client_for(settings) as client:
        workflow = wait_unapproved(client)
        denied = manual(client, workflow)
        assert denied.status_code == 409
        workflow = approved(client)
        stale = {**workflow, "revision": workflow["revision"] + 1}
        assert manual(client, stale, key="stale").status_code == 409
        wrong = {**workflow, "current_artifact_id": "a" * 32}
        assert manual(client, wrong, key="wrong").status_code == 409


def wait_unapproved(client):
    from test_workflows import create, wait
    return wait(client, create(client)["id"])


def mutate(path, value):
    document = doc()
    target = document
    for step in path[:-1]:
        target = target[step]
    if value is DELETE:
        del target[path[-1]]
    else:
        target[path[-1]] = value
    return document


DELETE = object()


@pytest.mark.parametrize("document", [
    mutate(["sections", 1, "narration"], ""),                 # seção vazia
    mutate(["sections", 1, "narration"], "   "),
    mutate(["sections", 1, "narration"], "x" * 8001),         # tamanho por seção
    mutate(["title"], "t" * 201),
    mutate(["title"], ""),
    mutate(["sections", 1, "heading"], ""),
    mutate(["sections", 1, "segredo"], "extra"),              # campo extra na seção
    mutate(["extra"], 1),                                     # campo extra no documento
    mutate(["sections", 1, "visual_summary"], "resumo"),      # campo fora do contrato
    mutate(["sections"], doc()["sections"][:2]),              # menos de 3 seções
    mutate(["sections"], [doc()["sections"][0]] * 3),         # ids repetidos / sem conclusão
    mutate(["sections", 2, "kind"], "body"),                  # sem conclusão
    mutate(["sections", 0, "source_ids"], ["inventada"]),     # fonte fora do snapshot
    mutate(["sections", 0, "source_ids"], "x"),
    mutate(["schema_version"], 2),
    mutate(["simulated"], False),
    mutate(["sections", 1, "narration"], 5),                  # sem coerção
    {"title": "sem seções"},
    {"sections": doc()["sections"]},                          # sem título
    mutate(["sections"], doc()["sections"][:1] + [{"id": f"b{i}", "kind": "body", "heading": "h", "narration": "n"} for i in range(31)]
           + doc()["sections"][2:]),                          # seções demais
    mutate(["sections"], [doc()["sections"][0]] + [
        {"id": f"b{i}", "kind": "body", "heading": "h", "narration": "n" * 8000} for i in range(8)] + [doc()["sections"][2]]),
])
def test_invalid_documents_are_rejected_without_leaking(settings, document):
    secret = "SEGREDO-NAO-VAZAR"
    document = copy.deepcopy(document)
    try:
        document["sections"][0]["heading"] = secret  # texto privado que não pode voltar no erro
    except (KeyError, IndexError, TypeError):
        pass
    with client_for(settings) as client:
        workflow = approved(client)
        denied = manual(client, workflow, document)
        assert denied.status_code == 422 and secret not in denied.text
        first = manual(client, workflow, key="ok").json()
        denied = version(client, first, document, key="bad")
        assert denied.status_code == 422 and secret not in denied.text
        assert client.get(f"/v1/workflows/{workflow['id']}/scripts").json()["items"] == [{**first, "changes": None}]


def test_invalid_body_shapes(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        first = manual(client, workflow).json()
        route = f"/v1/scripts/{first['id']}/versions"
        for body in ({"document": doc()}, {"expected_version": 1}, {"expected_version": True, "document": doc()},
                     {"expected_version": 1, "document": doc(), "origin": "simulated"},
                     {"expected_version": 1, "document": "texto"}, {"expected_version": 1, "document": [1]}):
            response = client.post(route, headers={"Idempotency-Key": "k"}, json=body)
            assert response.status_code == 422, body
        assert client.post(route, json={"expected_version": 1, "document": doc()}).status_code == 422  # sem Idempotency-Key
        assert client.post(route, headers={"Idempotency-Key": "k" * 129}, json={"expected_version": 1, "document": doc()}).status_code == 422
        assert client.post(route, headers={"Authorization": "", "Idempotency-Key": "k"},
                           json={"expected_version": 1, "document": doc()}).status_code == 401
        # origem não pode ser escolhida pelo cliente em manual
        bad = client.post(f"/v1/workflows/{workflow['id']}/scripts", headers={"Idempotency-Key": "m"},
                          json={"source": "simulated", "expected_revision": 1, "proposal_artifact_id": "a" * 32, "document": doc()})
        assert bad.status_code == 422


def test_competing_versions_have_one_winner(settings):
    with client_for(settings) as client:
        first = manual(client, approved(client)).json()
        with ThreadPoolExecutor(4) as pool:
            results = list(pool.map(lambda n: version(client, first, doc(title=f"T{n}"), key=f"k{n}").status_code, range(4)))
        assert sorted(results) == [201, 409, 409, 409]
        assert [i["version"] for i in client.get(f"/v1/workflows/{first['workflow_id']}/scripts").json()["items"]] == [2, 1]


def test_human_script_approval_and_simulated_production(settings):
    with client_for(settings) as client:
        workflow = approved(client)
        first = manual(client, workflow).json()
        script = version(client, first, doc(title="Versão final"), key="final").json()
        assert start(client, script).status_code == 409  # sem aprovação humana não há produção
        approved_script = decide(client, script)
        assert approved_script.status_code == 200
        approved_script = approved_script.json()
        assert approved_script["origin"] == "human" and approved_script["review"]["decision"] == "approve"
        response = start(client, approved_script)
        assert response.status_code == 201, response.text
        item = finished(client, response.json())
        assert item["status"] == "succeeded", item
        assert item["demo_only"] and not item["real_voice"]
        assert item["script_version"] == 2
        assert start(client, approved_script).json()["id"] == item["id"]
    with client_for(settings) as client:
        assert client.get(f"/v1/scripts/{script['id']}").json()["origin"] == "human"
        assert client.get("/v1/productions/" + item["id"]).json() == item


def test_migration_v9_marks_existing_scripts_as_simulated(settings, monkeypatch):
    from horus_backend.migrations import migrate
    with monkeypatch.context() as old:
        old.setattr("horus_backend.migrations.SCHEMA_VERSION", 8)
        with client_for(settings) as client:
            workflow = approved(client)
            # O esquema v8 não tem a coluna; a geração simulada não pode ser exercitada com o código atual.
            path = client.app.state.store.path
            with sqlite3.connect(path) as db:
                assert "origin" not in [row[1] for row in db.execute("PRAGMA table_info(scripts)")]
                db.execute("""INSERT INTO scripts VALUES('s1',?,?,?,'h',1,'awaiting_review','{}','2026-01-01T00:00:00Z',NULL)""",
                           (workflow["id"], workflow["revision"], workflow["current_artifact_id"]))
    migrate(path)
    migrate(path)
    with sqlite3.connect(path) as db:
        assert db.execute("PRAGMA user_version").fetchone()[0] == 9
        assert db.execute("SELECT origin FROM scripts").fetchall() == [("simulated",)]
        with pytest.raises(sqlite3.IntegrityError):
            db.execute("UPDATE scripts SET origin='ai'")
    assert len(list(path.parent.glob("horus.backup-v8-*.sqlite3"))) == 1
