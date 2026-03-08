import { SessionAttachment } from './sessions';

export interface AttachmentReference {
  id: string;
  name: string;
  mimeType?: string | null;
  kind: 'file' | 'image';
  uri?: string | null;
  uploadId?: string | null;
  url?: string | null;
  size?: number | null;
}

export function toAttachmentReferences(
  attachments: SessionAttachment[]
): AttachmentReference[] {
  return attachments.map((attachment) => ({
    id: attachment.id,
    name: attachment.name,
    mimeType: attachment.mimeType,
    kind: attachment.kind,
    uri: attachment.uri,
    uploadId: attachment.uploadId || null,
    url: attachment.url || null,
    size: attachment.size || null,
  }));
}

export function hasUploadedAttachment(attachment: SessionAttachment): boolean {
  return Boolean(attachment.uploadId);
}
