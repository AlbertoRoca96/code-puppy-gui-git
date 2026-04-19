from backend.session_service import (
    cleanup_empty_local_sessions,
    derive_title,
    list_local_sessions,
    snapshot_is_meaningful,
)


def test_snapshot_is_meaningful_false_for_blank_session():
    assert snapshot_is_meaningful({'messages': [], 'composer': ''}) is False


def test_snapshot_is_meaningful_true_for_user_message():
    assert snapshot_is_meaningful({'messages': [{'role': 'user', 'content': 'hello'}]}) is True


def test_derive_title_uses_first_user_message():
    payload = {
        'messages': [
            {'role': 'assistant', 'content': 'x'},
            {'role': 'user', 'content': 'Build me a parser please'},
        ]
    }
    assert derive_title(payload) == 'Build me a parser please'
