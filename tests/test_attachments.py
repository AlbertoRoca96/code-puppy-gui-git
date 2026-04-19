from backend.attachments_service import extract_urls_from_messages, strip_html, truncate_text


def test_extract_urls_from_messages_deduplicates():
    urls = extract_urls_from_messages([
        {'role': 'user', 'content': 'read https://example.com and https://example.com now'}
    ])
    assert urls == ['https://example.com']


def test_truncate_text_appends_marker():
    text = truncate_text('a' * 20, 10)
    assert text.endswith('...[truncated]')


def test_strip_html_removes_tags():
    assert strip_html('<h1>Hello</h1><p>world</p>') == 'Hello world'
