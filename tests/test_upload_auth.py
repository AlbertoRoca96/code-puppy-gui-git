import asyncio

import pytest
from fastapi import HTTPException

from backend import upload_service


@pytest.mark.parametrize(
    ('metadata', 'user_id', 'should_raise'),
    [
        ({'uploadId': 'abc', 'userId': 'owner-1'}, 'owner-1', False),
        ({'uploadId': 'abc', 'userId': 'owner-1'}, 'owner-2', True),
        ({'uploadId': 'abc', 'userId': None}, None, False),
    ],
)
def test_get_upload_enforces_ownership(monkeypatch, metadata, user_id, should_raise):
    async def fake_load_upload_metadata_async(upload_id: str, requested_user_id: str | None = None):
        return metadata

    monkeypatch.setattr(upload_service, 'load_upload_metadata_async', fake_load_upload_metadata_async)

    if should_raise:
        with pytest.raises(HTTPException) as exc:
            asyncio.run(upload_service.get_upload('abc', user_id))
        assert exc.value.status_code == 404
    else:
        payload = asyncio.run(upload_service.get_upload('abc', user_id))
        assert payload == metadata
