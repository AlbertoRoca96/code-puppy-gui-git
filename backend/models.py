from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field


class RunRequest(BaseModel):
    prompt: str


class AttachmentRef(BaseModel):
    id: str
    name: str
    kind: str
    mimeType: str | None = None
    uri: str | None = None
    uploadId: str | None = None
    url: str | None = None
    size: int | None = None


class ChatRequest(BaseModel):
    messages: list[dict[str, Any]]
    systemPrompt: str | None = None
    model: str | None = None
    temperature: float | None = None
    attachments: list[AttachmentRef] | None = None
    webSearch: bool | None = None


class SessionSnapshot(BaseModel):
    messages: list[dict[str, Any]] = Field(default_factory=list)
    composer: str | None = ''
    presetId: str | None = None
    systemPrompt: str | None = None
    apiBase: str | None = None
    updatedAt: float | None = None
    model: str | None = None

    model_config = ConfigDict(extra='allow')
