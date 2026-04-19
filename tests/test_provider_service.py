import asyncio

from fastapi import HTTPException

from backend import provider_service
from backend.models import AttachmentRef, ChatRequest


async def _no_attachments(*args, **kwargs):
    return []


async def _no_url_context(urls):
    return ''


async def _no_web_search(query):
    return ''


def test_append_multimodal_images_adds_image_blocks_for_openai_vision():
    messages = [{'role': 'user', 'content': 'describe this'}]
    records = [
        {
            'is_image': True,
            'metadata': {'url': 'https://example.com/cat.png'},
            'item': type('Item', (), {'url': None})(),
        }
    ]
    updated = provider_service.append_multimodal_images(
        messages, records, True, 'gpt-4.1-mini'
    )
    assert isinstance(updated[0]['content'], list)
    assert updated[0]['content'][1]['type'] == 'image_url'


def test_build_chat_request_includes_web_search_and_url_context(monkeypatch):
    monkeypatch.setattr(provider_service, 'resolve_attachment_records', _no_attachments)
    monkeypatch.setattr(
        provider_service, 'build_attachment_context_from_records', lambda records: ''
    )
    monkeypatch.setattr(
        provider_service, 'fetch_url_context', lambda urls: _resolved('URL CONTEXT')
    )
    monkeypatch.setattr(
        provider_service,
        'perform_web_search',
        lambda query: _resolved('SEARCH CONTEXT'),
    )
    monkeypatch.setenv('SYN_API_KEY', 'test-key')
    monkeypatch.setenv('SYN_CHAT_URL', 'https://example.com/chat')

    payload = ChatRequest(
        messages=[
            {'role': 'user', 'content': 'check https://example.com and search llamas'}
        ],
        webSearch=True,
    )
    _, forwarded_model, _, body = asyncio.run(
        provider_service.build_chat_request(payload, None)
    )
    assert forwarded_model == 'hf:zai-org/GLM-4.7'
    system_messages = [m['content'] for m in body['messages'] if m['role'] == 'system']
    assert any('URL CONTEXT' in message for message in system_messages)
    assert any('SEARCH CONTEXT' in message for message in system_messages)


def test_build_chat_request_rejects_image_for_non_vision_model(monkeypatch):
    async def fake_attachments(*args, **kwargs):
        return [
            {
                'is_image': True,
                'metadata': {'url': 'https://example.com/cat.png'},
                'item': type('Item', (), {'url': 'https://example.com/cat.png'})(),
            }
        ]

    monkeypatch.setattr(provider_service, 'resolve_attachment_records', fake_attachments)
    monkeypatch.setattr(
        provider_service, 'build_attachment_context_from_records', lambda records: ''
    )
    monkeypatch.setattr(provider_service, 'fetch_url_context', _no_url_context)
    monkeypatch.setattr(provider_service, 'perform_web_search', _no_web_search)
    monkeypatch.setenv('SYN_API_KEY', 'test-key')

    payload = ChatRequest(
        messages=[{'role': 'user', 'content': 'look at this'}],
        model='hf:zai-org/GLM-4.7',
        attachments=[AttachmentRef(id='1', name='cat.png', kind='image')],
    )
    try:
        asyncio.run(provider_service.build_chat_request(payload, None))
        assert False, 'Expected HTTPException for non-vision model'
    except HTTPException as exc:
        assert exc.status_code == 400


def _resolved(value):
    async def _inner(*args, **kwargs):
        return value

    return _inner()
