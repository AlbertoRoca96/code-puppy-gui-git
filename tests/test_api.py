from fastapi.testclient import TestClient

import backend.app as backend_app
from backend.app import app

client = TestClient(app)


def test_health_endpoint_exposes_limit():
    response = client.get('/api/health')
    assert response.status_code == 200
    payload = response.json()
    assert payload['status'] == 'ok'
    assert payload['messageLimit'] == 200


def test_empty_session_save_is_skipped():
    response = client.put('/api/session/test_empty_123', json={'messages': [], 'composer': ''})
    assert response.status_code == 200
    assert response.json()['status'] == 'skipped'


def test_cleanup_empty_sessions_local_route():
    response = client.post('/api/sessions/cleanup-empty')
    assert response.status_code == 200
    assert response.json()['status'] == 'cleaned'


def test_upload_content_missing_returns_404():
    response = client.get('/api/upload/does_not_exist/content')
    assert response.status_code == 404


def test_upload_metadata_missing_returns_404():
    response = client.get('/api/upload/does_not_exist')
    assert response.status_code == 404


def test_sessions_query_filters_by_message_content(tmp_path, monkeypatch):
    monkeypatch.setattr(backend_app, 'list_local_sessions', lambda limit, query='': [
        {
            'sessionId': 'sess_match',
            'title': 'Alpha',
            'updatedAt': 1,
            'messageCount': 2,
        }
    ] if query == 'alpha' else [])
    response = client.get('/api/sessions?query=alpha')
    assert response.status_code == 200
    assert response.json()['sessions'][0]['sessionId'] == 'sess_match'


def test_chat_stream_endpoint_streams_events(monkeypatch):
    async def fake_stream_chat(payload, user_id=None):
        yield {'event': 'delta', 'content': 'hello'}
        yield {'event': 'done', 'content': 'hello world', 'model': 'fake-model'}

    monkeypatch.setattr(backend_app, 'stream_chat', fake_stream_chat)
    response = client.post('/api/chat/stream', json={'messages': [{'role': 'user', 'content': 'hi'}]})
    assert response.status_code == 200
    body = response.text
    assert 'hello' in body
    assert 'fake-model' in body


def test_chat_endpoint_returns_provider_response(monkeypatch):
    async def fake_invoke_chat(payload, user_id=None):
        return {'message': 'web-search-ready', 'model': 'fake'}

    monkeypatch.setattr(backend_app, 'invoke_chat', fake_invoke_chat)
    response = client.post('/api/chat', json={'messages': [{'role': 'user', 'content': 'search this'}], 'webSearch': True})
    assert response.status_code == 200
    assert response.json()['message'] == 'web-search-ready'
